package httpapi_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/adapters/memory"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/auth"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/observability"
)

func secureHandler(t *testing.T, sec httpapi.Security, metrics *observability.Metrics) http.Handler {
	t.Helper()
	dir, _ := fixtures.Dir()
	data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", "mock.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	store := memory.New(data)
	svc := &application.Service{TopologyRepo: store, SnapshotRepo: store, LayoutRepo: store.Layouts(), GraphRepo: store, SimRepo: store.Simulations()}
	return httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), API: svc, Security: sec, Metrics: metrics, SchemaVersion: 4, AuthMode: "token"})
}

func request(h http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestBearerAuthenticationAndRoles(t *testing.T) {
	reader, editor := auth.NewToken(), auth.NewToken()
	h := secureHandler(t, httpapi.Security{Tokens: auth.Tokens{
		auth.Digest(reader): {Name: "viewer", Role: auth.RoleReader},
		auth.Digest(editor): {Name: "ci", Role: auth.RoleEditor},
	}}, nil)
	bearer := func(tok string) map[string]string { return map[string]string{"Authorization": "Bearer " + tok} }
	run := `{"actions":[{"type":"step","ticks":1}]}`

	for name, hdr := range map[string]map[string]string{"missing": nil, "unknown": bearer("tst_guess"), "wrong scheme": {"Authorization": "Basic " + reader}} {
		rec := request(h, "GET", "/api/v1/environments", "", hdr)
		if rec.Code != 401 || !strings.HasPrefix(rec.Header().Get("WWW-Authenticate"), "Bearer") || rec.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("%s token: %d %v", name, rec.Code, rec.Header())
		}
	}
	if rec := request(h, "GET", "/api/v1/environments", "", bearer(reader)); rec.Code != 200 {
		t.Errorf("reader GET: %d", rec.Code)
	}
	if rec := request(h, "POST", "/api/v1/simulations", run, bearer(reader)); rec.Code != 403 {
		t.Errorf("reader POST: %d", rec.Code)
	}
	if rec := request(h, "POST", "/api/v1/simulations", run, bearer(editor)); rec.Code != 201 {
		t.Errorf("editor POST: %d %s", rec.Code, rec.Body)
	}
	for _, path := range []string{"/healthz", "/readyz"} {
		if rec := request(h, "GET", path, "", nil); rec.Code == 401 {
			t.Errorf("%s must not require a token", path)
		}
	}
}

func TestRateLimiting(t *testing.T) {
	h := secureHandler(t, httpapi.Security{RateLimitRPS: 1, RateLimitBurst: 3}, nil)
	codes := []int{}
	for i := 0; i < 5; i++ {
		codes = append(codes, request(h, "GET", "/api/v1/propagation-rules", "", nil).Code)
	}
	if codes[0] != 200 || codes[2] != 200 || codes[3] != 429 || codes[4] != 429 {
		t.Fatalf("codes %v", codes)
	}
	rec := request(h, "GET", "/api/v1/propagation-rules", "", nil)
	if rec.Header().Get("Retry-After") == "" || rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("429 headers %v", rec.Header())
	}
	if rec := request(h, "GET", "/healthz", "", nil); rec.Code != 200 {
		t.Fatalf("health checks are exempt: %d", rec.Code)
	}
	// Other clients have their own bucket.
	req := httptest.NewRequest("GET", "/api/v1/propagation-rules", nil)
	req.RemoteAddr = "192.0.2.9:4000"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("another client limited: %d", rr.Code)
	}
}

func TestCORSAndSecurityHeaders(t *testing.T) {
	h := secureHandler(t, httpapi.Security{CORSAllowedOrigins: []string{"https://app.example.test"}}, nil)
	pre := request(h, "OPTIONS", "/api/v1/layouts", "", map[string]string{"Origin": "https://app.example.test", "Access-Control-Request-Method": "POST"})
	if pre.Code != 204 || pre.Header().Get("Access-Control-Allow-Origin") != "https://app.example.test" || !strings.Contains(pre.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatalf("allowed preflight: %d %v", pre.Code, pre.Header())
	}
	if pre := request(h, "OPTIONS", "/api/v1/layouts", "", map[string]string{"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}); pre.Code != 403 {
		t.Fatalf("disallowed preflight: %d", pre.Code)
	}
	if rec := request(h, "GET", "/api/v1/environments", "", map[string]string{"Origin": "https://evil.example"}); rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("disallowed origin got CORS headers")
	}
	rec := request(h, "GET", "/api/v1/environments", "", map[string]string{"Origin": "https://app.example.test"})
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://app.example.test" || rec.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("allowed origin headers: %v", rec.Header())
	}
	for k, v := range map[string]string{"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"} {
		if rec.Header().Get(k) != v {
			t.Errorf("%s = %q", k, rec.Header().Get(k))
		}
	}
	if !strings.Contains(rec.Header().Get("Content-Security-Policy"), "default-src 'none'") {
		t.Error("missing CSP")
	}
}

// Identifiers are data, never query text: injection-shaped IDs must produce 404, not 500.
func TestInjectionShapedInputsAreData(t *testing.T) {
	h := secureHandler(t, httpapi.Security{}, nil)
	for _, id := range []string{`x' OR '1'='1`, `x"); DELETE FROM Resource; --`, `#1:0`, `../../etc/passwd`, `<script>`} {
		esc := strings.NewReplacer(" ", "%20", "'", "%27", `"`, "%22", ";", "%3B", "#", "%23", "<", "%3C", ">", "%3E", "/", "%2F").Replace(id)
		for _, path := range []string{"/api/v1/entities/resource/" + esc, "/api/v1/topology/dependencies?direction=upstream&entityId=" + esc, "/api/v1/topology/snapshots/" + esc} {
			if rec := request(h, "GET", path, "", nil); rec.Code != 404 {
				t.Errorf("%s: %d %s", path, rec.Code, rec.Body)
			}
		}
	}
}

func TestMetaAndMetrics(t *testing.T) {
	m := observability.NewMetrics()
	h := secureHandler(t, httpapi.Security{}, m)
	rec := request(h, "GET", "/api/v1/meta", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"isMock":true`) || !strings.Contains(rec.Body.String(), `"sourceType":"fixture"`) {
		t.Fatalf("meta: %d %s", rec.Code, rec.Body)
	}
	request(h, "GET", "/api/v1/entities/service-instance/payment-service.production", "", nil)
	var out strings.Builder
	m.Write(&out)
	text := out.String()
	if !strings.Contains(text, `http_requests_total{route="GET /api/v1/entities/{kind}/{id}",method="GET",status="200"} 1`) {
		t.Fatalf("metrics must label by route pattern, not by path:\n%s", text)
	}
	if strings.Contains(text, "payment-service") {
		t.Fatal("metrics contain an entity ID")
	}
}
