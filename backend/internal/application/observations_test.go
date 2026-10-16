package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// syncedService applies the stub discovery, then observes payment as degraded with metrics.
func syncedService(t *testing.T) (*Service, *stubSource, *time.Time) {
	t.Helper()
	ctx := context.Background()
	svc, _, src := syncService(t, empty())
	clock := time.Date(2026, 10, 15, 8, 45, 0, 0, time.UTC)
	svc.Now = func() time.Time { return clock }
	p, err := svc.PreviewSync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplySync(ctx, p.ID, ""); err != nil {
		t.Fatal(err)
	}
	latency, rate := 210.0, 0.5
	src.obs = &ports.Observation{ObservedAt: now, Tenants: map[string]map[string]ports.ObservedState{"main": {
		"SERVICE-2": {Health: "degraded", Problems: []string{"P-1"}, Metrics: &domain.Metrics{LatencyMs: &latency, ErrorRatePercent: &rate, IsSimulated: false, ObservedAt: strPtr(now)}},
		"SERVICE-1": {Health: "healthy"},
		"DB-1":      {Health: "unavailable", Problems: []string{"P-2"}},
		// Metrics on calls (Milestone 15.2): a relationship has no observed health.
		"calls:SERVICE-1->SERVICE-2": {Metrics: &domain.Metrics{ThroughputPerSecond: &rate, IsSimulated: false, ObservedAt: strPtr(now)}},
	}}}
	return svc, src, &clock
}

func instance(t *testing.T, data *domain.TopologyData, id string) domain.ServiceInstance {
	t.Helper()
	for _, e := range data.ServiceInstances {
		if e.ID == id {
			return e
		}
	}
	t.Fatalf("no instance %s", id)
	return domain.ServiceInstance{}
}

func TestObservationsOverlayReadsWithoutARevision(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := syncedService(t)
	_, before, _ := svc.TopologyRevision(ctx, "")
	if err := svc.RefreshObservations(ctx); err != nil {
		t.Fatal(err)
	}
	data, after, err := svc.TopologyRevision(ctx, "")
	if err != nil || after != before {
		t.Fatalf("a refresh must not create a revision: %q → %q (%v)", before, after, err)
	}
	payment := instance(t, data, "payment.production")
	if payment.Health != "degraded" || payment.Metrics == nil || payment.Metrics.IsSimulated || *payment.Metrics.LatencyMs != 210 {
		t.Errorf("payment = %+v", payment)
	}
	link := payment.Metadata["dynatrace"].(map[string]any)
	if link["observedAt"] != now || len(link["problems"].([]string)) != 1 || link["id"] != "SERVICE-2" {
		t.Errorf("link = %v", link)
	}
	for _, r := range data.Resources {
		if r.ID == "dt-main-db" && (r.Health == nil || *r.Health != "unavailable") {
			t.Errorf("database health = %v", r.Health)
		}
	}
	// The index (registry, traversal, impact) sees the same health.
	got, err := svc.Entity(ctx, domain.KindServiceInstance, "payment.production")
	if err != nil || got.(*domain.ServiceInstance).Health != "degraded" {
		t.Errorf("entity = %+v, %v", got, err)
	}
	status, _ := svc.SourceStatus(ctx)
	if status.LastRefresh == nil || !status.LastRefresh.OK || status.LastRefresh.Entities != 4 || status.Observations == nil || status.Observations.Stale {
		t.Errorf("status = %+v %+v", status.LastRefresh, status.Observations)
	}
}

func TestCallMetricsReachRelationships(t *testing.T) {
	ctx := context.Background()
	svc, src, _ := syncedService(t)
	src.obs.Warnings = []string{"Metrics on calls (tenant main): the query timed out"}
	if err := svc.RefreshObservations(ctx); err != nil {
		t.Fatal(err)
	}
	data, _, _ := svc.TopologyRevision(ctx, "")
	for _, r := range data.Relationships {
		switch r.ID {
		case "rel:checkout.production->payment.production":
			if r.Metrics == nil || r.Metrics.IsSimulated || *r.Metrics.ThroughputPerSecond != 0.5 || r.Status != "active" {
				t.Errorf("call = %+v (status stays as stored)", r)
			}
		case "rel:payment.production->dt-main-db":
			if r.Metrics != nil {
				t.Errorf("a database call has no span metrics: %+v", r.Metrics)
			}
		}
	}
	status, _ := svc.SourceStatus(ctx)
	if !status.LastRefresh.OK || len(status.LastRefresh.Warnings) != 1 {
		t.Errorf("refresh = %+v", status.LastRefresh)
	}
}

func TestStaleObservationsAreNotShown(t *testing.T) {
	ctx := context.Background()
	svc, _, clock := syncedService(t)
	if err := svc.RefreshObservations(ctx); err != nil {
		t.Fatal(err)
	}
	*clock = clock.Add(4 * time.Minute) // three 60 s intervals have passed
	data, _, _ := svc.TopologyRevision(ctx, "")
	if payment := instance(t, data, "payment.production"); payment.Health != "unknown" || payment.Metrics != nil {
		t.Errorf("a stale overlay was merged: %+v", payment)
	}
	if meta, _ := svc.Meta(ctx, 3, "none"); meta.Observations == nil || !meta.Observations.Stale {
		t.Errorf("meta must say the overlay is stale: %+v", meta.Observations)
	}
}

func TestWritesNeverStoreObservedValues(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := syncedService(t)
	if err := svc.RefreshObservations(ctx); err != nil {
		t.Fatal(err)
	}
	// An editor saves what it read: observed health, metrics, and the overlay's link fields.
	data, rev, _ := svc.TopologyRevision(ctx, "")
	edited := instance(t, data, "payment.production")
	edited.Version = strPtr("2.0.0")
	if _, err := svc.ReplaceEntity(ctx, domain.KindServiceInstance, edited.ID, &edited, rev); err != nil {
		t.Fatal(err)
	}
	w, _ := svc.writer()
	stored, _, _ := w.CurrentTopology(ctx)
	got := instance(t, stored, "payment.production")
	link := got.Metadata["dynatrace"].(map[string]any)
	if got.Health != "unknown" || got.Metrics != nil || *got.Version != "2.0.0" || link["problems"] != nil || link["observedAt"] != nil {
		t.Errorf("stored = %+v, link %v", got, link)
	}
}

func TestRefreshFailureIsRecordedAndOverlayRestored(t *testing.T) {
	ctx := context.Background()
	svc, src, _ := syncedService(t)
	if err := svc.RefreshObservations(ctx); err != nil {
		t.Fatal(err)
	}
	src.err = errors.Join(ports.ErrSourceFailed, errors.New("Dynatrace answered 503"))
	if err := svc.RefreshObservations(ctx); err == nil {
		t.Fatal("want the source failure")
	}
	status, _ := svc.SourceStatus(ctx)
	if status.LastRefresh.OK || status.LastRefresh.Error == "" {
		t.Errorf("refresh = %+v", status.LastRefresh)
	}
	// A restarted server restores the stored overlay.
	restarted := &Service{TopologyRepo: svc.TopologyRepo, Now: svc.Now}
	restarted.Sync = NewSourceSync(src, svc.Sync.Store)
	if err := restarted.LoadObservations(ctx); err != nil {
		t.Fatal(err)
	}
	data, _, _ := restarted.TopologyRevision(ctx, "")
	if instance(t, data, "payment.production").Health != "degraded" {
		t.Error("the stored overlay was not restored")
	}
}

// Two Dynatrace services with one name are one instance: its state merges theirs.
func TestMergedServicesShareTheirObservations(t *testing.T) {
	latency := 120.0
	obs := &ports.Observation{Tenants: map[string]map[string]ports.ObservedState{"main": {
		"SERVICE-A": {Health: "healthy"},
		"SERVICE-B": {Health: "degraded", Problems: []string{"P-9"}, Metrics: &domain.Metrics{LatencyMs: &latency}},
	}}}
	link := map[string]any{"tenant": "main", "id": "SERVICE-A", "also": []any{map[string]any{"tenant": "main", "id": "SERVICE-B"}}}
	state, ok := mergedState(obs, link)
	if !ok || state.Health != "degraded" || state.Metrics == nil || *state.Metrics.LatencyMs != 120 || len(state.Problems) != 1 {
		t.Errorf("merged = %+v", state)
	}
	if _, ok := mergedState(obs, map[string]any{"tenant": "main", "id": "SERVICE-Z"}); ok {
		t.Error("an unobserved link has no state")
	}
}
