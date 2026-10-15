package dynatrace_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/dynatrace"
	"servicetopology/backend/internal/adapters/dynatrace/dynatracefake"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

const platformToken = "dt0s16.FAKE-TOKEN-NEVER-LOGGED"

// fakeTenant serves the example tenant and returns it with a connector configured for it.
func fakeTenant(t *testing.T, oauth bool) (*dynatracefake.Tenant, *dynatrace.Connector, *strings.Builder) {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	tenant, err := dynatracefake.Load(filepath.Join(dir, "dynatrace", "example-tenant.json"))
	if err != nil {
		t.Fatal(err)
	}
	tenant.Token, tenant.ClientID, tenant.ClientSecret = platformToken, "dt0s02.FAKE", "fake-client-secret"
	server := httptest.NewServer(tenant.Handler())
	t.Cleanup(server.Close)

	secret := filepath.Join(t.TempDir(), "secret.txt")
	auth := dynatrace.AuthConfig{PlatformTokenFile: secret}
	content := platformToken
	if oauth {
		auth = dynatrace.AuthConfig{OAuth: &dynatrace.OAuthConfig{ClientID: "dt0s02.FAKE", ClientSecretFile: secret, TokenURL: server.URL + "/sso/oauth2/token"}}
		content = "fake-client-secret"
	}
	if err := os.WriteFile(secret, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &dynatrace.Config{
		Tenants: []dynatrace.TenantConfig{{ID: "main", URL: server.URL, AllowInsecureLoopback: true, Auth: auth}},
		Environments: []dynatrace.EnvironmentConfig{
			{ID: "production", Name: "Production", Kind: "production", Tenant: "main", Match: dynatrace.MatchRule{Tag: &dynatrace.TagRule{Key: "environment", Value: "production"}}},
			{ID: "staging", Name: "Staging", Kind: "staging", Tenant: "main", Match: dynatrace.MatchRule{Tag: &dynatrace.TagRule{Key: "environment", Value: "staging"}}},
		},
		Refresh:   dynatrace.RefreshConfig{Interval: dur(time.Minute), MetricsWindow: dur(5 * time.Minute)},
		Discovery: dynatrace.DiscoveryConfig{Window: dur(24 * time.Hour)},
		Limits:    dynatrace.LimitsConfig{MaxRecords: 1000, QueryTimeout: dur(10 * time.Second)},
	}
	logs := &strings.Builder{}
	conn, err := dynatrace.NewConnector(cfg, server.Client(), slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	if err != nil {
		t.Fatal(err)
	}
	return tenant, conn, logs
}

func dur(d time.Duration) dynatrace.Duration { return dynatrace.Duration{Duration: d} }

func TestDiscoverThroughTheQueryAPI(t *testing.T) {
	for _, oauth := range []bool{false, true} {
		t.Run(map[bool]string{false: "platform token", true: "OAuth client"}[oauth], func(t *testing.T) {
			tenant, conn, logs := fakeTenant(t, oauth)
			d, err := conn.Discover(context.Background(), map[string]domain.EntityID{"FraudScoring": "fraud-scoring"})
			if err != nil {
				t.Fatal(err)
			}
			if len(d.Data.ServiceInstances) != 7 || len(d.Data.Relationships) != 10 || d.IsExample {
				t.Errorf("instances=%d relationships=%d example=%v", len(d.Data.ServiceInstances), len(d.Data.Relationships), d.IsExample)
			}
			// The queries run in parallel; each runs once.
			if executed := slices.Sorted(slices.Values(tenant.Executed)); !slices.Equal(executed, []string{"databases", "k8s-nodes", "service-belongs-to", "service-calls", "services"}) {
				t.Errorf("executed = %v", tenant.Executed)
			}
			if strings.Contains(logs.String(), platformToken) || strings.Contains(logs.String(), "fake-client-secret") {
				t.Error("a secret reached the logs")
			}
		})
	}
}

func TestObserveThroughTheQueryAPI(t *testing.T) {
	_, conn, _ := fakeTenant(t, false)
	conn.Now = func() time.Time { return time.Date(2026, 10, 15, 8, 45, 0, 0, time.UTC) }
	obs, err := conn.Observe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	payment := obs.Tenants["main"]["SERVICE-30E45F0274EFB653"]
	if payment.Health != "degraded" || payment.Metrics == nil || payment.Metrics.IsSimulated || obs.ObservedAt != "2026-10-15T08:45:00Z" {
		t.Errorf("payment-service = %+v at %s", payment, obs.ObservedAt)
	}
}

func TestQueryFailuresAreSafeAndNamed(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	tenant.Fail = map[string]int{"service-calls": http.StatusForbidden}
	_, err := conn.Discover(context.Background(), nil)
	var qe *dynatrace.QueryError
	if !errors.As(err, &qe) || !errors.Is(err, dynatrace.ErrForbidden) || !slices.Equal(qe.MissingScopes, []string{"storage:smartscape:read"}) {
		t.Fatalf("err = %v", err)
	}
	if msg := err.Error(); msg != "Dynatrace tenant main, query service-calls: Missing scopes: storage:smartscape:read" {
		t.Errorf("message = %q", msg)
	}

	tenant.Fail = map[string]int{"services": http.StatusUnauthorized}
	_, err = conn.Discover(context.Background(), nil)
	if !errors.Is(err, dynatrace.ErrAuth) || strings.Contains(err.Error(), platformToken) {
		t.Errorf("err = %v", err)
	}
}

func TestRateLimitIsRetried(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	tenant.RateLimitOnce = true
	if _, err := conn.Discover(context.Background(), nil); err != nil {
		t.Fatalf("a single 429 should be retried: %v", err)
	}
}

func TestCheckReportsEveryQuery(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	tenant.Fail = map[string]int{"problems": http.StatusForbidden}
	delete(tenant.Results, "databases")
	checks := conn.Check(context.Background())
	if len(checks) != 7 {
		t.Fatalf("checks = %d, want 7", len(checks))
	}
	byQuery := map[string]int{}
	for i, c := range checks {
		byQuery[c.Query] = i
	}
	if c := checks[byQuery["services"]]; !c.OK || c.Records != 9 || len(c.MissingFields) != 0 || c.ScannedBytes == 0 {
		t.Errorf("services = %+v", c)
	}
	if c := checks[byQuery["databases"]]; !c.OK || c.Records != 0 {
		t.Errorf("databases = %+v", c)
	}
	if c := checks[byQuery["problems"]]; c.OK || c.Message != "Missing scopes: storage:smartscape:read" {
		t.Errorf("problems = %+v", c)
	}
}

func TestCheckReportsMissingFields(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	// A tenant whose service records lack id_classic (for example, another schema version).
	tenant.Results["services"] = []json.RawMessage{[]byte(`{"id":"SERVICE-1","name":"x"}`)}
	for _, c := range conn.Check(context.Background()) {
		if c.Query == "services" && !slices.Equal(c.MissingFields, []string{"tags", "id_classic"}) {
			t.Errorf("missing fields = %v", c.MissingFields)
		}
	}
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	var leaked bool
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("Authorization") != ""
	}))
	defer elsewhere.Close()
	redirecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer redirecting.Close()
	secret := filepath.Join(t.TempDir(), "token.txt")
	_ = os.WriteFile(secret, []byte(platformToken), 0o600)
	cfg := &dynatrace.Config{
		Tenants:      []dynatrace.TenantConfig{{ID: "main", URL: redirecting.URL, AllowInsecureLoopback: true, Auth: dynatrace.AuthConfig{PlatformTokenFile: secret}}},
		Environments: []dynatrace.EnvironmentConfig{{ID: "production", Name: "Production", Kind: "production", Tenant: "main", Match: dynatrace.MatchRule{All: true}}},
		Discovery:    dynatrace.DiscoveryConfig{Window: dur(time.Hour)},
		Limits:       dynatrace.LimitsConfig{MaxRecords: 10, QueryTimeout: dur(5 * time.Second)},
	}
	conn, err := dynatrace.NewConnector(cfg, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Discover(context.Background(), nil); err == nil {
		t.Error("a redirect must fail the query")
	}
	if leaked {
		t.Error("the token was sent to the redirect target")
	}
}
