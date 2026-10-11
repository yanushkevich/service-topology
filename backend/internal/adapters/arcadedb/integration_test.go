//go:build integration

package arcadedb_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Integration tests run against a real ArcadeDB (make dev-up; make test-integration). Every test
// gets its own temporary database, dropped afterwards, so local data is never touched.

func settings(t *testing.T) *config.ArcadeDB {
	t.Helper()
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	if cfg.ArcadeDB == nil {
		// The integration tag is an explicit request to test against ArcadeDB: never pass by skipping.
		t.Fatal("ARCADEDB_BASE_URL not set; run `make test-integration` with ArcadeDB running (make dev-up)")
	}
	return cfg.ArcadeDB
}

func tempClient(t *testing.T) *arcadedb.Client {
	t.Helper()
	c, err := arcadedb.NewClient(settings(t))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := c.Ready(ctx); err != nil {
		t.Fatalf("ArcadeDB not reachable (make dev-up): %v", err)
	}
	c = c.WithDatabase(fmt.Sprintf("topology_it_%d", time.Now().UnixNano()))
	traceSlow(t, c)
	t.Cleanup(func() {
		if err := c.DropDatabase(context.Background()); err != nil {
			t.Logf("drop %s: %v", c.Database(), err)
		}
	})
	return c
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
		t.Fatalf("stored topology differs from the fixture\nwant: %.400s\n got: %.400s", want, encoded)
	}
}

func count(t *testing.T, c *arcadedb.Client, typ string) int {
	t.Helper()
	rows, err := c.Query(context.Background(), "SELECT count(*) AS n FROM "+typ, nil)
	if err != nil {
		t.Fatal(err)
	}
	n, _ := rows[0]["n"].(json.Number).Int64()
	return int(n)
}

func TestFreshDatabaseInitializesIdempotently(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.CheckSchema(ctx, c); !errors.Is(err, arcadedb.ErrDatabaseNotFound) {
		t.Fatalf("before init: got %v, want database not found", err)
	}
	for i := 0; i < 2; i++ {
		if err := arcadedb.EnsureSchema(ctx, c); err != nil {
			t.Fatalf("EnsureSchema run %d: %v", i+1, err)
		}
	}
	if err := arcadedb.CheckSchema(ctx, c); err != nil {
		t.Fatalf("CheckSchema: %v", err)
	}
}

func TestSeedRoundTripsTheFixtureAndRerunsSafely(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	repo := arcadedb.NewTopologyRepository(c)
	data, raw := mockTopology(t)

	for run := 1; run <= 2; run++ {
		if _, err := repo.ReplaceTopology(ctx, data, "fixture"); err != nil {
			t.Fatalf("import run %d: %v", run, err)
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

	// No duplicates after the rerun, and every derived edge exists exactly once.
	withParent, envEdges, carried, produced, consumed := 0, len(data.ServiceInstances), 0, 0, 0
	for _, r := range data.Resources {
		if r.ParentResourceID != nil {
			withParent++
		}
		if r.EnvironmentID != nil {
			envEdges++
		}
	}
	hosted := 0
	for _, i := range data.ServiceInstances {
		if i.ResourceID != nil {
			hosted++
		}
	}
	for _, e := range data.EventTypes {
		carried += len(e.ChannelResourceIDs)
		produced += len(e.ProducerServiceIDs)
		consumed += len(e.ConsumerServiceIDs)
	}
	want := map[string]int{
		"Environment": len(data.Environments), "ServiceDefinition": len(data.ServiceDefinitions),
		"ServiceInstance": len(data.ServiceInstances), "Resource": len(data.Resources), "EventType": len(data.EventTypes),
		"COMMUNICATES": len(data.Relationships), "CONTAINS": withParent, "HOSTED_IN": hosted,
		"INSTANCE_OF": len(data.ServiceInstances), "IN_ENVIRONMENT": envEdges,
		"CARRIED_ON": carried, "PRODUCED_BY": produced, "CONSUMED_BY": consumed,
	}
	for typ, n := range want {
		if got := count(t, c, typ); got != n {
			t.Errorf("%s: %d records, want %d", typ, got, n)
		}
	}
}

// Edge endpoints in the graph must agree with the canonical reference properties.
func TestEdgesMatchReferenceProperties(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	data, _ := mockTopology(t)
	if _, err := arcadedb.NewTopologyRepository(c).ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	ridToID := map[string]string{}
	for _, typ := range []string{"ServiceInstance", "Resource"} {
		rows, err := c.Query(ctx, "SELECT @rid AS rid, id FROM "+typ, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rows {
			ridToID[fmt.Sprint(r["rid"])] = fmt.Sprint(r["id"])
		}
	}
	rows, err := c.Query(ctx, "SELECT id, sourceEntityId, targetEntityId, @out AS o, @in AS i FROM COMMUNICATES", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if ridToID[fmt.Sprint(r["o"])] != r["sourceEntityId"] || ridToID[fmt.Sprint(r["i"])] != r["targetEntityId"] {
			t.Errorf("edge %v: graph %s→%s, properties %v→%v", r["id"], ridToID[fmt.Sprint(r["o"])], ridToID[fmt.Sprint(r["i"])], r["sourceEntityId"], r["targetEntityId"])
		}
	}
	rows, err = c.Query(ctx, "SELECT @out AS o, @in AS i FROM CONTAINS", nil)
	if err != nil {
		t.Fatal(err)
	}
	parent := map[string]string{}
	for _, r := range data.Resources {
		if r.ParentResourceID != nil {
			parent[r.ID] = *r.ParentResourceID
		}
	}
	for _, r := range rows {
		child, par := ridToID[fmt.Sprint(r["i"])], ridToID[fmt.Sprint(r["o"])]
		if parent[child] != par {
			t.Errorf("CONTAINS %s→%s, but parentResourceId of %s is %q", par, child, child, parent[child])
		}
	}
}

func TestInvalidTopologyIsRejectedBeforeWriting(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	repo := arcadedb.NewTopologyRepository(c)
	data, raw := mockTopology(t)
	if _, err := repo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	broken, _ := mockTopology(t)
	broken.Relationships[0].TargetEntityID = "ghost"
	if _, err := repo.ReplaceTopology(ctx, broken, "fixture"); !arcadedb.IsValidation(err) {
		t.Fatalf("got %v, want a validation error", err)
	}
	got, err := repo.GetTopology(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, raw, got) // unchanged
}

// The database enforces ID uniqueness itself, independent of application validation, and a failed
// command rolls back the whole transaction.
func TestUniquenessAndRollbackAreEnforcedByTheDatabase(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	tx, err := c.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Command(ctx, "CREATE VERTEX Resource SET id = :id", map[string]any{"id": "dup"}); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Command(ctx, "CREATE VERTEX Resource SET id = :id", map[string]any{"id": "dup"})
	if !errors.Is(err, arcadedb.ErrConflict) {
		t.Fatalf("duplicate: got %v, want conflict", err)
	}
	if err := tx.Commit(ctx); err == nil {
		t.Fatal("commit after a failed command must fail")
	}
	if n := count(t, c, "Resource"); n != 0 {
		t.Fatalf("%d resources after rollback, want 0", n)
	}
}

func TestReadinessAndErrorsDoNotLeakSecrets(t *testing.T) {
	s := settings(t)
	ctx := context.Background()

	// Wrong password.
	bad := *s
	dir := t.TempDir()
	bad.PasswordFile = filepath.Join(dir, "pw")
	if err := os.WriteFile(bad.PasswordFile, []byte("wrong-password-123"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := arcadedb.NewClient(&bad)
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Exists(ctx)
	if !errors.Is(err, arcadedb.ErrAuth) || strings.Contains(err.Error(), "wrong-password") {
		t.Fatalf("got %v, want an auth error without the password", err)
	}

	// Unreachable server.
	down := *s
	down.BaseURL, _ = url.Parse("http://127.0.0.1:1")
	c, err = arcadedb.NewClient(&down)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Exists(ctx); !errors.Is(err, ports.ErrUnavailable) {
		t.Fatalf("got %v, want unavailable", err)
	}
}

func TestSnapshotAndLayoutRepositories(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	dir, _ := fixtures.Dir()
	snaps := arcadedb.NewSnapshotRepository(c)
	files, _ := filepath.Glob(filepath.Join(dir, "snapshots", "*.json"))
	for i := len(files) - 1; i >= 0; i-- { // insert newest first; List must still sort oldest first
		raw, _ := os.ReadFile(files[i])
		var s domain.Snapshot
		if err := fixtures.DecodeStrict(raw, &s); err != nil {
			t.Fatal(err)
		}
		if err := snaps.Save(ctx, &s); err != nil {
			t.Fatal(err)
		}
		if err := snaps.Save(ctx, &s); !errors.Is(err, ports.ErrConflict) {
			t.Fatalf("duplicate snapshot: %v", err)
		}
		got, err := snaps.Get(ctx, s.ID)
		if err != nil {
			t.Fatal(err)
		}
		sameJSON(t, raw, got)
	}
	list, err := snaps.List(ctx, ports.SnapshotQuery{})
	if err != nil || len(list) != len(files) || list[0].ID != "fixture-0600" {
		t.Fatalf("list: %v %+v", err, list)
	}
	if _, err := snaps.Get(ctx, "ghost"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("missing snapshot: %v", err)
	}

	layouts := arcadedb.NewLayoutRepository(c)
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

// The bounded subgraph fetched with TRAVERSE must give exactly the client's results (computed on the
// full in-memory graph) for every start entity, direction, and depth bound.
func TestTraversalOnTheDatabaseEqualsTheFullGraph(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	dir, _ := fixtures.Dir()
	for _, file := range []string{"mock.v1.json", "scale-250.v1.json"} {
		data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := arcadedb.NewTopologyRepository(c).ReplaceTopology(ctx, data, "fixture"); err != nil {
			t.Fatal(err)
		}
		full := domain.BuildIndex(data)
		svc := &application.Service{TopologyRepo: arcadedb.NewTopologyRepository(c), GraphRepo: arcadedb.NewGraphRepository(c)}
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
}

// A cached reader must see an import made through another repository (another process, e.g. seed).
func TestReadCacheFollowsImportsFromElsewhere(t *testing.T) {
	c := tempClient(t)
	ctx := context.Background()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		t.Fatal(err)
	}
	data, _ := mockTopology(t)
	writer, reader := arcadedb.NewTopologyRepository(c), arcadedb.NewTopologyRepository(c)
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
