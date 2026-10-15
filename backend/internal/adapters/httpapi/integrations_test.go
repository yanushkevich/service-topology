package httpapi_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/dynatrace"
	"servicetopology/backend/internal/adapters/dynatrace/dynatracefake"
	"servicetopology/backend/internal/adapters/flowformats"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/adapters/memory"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/fixtures"
)

const fakeToken = "dt0s16.HTTP-TEST-TOKEN"

// dynatraceHandler serves the API over the mock topology with a connector to the fake tenant.
func dynatraceHandler(t *testing.T) (http.Handler, *memory.Store, *dynatracefake.Tenant) {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", "mock.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	tenant, err := dynatracefake.Load(filepath.Join(dir, "dynatrace", "example-tenant.json"))
	if err != nil {
		t.Fatal(err)
	}
	tenant.Token = fakeToken
	server := httptest.NewServer(tenant.Handler())
	t.Cleanup(server.Close)
	tokenFile := filepath.Join(t.TempDir(), "token.txt")
	if err := os.WriteFile(tokenFile, []byte(fakeToken), 0o600); err != nil {
		t.Fatal(err)
	}
	minute := dynatrace.Duration{Duration: time.Minute}
	cfg := &dynatrace.Config{
		Tenants: []dynatrace.TenantConfig{{ID: "example", URL: server.URL, Example: true, AllowInsecureLoopback: true, Auth: dynatrace.AuthConfig{PlatformTokenFile: tokenFile}}},
		Environments: []dynatrace.EnvironmentConfig{
			{ID: "production", Name: "Production", Kind: "production", Tenant: "example", Match: dynatrace.MatchRule{Tag: &dynatrace.TagRule{Key: "environment", Value: "production"}}},
			{ID: "staging", Name: "Staging", Kind: "staging", Tenant: "example", Match: dynatrace.MatchRule{Tag: &dynatrace.TagRule{Key: "environment", Value: "staging"}}},
		},
		Refresh:   dynatrace.RefreshConfig{Interval: minute, MetricsWindow: dynatrace.Duration{Duration: 5 * time.Minute}},
		Discovery: dynatrace.DiscoveryConfig{Window: dynatrace.Duration{Duration: 24 * time.Hour}},
		Limits:    dynatrace.LimitsConfig{MaxRecords: 1000, QueryTimeout: dynatrace.Duration{Duration: 10 * time.Second}},
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	conn, err := dynatrace.NewConnector(cfg, server.Client(), logger)
	if err != nil {
		t.Fatal(err)
	}
	store := memory.New(data)
	svc := &application.Service{TopologyRepo: store, SnapshotRepo: store, LayoutRepo: store.Layouts(), BoardRepo: store.Boards(), GraphRepo: store, SimRepo: store.Simulations(),
		FlowFormats: application.FlowFormats{"native": flowformats.Native{}, "bpmn": flowformats.BPMN{}}}
	svc.Sync = application.NewSourceSync(conn, store.Integrations())
	return httpapi.NewHandler(httpapi.Deps{Logger: logger, API: svc}), store, tenant
}

func TestIntegrationNotConfigured(t *testing.T) {
	h, _ := apiHandler(t)
	res := call(h, "GET", "/api/v1/integrations/dynatrace", "")
	if res.code != 404 || !strings.Contains(string(res.body), "integration-not-configured") {
		t.Fatalf("status: %d %s", res.code, res.body)
	}
}

func TestIntegrationStatusAndCheck(t *testing.T) {
	h, _, _ := dynatraceHandler(t)
	res := call(h, "GET", "/api/v1/integrations/dynatrace", "")
	var status struct {
		Source    string `json:"source"`
		IsExample bool   `json:"isExample"`
		Tenants   []struct{ ID, Host, Auth string }
		LastSync  any `json:"lastSync"`
	}
	res.json(t, &status)
	if res.code != 200 || status.Source != "dynatrace" || !status.IsExample || len(status.Tenants) != 1 || status.Tenants[0].Auth != "platform-token" || status.LastSync != nil {
		t.Fatalf("status: %d %s", res.code, res.body)
	}
	if strings.Contains(string(res.body), fakeToken) || strings.Contains(string(res.body), "token.txt") {
		t.Fatal("the status reveals a secret or its path")
	}
	check := call(h, "POST", "/api/v1/integrations/dynatrace/check", "")
	var checks struct {
		Items []struct {
			Query   string `json:"query"`
			OK      bool   `json:"ok"`
			Records int    `json:"records"`
		} `json:"items"`
	}
	check.json(t, &checks)
	if check.code != 200 || len(checks.Items) != 7 || !checks.Items[0].OK {
		t.Fatalf("check: %d %s", check.code, check.body)
	}
}

func TestIntegrationPreviewAndApplyOverTheMockTopology(t *testing.T) {
	h, store, _ := dynatraceHandler(t)
	before := len(store.Data.ServiceInstances)
	res := call(h, "POST", "/api/v1/integrations/dynatrace/preview", "")
	var preview struct {
		ID           string                    `json:"id"`
		BaseRevision string                    `json:"baseRevision"`
		CanApply     bool                      `json:"canApply"`
		IsExample    bool                      `json:"isExample"`
		Summary      map[string]map[string]int `json:"summary"`
		Issues       []any                     `json:"issues"`
		Changes      []struct{ Op, Kind, ID string }
	}
	res.json(t, &preview)
	if res.code != 200 || !preview.CanApply || !preview.IsExample || res.hdr.Get("ETag") != `"`+preview.BaseRevision+`"` {
		t.Fatalf("preview: %d %s", res.code, res.body)
	}
	// The mock already has payment-service and inventory-service: they are linked, not duplicated.
	for _, c := range preview.Changes {
		if c.Op == "create" && (c.ID == "payment-service" || c.ID == "payment-service.production" || c.ID == "inventory-service") {
			t.Errorf("an existing service was created again: %+v", c)
		}
	}
	if preview.Summary["service-definition"]["link"] == 0 || preview.Summary["service-instance"]["create"] == 0 {
		t.Errorf("summary: %v", preview.Summary)
	}

	stale := callIfMatch(h, "POST", "/api/v1/integrations/dynatrace/apply", `{"previewId":"`+preview.ID+`"}`, `"not-the-base"`)
	if stale.code != 412 {
		t.Fatalf("stale If-Match: %d %s", stale.code, stale.body)
	}
	res = call(h, "POST", "/api/v1/integrations/dynatrace/preview", "")
	res.json(t, &preview)
	applied := callIfMatch(h, "POST", "/api/v1/integrations/dynatrace/apply", `{"previewId":"`+preview.ID+`"}`, `"`+preview.BaseRevision+`"`)
	if applied.code != 200 || applied.hdr.Get("ETag") == `"`+preview.BaseRevision+`"` {
		t.Fatalf("apply: %d %s", applied.code, applied.body)
	}
	if after := len(store.Data.ServiceInstances); after <= before {
		t.Errorf("instances %d → %d", before, after)
	}
	if again := call(h, "POST", "/api/v1/integrations/dynatrace/apply", `{"previewId":"`+preview.ID+`"}`); again.code != 404 {
		t.Errorf("a preview applies once: %d", again.code)
	}
	if missing := call(h, "POST", "/api/v1/integrations/dynatrace/apply", `{}`); missing.code != 400 {
		t.Errorf("no preview ID: %d", missing.code)
	}
	if unknown := call(h, "POST", "/api/v1/integrations/dynatrace/apply", `{"previewId":"x","extra":1}`); unknown.code != 400 {
		t.Errorf("unknown fields are rejected: %d", unknown.code)
	}
	res = call(h, "POST", "/api/v1/integrations/dynatrace/preview", "")
	res.json(t, &preview)
	if len(preview.Changes) != 0 {
		t.Errorf("a second preview should be empty: %+v", preview.Changes)
	}
}

func TestIntegrationSourceFailureIsABadGateway(t *testing.T) {
	h, _, tenant := dynatraceHandler(t)
	tenant.Fail = map[string]int{"services": http.StatusUnauthorized}
	res := call(h, "POST", "/api/v1/integrations/dynatrace/preview", "")
	if res.code != 502 || !strings.Contains(string(res.body), "Dynatrace rejected the credentials (401)") || strings.Contains(string(res.body), fakeToken) {
		t.Fatalf("preview: %d %s", res.code, res.body)
	}
}

func TestIntegrationAliases(t *testing.T) {
	h, _, _ := dynatraceHandler(t)
	res := call(h, "GET", "/api/v1/integrations/dynatrace/aliases", "")
	if res.code != 200 || res.hdr.Get("ETag") != `"0"` || !strings.Contains(string(res.body), `"aliases":{}`) {
		t.Fatalf("empty: %d %s %v", res.code, res.body, res.hdr)
	}
	body := `{"aliases":{"FraudScoring":"fraud-scoring"}}`
	if res := call(h, "PUT", "/api/v1/integrations/dynatrace/aliases", body); res.code != 400 {
		t.Fatalf("without If-Match: %d %s", res.code, res.body)
	}
	res = callIfMatch(h, "PUT", "/api/v1/integrations/dynatrace/aliases", body, `"0"`)
	if res.code != 200 || res.hdr.Get("ETag") != `"1"` {
		t.Fatalf("save: %d %s", res.code, res.body)
	}
	if res := callIfMatch(h, "PUT", "/api/v1/integrations/dynatrace/aliases", body, `"0"`); res.code != 412 {
		t.Fatalf("stale: %d", res.code)
	}
	if res := callIfMatch(h, "PUT", "/api/v1/integrations/dynatrace/aliases", `{"aliases":{"x":""}}`, `"1"`); res.code != 422 {
		t.Fatalf("invalid ID: %d %s", res.code, res.body)
	}
	// With the alias, FraudScoring links to the mock's fraud-scoring instead of a new definition.
	preview := call(h, "POST", "/api/v1/integrations/dynatrace/preview", "")
	if strings.Contains(string(preview.body), `"id":"fraudscoring"`) {
		t.Errorf("the alias was not applied: %s", preview.body)
	}
}
