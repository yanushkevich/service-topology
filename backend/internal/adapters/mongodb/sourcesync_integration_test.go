//go:build integration

package mongodb_test

import (
	"errors"
	"testing"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Source syncs on the database (ADR-034): a batch applies atomically with one revision, created
// entities record their source, a replace keeps it, and aliases are revision-guarded.
func TestSourceWritesOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	topo := mongodb.NewTopologyRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	_, rev, err := topo.CurrentTopology(ctx)
	if err != nil {
		t.Fatal(err)
	}
	prod := "production"
	cluster := &domain.InfrastructureResource{ID: "dt-main-k8s_cluster-1", Name: "prod-eu-1", Type: "cluster", Provider: "unknown", EnvironmentID: &prod}
	team := "Payments"
	changes := []ports.EntityChange{
		{Op: ports.OpCreate, Kind: domain.KindResource, ID: cluster.ID, Entity: cluster},
		{Op: ports.OpReplace, Kind: domain.KindServiceDefinition, ID: "payment-service", Entity: &domain.ServiceDefinition{ID: "payment-service", Name: "Payment Service", Team: &team, Category: "api", Protocols: []string{"grpc"},
			Metadata: map[string]any{"dynatrace": map[string]any{"name": "payment-service"}}}},
	}
	next, err := topo.ApplyChanges(ctx, changes, rev, "dynatrace")
	if err != nil || next == rev {
		t.Fatalf("apply: %q %v", next, err)
	}
	sources, err := topo.SourceTypes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if sources[cluster.ID] != "dynatrace" || sources["payment-service"] != "fixture" {
		t.Errorf("sources: created %q, replaced %q (a replace keeps the creator)", sources[cluster.ID], sources["payment-service"])
	}
	stored, _, _ := topo.CurrentTopology(ctx)
	if n := len(stored.Resources); n != len(data.Resources)+1 || stored.Resources[n-1].ID != cluster.ID {
		t.Errorf("the created resource goes last: %d resources", n)
	}

	// All or nothing: a batch whose last change fails leaves no trace.
	bad := []ports.EntityChange{
		{Op: ports.OpCreate, Kind: domain.KindEnvironment, ID: "qa", Entity: &domain.Environment{ID: "qa", Name: "QA", Kind: "other"}},
		{Op: ports.OpDelete, Kind: domain.KindResource, ID: "does-not-exist"},
	}
	if _, err := topo.ApplyChanges(ctx, bad, next, "dynatrace"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("failing batch: %v", err)
	}
	after, rev2, _ := topo.CurrentTopology(ctx)
	if rev2 != next || len(after.Environments) != len(data.Environments) {
		t.Errorf("a failed batch changed the topology (revision %q → %q)", next, rev2)
	}
	if _, err := topo.ApplyChanges(ctx, changes[:1], rev, "dynatrace"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Errorf("stale revision: %v", err)
	}
}

func TestIntegrationRepositoryOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewIntegrationRepository(s)
	aliases, rev, err := repo.Aliases(ctx, "dynatrace")
	if err != nil || len(aliases) != 0 || rev != "0" {
		t.Fatalf("empty: %v %q %v", aliases, rev, err)
	}
	if err := repo.SaveLastSync(ctx, "dynatrace", &ports.SyncRecord{AppliedAt: "2026-10-15T08:45:00Z", Revision: "r1", Summary: map[string]map[string]int{"resource": {"create": 3}}}); err != nil {
		t.Fatal(err)
	}
	rev, err = repo.SaveAliases(ctx, "dynatrace", map[string]domain.EntityID{"com.example.Payment$Svc": "payment-service"}, "0")
	if err != nil || rev != "1" {
		t.Fatalf("first save after a sync record: %q %v", rev, err)
	}
	if _, err := repo.SaveAliases(ctx, "dynatrace", map[string]domain.EntityID{}, "0"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("stale save: %v", err)
	}
	aliases, rev, _ = repo.Aliases(ctx, "dynatrace")
	if rev != "1" || aliases["com.example.Payment$Svc"] != "payment-service" {
		t.Errorf("read back: %v %q", aliases, rev)
	}
	last, err := repo.LastSync(ctx, "dynatrace")
	if err != nil || last == nil || last.Revision != "r1" || last.Summary["resource"]["create"] != 3 {
		t.Errorf("last sync: %+v %v", last, err)
	}
	if none, err := repo.LastSync(ctx, "other"); none != nil || err != nil {
		t.Errorf("unknown source: %+v %v", none, err)
	}
}

// The observation overlay round-trips, including entity IDs with dots.
func TestObservationsOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewIntegrationRepository(s)
	if none, err := repo.LoadObservations(ctx, "dynatrace"); none != nil || err != nil {
		t.Fatalf("empty: %+v %v", none, err)
	}
	latency := 210.0
	overlay := &ports.ObservationOverlay{Source: "dynatrace", ObservedAt: "2026-10-15T08:46:00Z", Entities: map[domain.EntityID]ports.ObservedState{
		"payment-service.production":     {Health: "degraded", Problems: []string{"P-1"}, Metrics: &domain.Metrics{LatencyMs: &latency}},
		"dt-main-db_database_postgres-1": {Health: "healthy"},
	}}
	if err := repo.SaveObservations(ctx, overlay); err != nil {
		t.Fatal(err)
	}
	overlay.ObservedAt = "2026-10-15T08:47:00Z"
	if err := repo.SaveObservations(ctx, overlay); err != nil {
		t.Fatal(err)
	}
	got, err := repo.LoadObservations(ctx, "dynatrace")
	if err != nil || got.ObservedAt != "2026-10-15T08:47:00Z" || len(got.Entities) != 2 {
		t.Fatalf("read back: %+v %v", got, err)
	}
	if p := got.Entities["payment-service.production"]; p.Health != "degraded" || *p.Metrics.LatencyMs != 210 || p.Problems[0] != "P-1" {
		t.Errorf("payment = %+v", p)
	}
}
