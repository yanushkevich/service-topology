package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

func callIfMatch(h http.Handler, method, path, body, etag string) result {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if etag != "" {
		req.Header.Set("If-Match", etag)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return result{rec.Code, rec.Header(), rec.Body.Bytes()}
}

func TestEntityWritesRoundTrip(t *testing.T) {
	h, store := apiHandler(t)
	topo := call(h, "GET", "/api/v1/topology", "")
	etag := topo.hdr.Get("ETag")
	if topo.code != 200 || etag == "" {
		t.Fatalf("GET /topology: %d, ETag %q", topo.code, etag)
	}

	// Create an environment, then a definition and an instance in it.
	res := callIfMatch(h, "POST", "/api/v1/entities/environment", `{"id":"qa","name":"QA","kind":"other"}`, etag)
	if res.code != 201 || res.hdr.Get("Location") != "/api/v1/entities/environment/qa" || res.hdr.Get("ETag") == etag {
		t.Fatalf("create environment: %d %s %v", res.code, res.body, res.hdr)
	}
	etag = res.hdr.Get("ETag")
	if res = callIfMatch(h, "POST", "/api/v1/entities/service-definition", `{"id":"billing","name":"Billing","category":"api"}`, etag); res.code != 201 {
		t.Fatalf("create definition: %d %s", res.code, res.body)
	}
	var def domain.ServiceDefinition
	res.json(t, &def)
	if def.Protocols == nil {
		t.Fatal("protocols must default to [] (required by the schema)")
	}
	etag = res.hdr.Get("ETag")
	inst := `{"id":"billing.qa","serviceDefinitionId":"billing","environmentId":"qa","provider":"aws","health":"healthy","updatedAt":"2000-01-01T00:00:00Z","metrics":{"latencyMs":1,"isSimulated":false}}`
	res = callIfMatch(h, "POST", "/api/v1/entities/service-instance", inst, etag)
	if res.code != 201 {
		t.Fatalf("create instance: %d %s", res.code, res.body)
	}
	var created domain.ServiceInstance
	res.json(t, &created)
	if created.UpdatedAt == "2000-01-01T00:00:00Z" || created.Metrics != nil {
		t.Fatalf("server must set updatedAt and drop client telemetry: %+v", created)
	}
	etag = res.hdr.Get("ETag")

	// A stale revision is refused; nothing changes.
	if res = callIfMatch(h, "PUT", "/api/v1/entities/environment/qa", `{"id":"qa","name":"Old","kind":"other"}`, `"memory-0"`); res.code != 412 {
		t.Fatalf("stale If-Match: %d %s", res.code, res.body)
	}
	// Replace keeps telemetry of the stored entity.
	res = callIfMatch(h, "PUT", "/api/v1/entities/service-instance/payment-service.production",
		`{"id":"payment-service.production","serviceDefinitionId":"payment-service","environmentId":"production","provider":"azure","health":"degraded","updatedAt":"2000-01-01T00:00:00Z"}`, etag)
	if res.code != 200 {
		t.Fatalf("replace instance: %d %s", res.code, res.body)
	}
	var replaced domain.ServiceInstance
	res.json(t, &replaced)
	if replaced.Health != "degraded" || replaced.Metrics == nil || !replaced.Metrics.IsSimulated {
		t.Fatalf("replace must keep stored (simulated) telemetry: %+v", replaced)
	}
	etag = res.hdr.Get("ETag")

	// Deleting a referenced entity is refused with the blockers; removing them first works.
	res = callIfMatch(h, "DELETE", "/api/v1/entities/environment/qa", "", etag)
	if res.code != 422 || !strings.Contains(string(res.body), "billing.qa") {
		t.Fatalf("blocked delete: %d %s", res.code, res.body)
	}
	if res = callIfMatch(h, "DELETE", "/api/v1/entities/service-instance/billing.qa", "", etag); res.code != 204 || res.hdr.Get("ETag") == "" {
		t.Fatalf("delete instance: %d %s", res.code, res.body)
	}
	if res = callIfMatch(h, "DELETE", "/api/v1/entities/environment/qa", "", ""); res.code != 204 {
		t.Fatalf("delete environment without If-Match: %d %s", res.code, res.body)
	}
	if _, rev, _ := store.CurrentTopology(t.Context()); rev != "memory-6" {
		t.Fatalf("writes applied: revision %s", rev)
	}
}

func TestEntityWriteErrors(t *testing.T) {
	h, _ := apiHandler(t)
	cases := []struct {
		name, method, path, body string
		status                   int
		contains                 string
	}{
		{"unknown kind", "POST", "/api/v1/entities/widget", `{}`, 400, "kind"},
		{"unknown field", "POST", "/api/v1/entities/environment", `{"id":"x","name":"X","kind":"other","color":"red"}`, 400, "color"},
		{"bad enum", "POST", "/api/v1/entities/environment", `{"id":"x","name":"X","kind":"test"}`, 422, "invalid-field"},
		{"duplicate ID across kinds", "POST", "/api/v1/entities/environment", `{"id":"payment-service","name":"X","kind":"other"}`, 409, "already exists"},
		{"unknown reference", "POST", "/api/v1/entities/service-instance", `{"id":"x.production","serviceDefinitionId":"ghost","environmentId":"production","provider":"aws","health":"healthy"}`, 422, "missing-service-definition"},
		{"id change", "PUT", "/api/v1/entities/environment/production", `{"id":"prod","name":"P","kind":"production"}`, 422, "cannot be changed"},
		{"replace missing", "PUT", "/api/v1/entities/environment/ghost", `{"id":"ghost","name":"G","kind":"other"}`, 404, "ghost"},
		{"delete missing", "DELETE", "/api/v1/entities/resource/ghost", "", 404, "ghost"},
		{"wrong content type", "POST", "/api/v1/entities/environment", `x`, 415, ""},
	}
	for _, c := range cases {
		var res result
		if c.name == "wrong content type" {
			res = call(h, c.method, c.path, c.body, "text/plain")
		} else {
			res = call(h, c.method, c.path, c.body)
		}
		if res.code != c.status || !strings.Contains(string(res.body), c.contains) {
			t.Errorf("%s: %d %s", c.name, res.code, res.body)
			continue
		}
		res.problem(t)
	}
}

func TestBusinessFlowWrites(t *testing.T) {
	h, _ := apiHandler(t)
	etag := call(h, "GET", "/api/v1/topology", "").hdr.Get("ETag")
	flow := `{"id":"flow-reorder","name":"Reorder","trigger":{"kind":"manual"},"startStepId":"place","steps":[` +
		`{"id":"place","name":"Place order","serviceDefinitionId":"order-service","kind":"task"},` +
		`{"id":"charge","name":"Charge","serviceDefinitionId":"payment-service","kind":"task"}],` +
		`"transitions":[{"id":"t1","from":"place","to":"charge","via":{"kind":"call"}},{"id":"t2","from":"charge","to":"done","via":{"kind":"local"}}],` +
		`"outcomes":[{"id":"done","name":"Done","kind":"success"}],"source":{"kind":"authored"}}`
	res := callIfMatch(h, "POST", "/api/v1/entities/business-flow", flow, etag)
	if res.code != 201 {
		t.Fatalf("create flow: %d %s", res.code, res.body)
	}
	if loc := res.hdr.Get("Location"); loc != "/api/v1/entities/business-flow/flow-reorder" {
		t.Fatalf("Location = %q", loc)
	}
	var created domain.BusinessFlow
	res.json(t, &created)
	if created.Transitions[0].Policies == nil {
		t.Fatal("policies must default to []")
	}
	if !strings.Contains(string(call(h, "GET", "/api/v1/topology", "").body), `"flow-reorder"`) {
		t.Fatal("GET /topology must include the new flow")
	}

	// A transition the topology does not back is refused (flows never invent communication).
	unbacked := strings.Replace(flow, `"flow-reorder"`, `"flow-bad"`, 1)
	unbacked = strings.Replace(unbacked, `"serviceDefinitionId":"payment-service"`, `"serviceDefinitionId":"ledger-service"`, 1)
	if res = callIfMatch(h, "POST", "/api/v1/entities/business-flow", unbacked, ""); res.code != 422 || !strings.Contains(string(res.body), "flow-transition-unbacked") {
		t.Fatalf("unbacked flow: %d %s", res.code, res.body)
	}
	// Enumerations are checked like the schema.
	badKind := strings.Replace(flow, `"kind":"task"}`, `"kind":"chore"}`, 1)
	if res = callIfMatch(h, "PUT", "/api/v1/entities/business-flow/flow-reorder", badKind, ""); res.code != 422 || !strings.Contains(string(res.body), "invalid-field") {
		t.Fatalf("bad step kind: %d %s", res.code, res.body)
	}

	// Imported flows change only through the importer.
	imported := strings.Replace(flow, `"source":{"kind":"authored"}`, `"source":{"kind":"imported","format":"native","ref":"flows.yaml","importedAt":"2026-10-12T08:00:00Z"}`, 1)
	if res = callIfMatch(h, "PUT", "/api/v1/entities/business-flow/flow-reorder", imported, ""); res.code != 409 || !strings.Contains(string(res.body), "imported-read-only") {
		t.Fatalf("marking a flow imported through the API: %d %s", res.code, res.body)
	}

	if res = callIfMatch(h, "DELETE", "/api/v1/entities/business-flow/flow-reorder", "", ""); res.code != 204 {
		t.Fatalf("delete flow: %d %s", res.code, res.body)
	}
}

func importBody(t *testing.T, format, file string, mapping string) string {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "flows", file))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"format": format, "content": string(raw), "ref": file, "mapping": json.RawMessage(mapping)})
	return string(body)
}

func TestImportBusinessFlows(t *testing.T) {
	h, _ := apiHandler(t)
	body := importBody(t, "native", "daily-payout.flow.yaml", "{}")
	res := callIfMatch(h, "POST", "/api/v1/imports/business-flows", body, "")
	if res.code != 200 || !strings.Contains(string(res.body), `"status":"created"`) || res.hdr.Get("ETag") == "" {
		t.Fatalf("import: %d %s", res.code, res.body)
	}
	topo := string(call(h, "GET", "/api/v1/topology", "").body)
	if !strings.Contains(topo, `"flow-daily-payout"`) || !strings.Contains(topo, `"kind":"imported","format":"native","ref":"daily-payout.flow.yaml"`) {
		t.Fatalf("stored flow must be marked imported: %s", topo[strings.Index(topo, "flow-daily-payout"):][:300])
	}
	// Re-importing the same definition writes nothing.
	etag := call(h, "GET", "/api/v1/topology", "").hdr.Get("ETag")
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", body, ""); res.code != 200 || !strings.Contains(string(res.body), `"status":"unchanged"`) || res.hdr.Get("ETag") != etag {
		t.Fatalf("re-import: %d %s (revision %s → %s)", res.code, res.body, etag, res.hdr.Get("ETag"))
	}
	// A changed definition replaces the imported flow.
	changed := strings.Replace(body, "Daily payout", "Daily payouts", 1)
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", changed, ""); res.code != 200 || !strings.Contains(string(res.body), `"status":"updated"`) {
		t.Fatalf("update: %d %s", res.code, res.body)
	}
	// Imported flows are read-only through the entity API.
	if res = callIfMatch(h, "DELETE", "/api/v1/entities/business-flow/flow-daily-payout", "", ""); res.code != 409 {
		t.Fatalf("delete imported: %d %s", res.code, res.body)
	}

	// An import never overwrites an authored flow with the same ID.
	authored := strings.Replace(body, "flow-daily-payout", "flow-checkout", 1)
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", authored, ""); res.code != 409 || !strings.Contains(string(res.body), "import-overwrites-authored") {
		t.Fatalf("authored: %d %s", res.code, res.body)
	}
	// A flow the topology does not back is rejected as a whole; nothing is written.
	unbacked := strings.Replace(importBody(t, "native", "daily-payout.flow.yaml", "{}"), "serviceDefinitionId: ledger-service", "serviceDefinitionId: catalog-service", 1)
	unbacked = strings.Replace(unbacked, "flow-daily-payout", "flow-other", 1)
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", unbacked, ""); res.code != 422 || !strings.Contains(string(res.body), "flow-transition-unbacked") {
		t.Fatalf("unbacked: %d %s", res.code, res.body)
	}
	if strings.Contains(string(call(h, "GET", "/api/v1/topology", "").body), "flow-other") {
		t.Fatal("a rejected import must not write anything")
	}
}

func TestImportBPMN(t *testing.T) {
	h, _ := apiHandler(t)
	res := callIfMatch(h, "POST", "/api/v1/imports/business-flows", importBody(t, "bpmn", "order-cancellation.bpmn", "{}"), "")
	if res.code != 200 || !strings.Contains(string(res.body), `"id":"flow-order-cancellation"`) {
		t.Fatalf("bpmn import: %d %s", res.code, res.body)
	}
	// Tasks without a service are named; nothing is guessed.
	body := strings.Replace(importBody(t, "bpmn", "order-cancellation.bpmn", "{}"), ` st:service=\"payment-service\"`, "", 1)
	body = strings.Replace(body, "order-cancellation", "order-cancellation-2", 1)
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", body, ""); res.code != 422 || !strings.Contains(string(res.body), `"code":"import-invalid","entityId":"Task_void"`) {
		t.Fatalf("unmapped: %d %s", res.code, res.body)
	}
	if res = callIfMatch(h, "POST", "/api/v1/imports/business-flows", `{"format":"visio","content":"x"}`, ""); res.code != 400 {
		t.Fatalf("unknown format: %d %s", res.code, res.body)
	}
}
