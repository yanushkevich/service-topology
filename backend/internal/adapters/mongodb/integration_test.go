//go:build integration

package mongodb_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Integration tests run against a real MongoDB replica set (make dev-up; make test-integration).
// Every test gets its own temporary database, dropped afterwards, so local data is never touched.

func settings(t *testing.T) *config.MongoDB {
	t.Helper()
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	if cfg.MongoDB == nil {
		// The integration tag is an explicit request to test against MongoDB: never pass by skipping.
		t.Fatal("MONGODB_URI not set; run `make test-integration` with MongoDB running (make dev-up)")
	}
	return cfg.MongoDB
}

func tempStore(t *testing.T) *mongodb.Store {
	t.Helper()
	s, err := mongodb.Connect(settings(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := s.Ping(ctx); err != nil {
		t.Fatalf("MongoDB not reachable (make dev-up): %v", err)
	}
	s = s.WithDatabase(fmt.Sprintf("topology_it_%d", time.Now().UnixNano()))
	t.Cleanup(func() {
		if err := s.DropDatabase(context.Background()); err != nil {
			t.Logf("drop %s: %v", s.Database(), err)
		}
		_ = s.Close(context.Background())
	})
	return s
}

func ready(t *testing.T) (*mongodb.Store, context.Context) {
	t.Helper()
	s := tempStore(t)
	ctx := context.Background()
	if err := mongodb.EnsureSchema(ctx, s); err != nil {
		t.Fatal(err)
	}
	return s, ctx
}

func mockTopology(t *testing.T) (*domain.TopologyData, []byte) {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "topology", "mock.v1.json")
	data, err := fixtures.LoadTopology(path)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data, raw
}

func sameJSON(t *testing.T, want []byte, got any) {
	t.Helper()
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(want, &a)
	_ = json.Unmarshal(encoded, &b)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("stored value differs\nwant: %.400s\n got: %.400s", want, encoded)
	}
}

func count(t *testing.T, s *mongodb.Store, coll string) int {
	t.Helper()
	n, err := s.Count(context.Background(), coll)
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func TestFreshDatabaseInitializesIdempotently(t *testing.T) {
	s := tempStore(t)
	ctx := context.Background()
	if err := mongodb.CheckSchema(ctx, s); !errors.Is(err, mongodb.ErrDatabaseNotFound) {
		t.Fatalf("before init: got %v, want database not found", err)
	}
	for i := 0; i < 2; i++ {
		if err := mongodb.EnsureSchema(ctx, s); err != nil {
			t.Fatalf("EnsureSchema run %d: %v", i+1, err)
		}
	}
	if err := mongodb.CheckSchema(ctx, s); err != nil {
		t.Fatalf("CheckSchema: %v", err)
	}
}

func TestSeedRoundTripsTheFixtureAndRerunsSafely(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewTopologyRepository(s)
	data, raw := mockTopology(t)

	for run := 1; run <= 2; run++ {
		res, err := repo.ReplaceTopology(ctx, data, "fixture")
		if err != nil {
			t.Fatalf("import run %d: %v", run, err)
		}
		if res.Documents["relationships"] != len(data.Relationships) {
			t.Fatalf("import result: %+v", res)
		}
		got, err := repo.GetTopology(ctx, "")
		if err != nil {
			t.Fatalf("read run %d: %v", run, err)
		}
		sameJSON(t, raw, got)
		if issues := domain.Validate(got); len(issues) != 0 {
			t.Fatalf("stored topology is invalid: %+v", issues)
		}
	}
	// No duplicates after the rerun.
	want := map[string]int{
		"environments": len(data.Environments), "serviceDefinitions": len(data.ServiceDefinitions),
		"serviceInstances": len(data.ServiceInstances), "resources": len(data.Resources),
		"relationships": len(data.Relationships), "eventTypes": len(data.EventTypes), "topologyState": 1,
	}
	for coll, n := range want {
		if got := count(t, s, coll); got != n {
			t.Errorf("%s: %d documents, want %d", coll, got, n)
		}
	}
	meta, err := repo.TopologyMeta(ctx)
	if err != nil || meta.SourceType != "fixture" || !meta.IsMock || len(meta.Revision) != 32 {
		t.Fatalf("meta: %v %+v", err, meta)
	}
}

func TestInvalidTopologyIsRejectedBeforeWriting(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewTopologyRepository(s)
	data, raw := mockTopology(t)
	if _, err := repo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	broken, _ := mockTopology(t)
	broken.Relationships[0].TargetEntityID = "ghost"
	if _, err := repo.ReplaceTopology(ctx, broken, "fixture"); !mongodb.IsValidation(err) {
		t.Fatalf("got %v, want a validation error", err)
	}
	got, err := repo.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, raw, got) // unchanged
}

// The database enforces ID uniqueness itself (_id), independent of application validation, and a
// failed import rolls back the whole transaction: the previous topology stays intact.
func TestUniquenessAndRollbackAreEnforcedByTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewTopologyRepository(s)
	data, raw := mockTopology(t)
	if _, err := repo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	before, _ := repo.TopologyMeta(ctx)

	// Validation catches duplicate IDs first; the unique _id index rejects them even when a write
	// bypasses it.
	doc := map[string]any{"_id": "r1", "id": "r1", "_meta": map[string]any{"ord": 0, "recordedAt": "x", "sourceType": "x"}}
	if err := s.InsertRaw(ctx, "resources", doc); err != nil {
		t.Fatal(err)
	}
	if err := s.InsertRaw(ctx, "resources", doc); !errors.Is(err, ports.ErrConflict) {
		t.Fatalf("duplicate _id: got %v, want conflict", err)
	}
	if err := s.DeleteRaw(ctx, "resources", "r1"); err != nil {
		t.Fatal(err)
	}
	layouts := mongodb.NewLayoutRepository(s)
	l := &domain.SavedLayout{SchemaVersion: 1, ID: "x", Name: "x", CreatedAt: "2026-10-11T09:00:00Z", View: domain.LayoutView{EnvironmentID: "production", LayoutMode: "topology"}}
	domain.NormalizeSavedLayout(l)
	if err := layouts.Create(ctx, l); err != nil {
		t.Fatal(err)
	}
	if err := layouts.Create(ctx, l); !errors.Is(err, ports.ErrConflict) || strings.Contains(err.Error(), `"x"`) {
		t.Fatalf("duplicate: got %v, want a conflict without the key value", err)
	}

	// A simulation run whose records collide is rejected as a whole: the run document is gone too.
	sims := mongodb.NewSimulationRepository(s)
	run := &domain.SimulationRun{ID: "run-1", CreatedAt: "2026-10-11T09:00:00Z", Provenance: "simulated"}
	ev := domain.StoredEvent{SimulationID: "run-1", Seq: 1, Provenance: "simulated", Event: map[string]any{"type": "x"}}
	if err := sims.Save(ctx, run, []domain.StoredEvent{ev, ev}, nil); !errors.Is(err, ports.ErrConflict) {
		t.Fatalf("colliding records: got %v, want conflict", err)
	}
	if _, err := sims.Get(ctx, "run-1"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("run committed despite the failed transaction: %v", err)
	}
	after, _ := repo.TopologyMeta(ctx)
	got, _ := repo.GetTopology(ctx, "")
	sameJSON(t, raw, got)
	if before.Revision != after.Revision {
		t.Fatal("topology revision changed")
	}
}

// Writes that bypass the adapter still have to satisfy the collection validators.
func TestValidatorsRejectMalformedCanonicalDocuments(t *testing.T) {
	s, ctx := ready(t)
	if err := s.InsertRaw(ctx, "resources", map[string]any{"_id": "r1", "name": "no id or bookkeeping"}); err == nil {
		t.Fatal("document without id and _meta accepted")
	}
	if err := s.InsertRaw(ctx, "resources", map[string]any{"_id": "r1", "id": 42, "_meta": map[string]any{"ord": 0, "recordedAt": "x", "sourceType": "x"}}); err == nil {
		t.Fatal("numeric id accepted")
	}
}

func TestErrorsDoNotLeakSecrets(t *testing.T) {
	cfg := *settings(t)
	if cfg.Username == "" {
		t.Skip("server without authentication")
	}
	cfg.PasswordFile = filepath.Join(t.TempDir(), "pw")
	if err := os.WriteFile(cfg.PasswordFile, []byte("wrong-password-123"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := mongodb.Connect(&cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close(context.Background())
	err = s.Ping(context.Background())
	if _, err2 := s.Exists(context.Background()); err == nil {
		err = err2
	}
	if !errors.Is(err, mongodb.ErrAuth) || strings.Contains(err.Error(), "wrong-password") {
		t.Fatalf("got %v, want an auth error without the password", err)
	}
	init := mongodb.NewInitializer(s, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	go init.Run(ctx, 50*time.Millisecond)
	time.Sleep(2 * time.Second)
	cancel()
	if err := init.Check(context.Background()); err == nil || err.Error() != "credentials rejected" {
		t.Fatalf("readiness with rejected credentials: %v", err)
	}
}

func TestSnapshotAndLayoutRepositories(t *testing.T) {
	s, ctx := ready(t)
	dir, _ := fixtures.Dir()
	snaps := mongodb.NewSnapshotRepository(s)
	files, _ := filepath.Glob(filepath.Join(dir, "snapshots", "*.json"))
	for i := len(files) - 1; i >= 0; i-- { // insert newest first; List must still sort oldest first
		raw, _ := os.ReadFile(files[i])
		var snap domain.Snapshot
		if err := fixtures.DecodeStrict(raw, &snap); err != nil {
			t.Fatal(err)
		}
		if err := snaps.Save(ctx, &snap); err != nil {
			t.Fatal(err)
		}
		if err := snaps.Save(ctx, &snap); !errors.Is(err, ports.ErrConflict) {
			t.Fatalf("duplicate snapshot: %v", err)
		}
		got, err := snaps.Get(ctx, snap.ID)
		if err != nil {
			t.Fatal(err)
		}
		sameJSON(t, raw, got)
	}
	list, err := snaps.List(ctx, ports.SnapshotQuery{})
	if err != nil || len(list) != len(files) || list[0].ID != "fixture-0600" {
		t.Fatalf("list: %v %+v", err, list)
	}
	if bounded, _ := snaps.List(ctx, ports.SnapshotQuery{From: list[1].TakenAt}); len(bounded) != len(files)-1 {
		t.Fatalf("from filter: %d", len(bounded))
	}
	if _, err := snaps.Get(ctx, "ghost"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("missing snapshot: %v", err)
	}

	layouts := mongodb.NewLayoutRepository(s)
	mk := func(id, created string) *domain.SavedLayout {
		l := &domain.SavedLayout{SchemaVersion: 1, ID: id, Name: id, CreatedAt: created,
			View: domain.LayoutView{EnvironmentID: "production", LayoutMode: "topology"}, Positions: map[string]domain.Position{"a": {X: 1.5, Y: -2}}}
		domain.NormalizeSavedLayout(l)
		return l
	}
	for _, l := range []*domain.SavedLayout{mk("old", "2026-10-10T09:00:00Z"), mk("new", "2026-10-11T09:00:00Z")} {
		if err := layouts.Create(ctx, l); err != nil {
			t.Fatal(err)
		}
	}
	if err := layouts.Create(ctx, mk("old", "2026-10-10T09:00:00Z")); !errors.Is(err, ports.ErrConflict) {
		t.Fatalf("duplicate layout: %v", err)
	}
	renamed := mk("old", "2026-10-10T09:00:00Z")
	renamed.Name = "renamed"
	if err := layouts.Replace(ctx, renamed); err != nil {
		t.Fatal(err)
	}
	if err := layouts.Replace(ctx, mk("ghost", "2026-10-10T09:00:00Z")); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("replace missing: %v", err)
	}
	got, err := layouts.List(ctx)
	if err != nil || len(got) != 2 || got[0].ID != "new" || got[1].Name != "renamed" || got[1].Positions["a"].X != 1.5 {
		t.Fatalf("layouts: %v %+v", err, got)
	}
	if err := layouts.Remove(ctx, "old"); err != nil {
		t.Fatal(err)
	}
	if err := layouts.Remove(ctx, "old"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("remove missing: %v", err)
	}
}

// The bounded subgraph fetched with $graphLookup must give exactly the client's results (computed on
// the full in-memory graph) for every start entity, direction, and depth bound.
func TestTraversalOnTheDatabaseEqualsTheFullGraph(t *testing.T) {
	s, ctx := ready(t)
	dir, _ := fixtures.Dir()
	for _, file := range []string{"mock.v1.json", "scale-250.v1.json"} {
		data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := mongodb.NewTopologyRepository(s).ReplaceTopology(ctx, data, "fixture"); err != nil {
			t.Fatal(err)
		}
		full := domain.BuildIndex(data)
		svc := &application.Service{TopologyRepo: mongodb.NewTopologyRepository(s), GraphRepo: mongodb.NewGraphRepository(s), TraversalInDatabase: true}
		var starts []string
		for _, i := range data.ServiceInstances {
			starts = append(starts, i.ID)
		}
		for _, r := range data.Resources {
			starts = append(starts, r.ID)
		}
		if file != "mock.v1.json" { // sample the larger dataset to keep the test fast
			sampled := []string{}
			for i := 0; i < len(starts); i += 7 {
				sampled = append(sampled, starts[i])
			}
			starts = sampled
		}
		checked := 0
		for _, id := range starts {
			for _, direction := range []string{"upstream", "downstream"} {
				for _, depth := range []int{1, 2, 10} {
					got, err := svc.Dependencies(ctx, id, direction, depth, application.MaxDependencyLimit)
					if err != nil {
						t.Fatalf("%s %s %d: %v", id, direction, depth, err)
					}
					want := full.DependencyTree(id, direction, depth)
					if len(want) > application.MaxDependencyLimit {
						want = want[:application.MaxDependencyLimit]
					}
					a, _ := json.Marshal(got.Items)
					b, _ := json.Marshal(want)
					if string(a) != string(b) {
						t.Fatalf("%s: %s %s depth %d differs\n got: %.300s\nwant: %.300s", file, id, direction, depth, a, b)
					}
					checked++
				}
			}
			for depth := 1; depth <= 3; depth++ {
				got, err := svc.Neighborhood(ctx, id, depth)
				if err != nil {
					t.Fatal(err)
				}
				if a, b := strings.Join(got.EntityIDs, ","), strings.Join(domain.SortedIDs(full.Neighborhood(id, depth)), ","); a != b {
					t.Fatalf("%s: neighborhood %s depth %d differs", file, id, depth)
				}
				checked++
			}
		}
		t.Logf("%s: %d traversals equal the full-graph results", file, checked)
	}
	graph := mongodb.NewGraphRepository(s)
	if _, err := graph.Subgraph(ctx, "ghost", "upstream", 2, 100); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("unknown start: %v", err)
	}
	data, _ := fixtures.LoadTopology(filepath.Join(dir, "topology", "scale-250.v1.json"))
	busiest := ""
	ix := domain.BuildIndex(data)
	for _, i := range data.ServiceInstances {
		if busiest == "" || len(ix.Outgoing[i.ID]) > len(ix.Outgoing[busiest]) {
			busiest = i.ID
		}
	}
	if _, err := graph.Subgraph(ctx, busiest, "both", 10, 2); !errors.Is(err, ports.ErrTooLarge) {
		t.Fatalf("over the entity bound: %v", err)
	}
}

// A cached reader must see an import made through another repository (another process, e.g. seed).
func TestReadCacheFollowsImportsFromElsewhere(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	writer, reader := mongodb.NewTopologyRepository(s), mongodb.NewTopologyRepository(s)
	if _, err := writer.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	first, err := reader.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	again, _ := reader.GetTopology(ctx, "")
	if first != again {
		t.Fatal("unchanged revision should return the cached topology")
	}
	changed, _ := mockTopology(t)
	changed.Environments[0].Name = "Production (renamed)"
	if _, err := writer.ReplaceTopology(ctx, changed, "fixture"); err != nil {
		t.Fatal(err)
	}
	after, err := reader.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if after == first || after.Environments[0].Name != "Production (renamed)" {
		t.Fatalf("reader served stale data after an import elsewhere: %q", after.Environments[0].Name)
	}
}

func TestSimulationRunsOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, raw := mockTopology(t)
	topo := mongodb.NewTopologyRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	sims := mongodb.NewSimulationRepository(s)
	svc := &application.Service{TopologyRepo: topo, SnapshotRepo: mongodb.NewSnapshotRepository(s), SimRepo: sims, SimulationMaxRuns: 2}
	seed := uint32(7)
	req := &domain.SimulationRequest{Seed: &seed, CaptureSnapshot: true, Watch: []string{"order-service.production"},
		Actions: []domain.SimulationAction{{Type: "inject", EntityID: "eks-commerce-prod", Mode: "unavailable"}, {Type: "step", Ticks: 120}}}
	run, err := svc.RunSimulation(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	got, err := sims.Get(ctx, run.ID)
	if err != nil || got.EventCount != run.EventCount || got.Provenance != "simulated" {
		t.Fatalf("stored run: %v %+v", err, got)
	}
	a, _ := json.Marshal(run)
	b, _ := json.Marshal(got)
	if string(a) != string(b) {
		t.Fatalf("stored run differs from the returned one")
	}
	events, err := sims.Events(ctx, run.ID, "", "")
	if err != nil || len(events) != run.EventCount || run.EventCount < 10 {
		t.Fatalf("events: %v %d (run says %d)", err, len(events), run.EventCount)
	}
	for i, e := range events {
		if e.Seq != i+1 || e.Provenance != "simulated" {
			t.Fatalf("event %d: %+v", i, e)
		}
	}
	if typed, _ := sims.Events(ctx, run.ID, "", fmt.Sprint(events[0].Event["type"])); len(typed) == 0 || len(typed) > len(events) {
		t.Fatalf("type filter: %d", len(typed))
	}
	tel, err := sims.Telemetry(ctx, run.ID, "order-service.production", "latencyMs")
	if err != nil || len(tel) != 1+1+120 {
		t.Fatalf("telemetry: %v %d", err, len(tel))
	}
	if snap, err := mongodb.NewSnapshotRepository(s).Get(ctx, run.ID); err != nil || snap.Source != "simulation" {
		t.Fatalf("captured snapshot: %v", err)
	}
	// The canonical topology is unchanged.
	current, err := topo.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, raw, current)

	// Retention keeps the newest 2 runs and removes their records with them.
	for i := 0; i < 2; i++ {
		if _, err := svc.RunSimulation(ctx, &domain.SimulationRequest{Actions: []domain.SimulationAction{{Type: "step", Ticks: 1}}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sims.Get(ctx, run.ID); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("oldest run not pruned: %v", err)
	}
	if left, _ := sims.Events(ctx, run.ID, "", ""); len(left) != 0 {
		t.Fatalf("%d events of a pruned run remain", len(left))
	}
	if n := count(t, s, "telemetryObservations"); n != 0 {
		t.Fatalf("%d telemetry documents remain (only the pruned run watched entities)", n)
	}
}

// Hostile-looking identifiers and keys are plain values: they match nothing (or round-trip
// literally) and are never interpreted as query operators or Extended JSON.
func TestInjectionShapedInputOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	data.Resources[0].Metadata = map[string]any{"$where": "sleep(1000)", "a.b": map[string]any{"$ne": nil, "$date": "x"}}
	topo := mongodb.NewTopologyRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	stored, err := topo.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stored.Resources[0].Metadata, data.Resources[0].Metadata) {
		t.Fatalf("metadata did not round-trip literally: %#v", stored.Resources[0].Metadata)
	}
	hostile := []string{`{"$ne": null}`, `{"$gt": ""}`, `x' || '1'=='1`, `$where`, `a.b`, `function() { return true }`}
	graph := mongodb.NewGraphRepository(s)
	snaps := mongodb.NewSnapshotRepository(s)
	sims := mongodb.NewSimulationRepository(s)
	for _, id := range hostile {
		if _, err := graph.Subgraph(ctx, id, "upstream", 2, 100); !errors.Is(err, ports.ErrNotFound) {
			t.Errorf("subgraph %q: %v", id, err)
		}
		if _, err := snaps.Get(ctx, id); !errors.Is(err, ports.ErrNotFound) {
			t.Errorf("snapshot %q: %v", id, err)
		}
		if ev, err := sims.Events(ctx, id, id, id); err != nil || len(ev) != 0 {
			t.Errorf("events %q: %v %d", id, err, len(ev))
		}
	}
	layouts := mongodb.NewLayoutRepository(s)
	l := &domain.SavedLayout{SchemaVersion: 1, ID: hostile[0], Name: hostile[2], CreatedAt: "2026-10-11T09:00:00Z",
		View:      domain.LayoutView{EnvironmentID: "production", LayoutMode: "topology"},
		Positions: map[string]domain.Position{"$where": {X: 1}, "payment-service.production": {X: 2, Y: 3}}}
	domain.NormalizeSavedLayout(l)
	if err := layouts.Create(ctx, l); err != nil {
		t.Fatal(err)
	}
	l.Name = hostile[1]
	if err := layouts.Replace(ctx, l); err != nil {
		t.Fatal(err)
	}
	got, err := layouts.List(ctx)
	if err != nil || len(got) != 1 || got[0].ID != hostile[0] || got[0].Name != hostile[1] || !reflect.DeepEqual(got[0].Positions, l.Positions) {
		t.Fatalf("hostile strings did not round-trip literally: %v %+v", err, got)
	}
	if n := count(t, s, "resources"); n != len(data.Resources) {
		t.Fatalf("resources changed: %d", n)
	}
}

// Entity writes (ADR-020) through the application service on MongoDB: each write is one
// transaction guarded by the topology revision, and readers (also cached ones) see it.
func TestEntityWritesOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	topo := mongodb.NewTopologyRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	svc := &application.Service{TopologyRepo: topo}
	reader := mongodb.NewTopologyRepository(s)
	before, rev0, err := reader.CurrentTopology(ctx)
	if err != nil {
		t.Fatal(err)
	}

	env := &domain.Environment{ID: "qa", Name: "QA", Kind: "other"}
	res, err := svc.CreateEntity(ctx, domain.KindEnvironment, env, rev0)
	if err != nil {
		t.Fatal(err)
	}
	after, rev1, err := reader.CurrentTopology(ctx)
	if err != nil || rev1 != res.Revision || rev1 == rev0 {
		t.Fatalf("revision: %v %s %s", err, rev1, res.Revision)
	}
	if last := after.Environments[len(after.Environments)-1]; last.ID != "qa" || len(after.Environments) != len(before.Environments)+1 {
		t.Fatalf("new entity must be stored last: %+v", after.Environments)
	}

	// A write against the old revision fails and changes nothing.
	if _, err := svc.ReplaceEntity(ctx, domain.KindEnvironment, "qa", &domain.Environment{ID: "qa", Name: "Stale", Kind: "other"}, rev0); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("stale write: %v", err)
	}
	// The adapter also refuses a stale revision by itself (a write that raced the read).
	if _, err := topo.ApplyChange(ctx, ports.EntityChange{Op: ports.OpDelete, Kind: domain.KindEnvironment, ID: "qa"}, rev0, "manual"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("adapter stale write: %v", err)
	}

	// Replace keeps position and stored telemetry.
	inst := data.ServiceInstances[0]
	inst.Health = "unavailable"
	inst.Metrics = nil
	if _, err := svc.ReplaceEntity(ctx, domain.KindServiceInstance, inst.ID, &inst, ""); err != nil {
		t.Fatal(err)
	}
	got, _, _ := reader.CurrentTopology(ctx)
	if got.ServiceInstances[0].ID != inst.ID || got.ServiceInstances[0].Health != "unavailable" || got.ServiceInstances[0].Metrics == nil {
		t.Fatalf("replace: %+v", got.ServiceInstances[0])
	}

	// Deleting a referenced resource is refused; an unreferenced one is removed.
	if _, err := svc.DeleteEntity(ctx, domain.KindResource, "kafka-events-prod", ""); !errors.As(err, new(*application.ErrValidation)) {
		t.Fatalf("delete referenced: %v", err)
	}
	if _, err := svc.DeleteEntity(ctx, domain.KindEnvironment, "qa", ""); err != nil {
		t.Fatal(err)
	}
	final, _, _ := reader.CurrentTopology(ctx)
	if len(final.Environments) != len(before.Environments) || domain.Validate(final) != nil {
		t.Fatalf("final topology: %d environments, issues %v", len(final.Environments), domain.Validate(final))
	}
	if err := mongodb.CheckSchema(ctx, s); err != nil {
		t.Fatal(err)
	}
}

func TestBusinessFlowWritesOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	topo := mongodb.NewTopologyRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	svc := &application.Service{TopologyRepo: topo}
	reader := mongodb.NewTopologyRepository(s)
	stored, _, err := reader.CurrentTopology(ctx)
	if err != nil || len(stored.BusinessFlows) != len(data.BusinessFlows) || len(stored.BusinessFlows) == 0 {
		t.Fatalf("flows round trip: %v %d", err, len(stored.BusinessFlows))
	}

	// An authored copy of Refund: created, replaced, and deleted like any entity.
	flow := data.BusinessFlows[1]
	flow.ID = "flow-refund-copy"
	flow.Name = "Refund (copy)"
	if _, err := svc.CreateEntity(ctx, domain.KindBusinessFlow, &flow, ""); err != nil {
		t.Fatal(err)
	}
	flow.Name = "Refund (edited)"
	if _, err := svc.ReplaceEntity(ctx, domain.KindBusinessFlow, flow.ID, &flow, ""); err != nil {
		t.Fatal(err)
	}
	got, _, _ := reader.CurrentTopology(ctx)
	if last := got.BusinessFlows[len(got.BusinessFlows)-1]; last.ID != flow.ID || last.Name != "Refund (edited)" {
		t.Fatalf("stored flow: %+v", last)
	}
	// Imported flows are read-only through the API.
	imported := flow
	format, ref, at := "native", "flows.yaml", "2026-10-12T08:00:00Z"
	imported.Source = domain.FlowSource{Kind: "imported", Format: &format, Ref: &ref, ImportedAt: &at}
	if _, err := svc.ReplaceEntity(ctx, domain.KindBusinessFlow, flow.ID, &imported, ""); !errors.Is(err, application.ErrImportedFlow) {
		t.Fatalf("imported write: %v", err)
	}
	if _, err := svc.DeleteEntity(ctx, domain.KindBusinessFlow, flow.ID, ""); err != nil {
		t.Fatal(err)
	}
	final, _, _ := reader.CurrentTopology(ctx)
	if len(final.BusinessFlows) != len(data.BusinessFlows) || domain.Validate(final) != nil {
		t.Fatalf("final: %d flows, issues %v", len(final.BusinessFlows), domain.Validate(final))
	}
}
