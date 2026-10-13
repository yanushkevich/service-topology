package httpapi_test

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/adapters/flowformats"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/adapters/memory"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
	"servicetopology/backend/internal/simulation"
)

func apiHandler(t *testing.T) (http.Handler, *memory.Store) {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", "mock.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	store := memory.New(data)
	svc := &application.Service{TopologyRepo: store, SnapshotRepo: store, LayoutRepo: store.Layouts(), GraphRepo: store, SimRepo: store.Simulations(), SimulationMaxRuns: 3,
		FlowFormats: application.FlowFormats{"native": flowformats.Native{}, "bpmn": flowformats.BPMN{}}}
	return httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), API: svc}), store
}

type result struct {
	code int
	hdr  http.Header
	body []byte
}

func (r result) json(t *testing.T, into any) {
	t.Helper()
	if err := json.Unmarshal(r.body, into); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
}

func (r result) problem(t *testing.T) httpapi.Problem {
	t.Helper()
	if ct := r.hdr.Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("content type %q for %d %s", ct, r.code, r.body)
	}
	var p httpapi.Problem
	r.json(t, &p)
	return p
}

func call(h http.Handler, method, path, body string, contentType ...string) result {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		ct := "application/json"
		if len(contentType) > 0 {
			ct = contentType[0]
		}
		req.Header.Set("Content-Type", ct)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return result{rec.Code, rec.Header(), rec.Body.Bytes()}
}

func TestEnvironmentsAndTopology(t *testing.T) {
	h, _ := apiHandler(t)
	var envs struct{ Items []domain.Environment }
	call(h, "GET", "/api/v1/environments", "").json(t, &envs)
	if len(envs.Items) != 3 || envs.Items[0].ID != "production" || envs.Items[2].ID != "development" {
		t.Fatalf("environments %+v", envs.Items)
	}
	var all, staging domain.TopologyData
	call(h, "GET", "/api/v1/topology", "").json(t, &all)
	call(h, "GET", "/api/v1/topology?environmentId=staging", "").json(t, &staging)
	if len(all.ServiceInstances) != 21 || len(staging.Environments) != 1 || len(staging.ServiceInstances) >= len(all.ServiceInstances) {
		t.Fatalf("topology sizes: all %d, staging %d", len(all.ServiceInstances), len(staging.ServiceInstances))
	}
	if issues := domain.Validate(&staging); len(issues) != 0 {
		t.Fatalf("staging projection invalid: %+v", issues)
	}
	if r := call(h, "GET", "/api/v1/topology?environmentId=ghost", ""); r.code != 404 {
		t.Fatalf("unknown environment: %d", r.code)
	}
}

func TestRegistryPaginationAndParameters(t *testing.T) {
	h, _ := apiHandler(t)
	var full application.RegistryPage
	call(h, "GET", "/api/v1/registry?environmentId=production&sort=name&limit=500", "").json(t, &full)
	if len(full.Items) < 20 || full.NextCursor != nil {
		t.Fatalf("full page: %d items, cursor %v", len(full.Items), full.NextCursor)
	}
	var paged []domain.RegistryRow
	url := "/api/v1/registry?environmentId=production&sort=name&limit=7"
	for pages := 0; ; pages++ {
		var p application.RegistryPage
		call(h, "GET", url, "").json(t, &p)
		paged = append(paged, p.Items...)
		if p.NextCursor == nil {
			break
		}
		url = "/api/v1/registry?environmentId=production&sort=name&limit=7&cursor=" + *p.NextCursor
		if pages > 20 {
			t.Fatal("pagination does not end")
		}
	}
	a, _ := json.Marshal(full.Items)
	b, _ := json.Marshal(paged)
	if string(a) != string(b) {
		t.Fatal("paged rows differ from the single page")
	}
	var filtered application.RegistryPage
	call(h, "GET", "/api/v1/registry?environmentId=production&provider=aws,gcp&kind=messaging&q=orders", "").json(t, &filtered)
	for _, r := range filtered.Items {
		if r.Group != "messaging" || (r.Provider != "aws" && r.Provider != "gcp") {
			t.Fatalf("filter not applied: %+v", r)
		}
	}
	for _, bad := range []string{
		"/api/v1/registry", // environmentId required
		"/api/v1/registry?environmentId=production&provider=ibm", // unknown enum
		"/api/v1/registry?environmentId=production&limit=501",    // over max
		"/api/v1/registry?environmentId=production&limit=x",      // not a number
		"/api/v1/registry?environmentId=production&sort=size",    // unknown sort
		"/api/v1/registry?environmentId=production&cursor=abc",   // malformed cursor
		"/api/v1/registry?environmentId=staging&cursor=" + strings.TrimPrefix(url, "/api/v1/registry?environmentId=production&sort=name&limit=7&cursor="), // cursor from another query
	} {
		r := call(h, "GET", bad, "")
		if p := r.problem(t); r.code != 400 || p.Status != 400 || len(p.Errors) == 0 {
			t.Errorf("%s: got %d %s", bad, r.code, r.body)
		}
	}
	if r := call(h, "GET", "/api/v1/registry?environmentId=ghost", ""); r.code != 404 {
		t.Errorf("unknown environment: %d", r.code)
	}
}

func TestEntities(t *testing.T) {
	h, _ := apiHandler(t)
	var inst domain.ServiceInstance
	call(h, "GET", "/api/v1/entities/service-instance/payment-service.production", "").json(t, &inst)
	if inst.ID != "payment-service.production" {
		t.Fatalf("entity %+v", inst)
	}
	r := call(h, "GET", "/api/v1/entities/service-instance/ghost", "")
	if p := r.problem(t); r.code != 404 || p.Detail != `No service-instance with ID "ghost".` {
		t.Fatalf("missing entity: %d %+v", r.code, p)
	}
	if r := call(h, "GET", "/api/v1/entities/widget/x", ""); r.code != 400 {
		t.Fatalf("bad kind: %d", r.code)
	}
}

func snapshotJSON(t *testing.T) string {
	t.Helper()
	dir, _ := fixtures.Dir()
	raw, err := os.ReadFile(filepath.Join(dir, "snapshots", "fixture-0600.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestSnapshots(t *testing.T) {
	h, _ := apiHandler(t)
	body := snapshotJSON(t)
	r := call(h, "POST", "/api/v1/topology/snapshots", body)
	if r.code != 201 || r.hdr.Get("Location") != "/api/v1/topology/snapshots/fixture-0600" {
		t.Fatalf("capture: %d %s", r.code, r.body)
	}
	if r := call(h, "POST", "/api/v1/topology/snapshots", body); r.code != 409 {
		t.Fatalf("duplicate: %d", r.code)
	}
	var list struct{ Items []domain.SnapshotSummary }
	call(h, "GET", "/api/v1/topology/snapshots?from=2026-10-11T05:00:00Z&to=2026-10-11T07:00:00Z", "").json(t, &list)
	if len(list.Items) != 1 {
		t.Fatalf("list: %+v", list.Items)
	}
	call(h, "GET", "/api/v1/topology/snapshots?from=2026-10-11T07:00:00%2B02:00", "").json(t, &list) // 05:00Z
	if len(list.Items) != 1 {
		t.Fatalf("offset-aware from: %+v", list.Items)
	}
	var snap domain.Snapshot
	call(h, "GET", "/api/v1/topology/snapshots/fixture-0600", "").json(t, &snap)
	var want, got any
	_ = json.Unmarshal([]byte(body), &want)
	gotRaw, _ := json.Marshal(snap)
	_ = json.Unmarshal(gotRaw, &got)
	if a, b := mustJSON(want), mustJSON(got); a != b {
		t.Fatal("snapshot round trip differs")
	}
	invalid := strings.Replace(strings.Replace(body, `"fixture-0600"`, `"bad"`, 1), `"isSimulated": true`, `"isSimulated": false`, 1)
	r = call(h, "POST", "/api/v1/topology/snapshots", invalid)
	if p := r.problem(t); r.code != 422 || p.Errors[0].Code != domain.CodeInvalidSnapshot {
		t.Fatalf("invalid snapshot: %d %+v", r.code, p)
	}
	if r := call(h, "GET", "/api/v1/topology/snapshots?from=yesterday", ""); r.code != 400 {
		t.Fatalf("bad from: %d", r.code)
	}
	if r := call(h, "GET", "/api/v1/topology/snapshots/ghost", ""); r.code != 404 {
		t.Fatalf("missing: %d", r.code)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

const layout = `{"schemaVersion":1,"id":"layout-1","name":" On-call view ","createdAt":"2026-10-11T09:00:00.000Z",
"view":{"environmentId":"production","layoutMode":"topology","filters":{"query":"","providers":[],"health":[],"groups":[]},"collapsedGroupIds":[]},
"positions":{"order-service.production":{"x":10,"y":20.5}}}`

func TestLayoutsCRUD(t *testing.T) {
	h, _ := apiHandler(t)
	r := call(h, "POST", "/api/v1/layouts", layout)
	var created domain.SavedLayout
	r.json(t, &created)
	if r.code != 201 || created.Name != "On-call view" {
		t.Fatalf("create: %d %s", r.code, r.body)
	}
	if r := call(h, "POST", "/api/v1/layouts", layout); r.code != 409 {
		t.Fatalf("duplicate: %d", r.code)
	}
	if r := call(h, "PUT", "/api/v1/layouts/layout-1", strings.Replace(layout, "On-call view", "Renamed", 1)); r.code != 200 {
		t.Fatalf("replace: %d %s", r.code, r.body)
	}
	if r := call(h, "PUT", "/api/v1/layouts/other", layout); r.code != 422 {
		t.Fatalf("id mismatch: %d", r.code)
	}
	if r := call(h, "PUT", "/api/v1/layouts/layout-2", strings.Replace(layout, "layout-1", "layout-2", 1)); r.code != 404 {
		t.Fatalf("replace missing: %d", r.code)
	}
	var list struct{ Items []domain.SavedLayout }
	call(h, "GET", "/api/v1/layouts", "").json(t, &list)
	if len(list.Items) != 1 || list.Items[0].Name != "Renamed" {
		t.Fatalf("list: %+v", list.Items)
	}
	r = call(h, "POST", "/api/v1/layouts", strings.Replace(layout, `"topology"`, `"3d"`, 1))
	if p := r.problem(t); r.code != 422 || p.Errors[0].Code != domain.CodeInvalidLayout {
		t.Fatalf("invalid layout: %d %+v", r.code, p)
	}
	if r := call(h, "POST", "/api/v1/layouts", strings.Replace(layout, `"positions"`, `"extra":1,"positions"`, 1)); r.code != 400 {
		t.Fatalf("unknown field: %d", r.code)
	}
	if r := call(h, "POST", "/api/v1/layouts", layout, "text/plain"); r.code != 415 {
		t.Fatalf("media type: %d", r.code)
	}
	if r := call(h, "POST", "/api/v1/layouts", `{"name":"`+strings.Repeat("x", 2<<20)+`"}`); r.code != 413 {
		t.Fatalf("too large: %d", r.code)
	}
	if r := call(h, "DELETE", "/api/v1/layouts/layout-1", ""); r.code != 204 {
		t.Fatalf("delete: %d", r.code)
	}
	if r := call(h, "DELETE", "/api/v1/layouts/layout-1", ""); r.code != 404 {
		t.Fatalf("delete again: %d", r.code)
	}
	r = call(h, "PATCH", "/api/v1/layouts/layout-1", "")
	if p := r.problem(t); r.code != 405 || !strings.Contains(p.Detail, "DELETE") {
		t.Fatalf("method not allowed: %d %+v", r.code, p)
	}
}

func TestDatabaseFailuresAreServiceUnavailable(t *testing.T) {
	h, store := apiHandler(t)
	store.Err = errors.Join(ports.ErrUnavailable, errors.New("connection refused to 10.0.0.5"))
	r := call(h, "GET", "/api/v1/environments", "")
	if p := r.problem(t); r.code != 503 || strings.Contains(string(r.body), "10.0.0.5") || p.RequestID == "" {
		t.Fatalf("got %d %s", r.code, r.body)
	}
	store.Err = errors.New("unexpected bug detail")
	if r := call(h, "GET", "/api/v1/environments", ""); r.code != 500 || strings.Contains(string(r.body), "bug detail") {
		t.Fatalf("got %d %s", r.code, r.body)
	}
	noDB := httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if r := call(noDB, "GET", "/api/v1/environments", ""); r.code != 503 {
		t.Fatalf("no database: %d", r.code)
	}
}

func TestTraversalEndpoints(t *testing.T) {
	h, store := apiHandler(t)
	full := domain.BuildIndex(store.Data)

	var deps application.DependencyResult
	call(h, "GET", "/api/v1/topology/dependencies?entityId=order-service.production&direction=upstream", "").json(t, &deps)
	want := full.DependencyTree("order-service.production", "upstream", 0)
	if mustJSON(deps.Items) != mustJSON(want) || deps.MaxDepth != 10 || deps.Truncated {
		t.Fatalf("dependencies differ from the full-graph tree")
	}
	call(h, "GET", "/api/v1/topology/dependencies?entityId=order-service.production&direction=upstream&maxDepth=1&limit=2", "").json(t, &deps)
	if len(deps.Items) != 2 || !deps.Truncated || deps.Items[0].Depth != 1 {
		t.Fatalf("bounded: %+v", deps)
	}

	var nh application.NeighborhoodResult
	call(h, "GET", "/api/v1/topology/neighborhood?entityId=topic-orders-events-prod&depth=2", "").json(t, &nh)
	if mustJSON(nh.EntityIDs) != mustJSON(domain.SortedIDs(full.Neighborhood("topic-orders-events-prod", 2))) || len(nh.RelationshipIDs) == 0 {
		t.Fatalf("neighborhood %+v", nh)
	}

	var imp application.ImpactResult
	call(h, "GET", "/api/v1/topology/impact?entityId=payment-service.production", "").json(t, &imp)
	if mustJSON(imp.Impacts) != mustJSON(full.AnalyzeImpact([]domain.FailureRoot{{EntityID: "payment-service.production", Mode: "unavailable"}})) || len(imp.Impacts) == 0 {
		t.Fatalf("impact %+v", imp)
	}

	var rules struct{ Items []domain.PropagationRule }
	call(h, "GET", "/api/v1/propagation-rules", "").json(t, &rules)
	if len(rules.Items) != 7 {
		t.Fatalf("rules %d", len(rules.Items))
	}

	var flows struct{ Items []json.RawMessage }
	call(h, "GET", "/api/v1/event-types?environmentId=staging", "").json(t, &flows)
	if len(flows.Items) != 3 {
		t.Fatalf("event types %d", len(flows.Items))
	}
	if r := call(h, "GET", "/api/v1/event-types/event-order-placed?environmentId=production", ""); r.code != 200 || !strings.Contains(string(r.body), `"channelId":"topic-orders-events-prod"`) {
		t.Fatalf("event type: %d %s", r.code, r.body)
	}

	for path, code := range map[string]int{
		"/api/v1/topology/dependencies?entityId=order-service.production&direction=sideways":             400,
		"/api/v1/topology/dependencies?entityId=order-service.production&direction=upstream&maxDepth=11": 400,
		"/api/v1/topology/dependencies?entityId=order-service.production&direction=upstream&limit=1001":  400,
		"/api/v1/topology/dependencies?direction=upstream":                                               400,
		"/api/v1/topology/dependencies?entityId=ghost&direction=upstream":                                404,
		"/api/v1/topology/dependencies?entityId=production&direction=upstream":                           404, // an environment, not traversable
		"/api/v1/topology/neighborhood?entityId=order-service.production&depth=4":                        400,
		"/api/v1/topology/impact?entityId=order-service.production&mode=slow":                            400,
		"/api/v1/topology/impact?entityId=ghost":                                                         404,
		"/api/v1/event-types":                                                                            400,
		"/api/v1/event-types?environmentId=ghost":                                                        404,
		"/api/v1/event-types/event-payment-captured?environmentId=staging":                               404,
	} {
		if r := call(h, "GET", path, ""); r.code != code {
			t.Errorf("%s: got %d, want %d (%s)", path, r.code, code, r.body)
		}
	}
}

func TestSimulationRuns(t *testing.T) {
	h, store := apiHandler(t)
	before := mustJSON(store.Data)
	body := `{"seed":42,"label":"Payments outage drill","captureSnapshot":true,"watch":["payment-service.production","order-service.production"],
	  "actions":[{"type":"inject","entityId":"payment-service.production","mode":"unavailable","durationTicks":3},{"type":"step","ticks":6},
	  {"type":"inject","entityId":"topic-orders-events-prod","mode":"unavailable"},{"type":"step","ticks":4},{"type":"recoverAll"}]}`
	r := call(h, "POST", "/api/v1/simulations", body)
	var run domain.SimulationRun
	r.json(t, &run)
	if r.code != 201 || run.Tick != 10 || !run.IsSimulated || run.Provenance != "simulated" || run.SnapshotID == nil || run.EventCount == 0 {
		t.Fatalf("run: %d %s", r.code, r.body)
	}
	if mustJSON(store.Data) != before {
		t.Fatal("a simulation run changed the canonical topology")
	}

	// Stored events equal the engine's event stream for the same seed and actions.
	var events application.Page[domain.StoredEvent]
	call(h, "GET", "/api/v1/events?simulationId="+run.ID+"&limit=1000", "").json(t, &events)
	if len(events.Items) != run.EventCount {
		t.Fatalf("events: %d, run says %d", len(events.Items), run.EventCount)
	}
	for i, e := range events.Items {
		if e.Provenance != "simulated" || e.Event["isSimulated"] != true || e.Seq != i+1 {
			t.Fatalf("event %d not labelled simulated or out of sequence: %+v", i, e)
		}
	}
	// Replay the same seed and actions directly in the engine: the stored payloads must be its events.
	st := simulation.Create(store.Data, 42, "")
	st, _ = st.Inject("payment-service.production", "unavailable", 3)
	st = st.Step(6)
	st, _ = st.Inject("topic-orders-events-prod", "unavailable", 0)
	st = st.Step(4).RecoverAll()
	var stored []map[string]any
	for _, e := range events.Items {
		stored = append(stored, e.Event)
	}
	if len(st.Events) >= simulation.MaxEvents || mustJSON(stored) != mustJSON(canonicalEvents(st.Events)) {
		t.Fatalf("stored events differ from the engine's (%d stored, %d engine)", len(stored), len(st.Events))
	}

	var filtered application.Page[domain.StoredEvent]
	call(h, "GET", "/api/v1/events?simulationId="+run.ID+"&type=failure-injected", "").json(t, &filtered)
	if len(filtered.Items) != 2 {
		t.Fatalf("failure-injected events: %d", len(filtered.Items))
	}

	// One sample per watched entity, metric, and recorded state (initial + per action/tick).
	var tel application.Page[domain.TelemetryObservation]
	call(h, "GET", "/api/v1/telemetry?simulationId="+run.ID+"&entityId=payment-service.production&metricName=latencyMs&limit=1000", "").json(t, &tel)
	if len(tel.Items) != 1+1+6+1+4+1 || !tel.Items[0].IsSimulated || tel.Items[0].Unit != "ms" {
		t.Fatalf("telemetry: %d samples %+v", len(tel.Items), tel.Items[:1])
	}

	// The captured snapshot is a "simulation" snapshot and differs from the current topology.
	var snap domain.Snapshot
	call(h, "GET", "/api/v1/topology/snapshots/"+*run.SnapshotID, "").json(t, &snap)
	if snap.Source != "simulation" || !snap.IsSimulated || snap.Label != "Payments outage drill" {
		t.Fatalf("snapshot %+v", snap.SnapshotSummary)
	}
	var diff application.DiffResult
	call(h, "GET", "/api/v1/topology/snapshots/"+*run.SnapshotID+"/diff?against=current", "").json(t, &diff)
	if diff.After != "current" {
		t.Fatalf("diff %+v", diff)
	}

	for name, bad := range map[string]string{
		"no actions":     `{"actions":[]}`,
		"unknown entity": `{"actions":[{"type":"inject","entityId":"ghost","mode":"unavailable"}]}`,
		"bad mode":       `{"actions":[{"type":"inject","entityId":"payment-service.production","mode":"slow"}]}`,
		"too many ticks": `{"actions":[{"type":"step","ticks":501}]}`,
		"too many watch": `{"watch":["a","b","c","d","e","f"],"actions":[{"type":"step","ticks":1}]}`,
		"unknown type":   `{"actions":[{"type":"explode"}]}`,
		"unknown field":  `{"actions":[{"type":"step","ticks":1}],"mutateTopology":true}`,
	} {
		if r := call(h, "POST", "/api/v1/simulations", bad); r.code != 400 {
			t.Errorf("%s: got %d %s", name, r.code, r.body)
		}
	}
	for path, code := range map[string]int{
		"/api/v1/events":                    400,
		"/api/v1/events?simulationId=ghost": 404,
		"/api/v1/telemetry?simulationId=" + run.ID + "&metricName=cpu": 400,
		"/api/v1/simulations/ghost":                                    404,
		"/api/v1/topology/snapshots/ghost/diff":                        404,
	} {
		if r := call(h, "GET", path, ""); r.code != code {
			t.Errorf("%s: got %d, want %d", path, r.code, code)
		}
	}

	// Retention: SimulationMaxRuns is 3, so after 3 more runs the first one is gone.
	for i := 0; i < 3; i++ {
		call(h, "POST", "/api/v1/simulations", `{"actions":[{"type":"step","ticks":1}]}`)
	}
	if r := call(h, "GET", "/api/v1/simulations/"+run.ID, ""); r.code != 404 {
		t.Fatalf("retention did not prune the oldest run: %d", r.code)
	}
	var list struct{ Items []domain.SimulationRun }
	call(h, "GET", "/api/v1/simulations", "").json(t, &list)
	if len(list.Items) != 3 {
		t.Fatalf("runs kept: %d", len(list.Items))
	}
}

func canonicalEvents(events []simulation.Event) []map[string]any {
	b, _ := json.Marshal(events)
	var out []map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}
