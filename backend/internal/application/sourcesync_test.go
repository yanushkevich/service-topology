package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/memory"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// stubSource returns a fixed discovery and observation (or an error), recording the aliases it
// was given.
type stubSource struct {
	data    *domain.TopologyData
	obs     *ports.Observation
	err     error
	aliases map[string]domain.EntityID
	block   chan struct{}
}

func (s *stubSource) Name() string { return "dynatrace" }
func (s *stubSource) Discover(_ context.Context, aliases map[string]domain.EntityID) (*ports.Discovery, error) {
	s.aliases = aliases
	if s.block != nil {
		<-s.block
	}
	if s.err != nil {
		return nil, s.err
	}
	return &ports.Discovery{Data: *cloneTopology(s.data), Notes: []ports.DiscoveryNote{}, DiscoveredAt: now}, nil
}
func (s *stubSource) Observe(context.Context) (*ports.Observation, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.obs, nil
}
func (s *stubSource) Check(context.Context) []ports.SourceCheck { return nil }
func (s *stubSource) Describe() ports.SourceDescription {
	return ports.SourceDescription{RefreshIntervalSeconds: 60}
}

func syncService(t *testing.T, stored *domain.TopologyData) (*Service, *memory.Store, *stubSource) {
	t.Helper()
	store := memory.New(stored)
	src := &stubSource{data: discovered()}
	clock := time.Date(2026, 10, 15, 8, 45, 0, 0, time.UTC)
	svc := &Service{TopologyRepo: store, BoardRepo: store.Boards(), Now: func() time.Time { return clock }}
	svc.Sync = NewSourceSync(src, store.Integrations())
	return svc, store, src
}

func TestPreviewAndApplySync(t *testing.T) {
	ctx := context.Background()
	svc, store, _ := syncService(t, empty())
	p, err := svc.PreviewSync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !p.CanApply || p.Summary[domain.KindServiceInstance][SyncCreate] != 2 || len(p.Changes) != 9 || p.BaseRevision != "memory-0" {
		t.Fatalf("preview = %+v", p)
	}
	res, err := svc.ApplySync(ctx, p.ID, p.BaseRevision)
	if err != nil {
		t.Fatal(err)
	}
	if res.Revision != "memory-1" || len(store.Data.ServiceInstances) != 2 {
		t.Errorf("applied = %+v, %d instances", res, len(store.Data.ServiceInstances))
	}
	sources, _ := store.SourceTypes(ctx)
	if sources["payment.production"] != "dynatrace" {
		t.Errorf("created entities must be owned by the source: %v", sources)
	}
	status, err := svc.SourceStatus(ctx)
	if err != nil || status.LastSync == nil || status.LastSync.Revision != "memory-1" {
		t.Errorf("status = %+v, %v", status, err)
	}
	again, err := svc.PreviewSync(ctx)
	if err != nil || len(again.Changes) != 0 {
		t.Errorf("second preview = %+v, %v", again, err)
	}
	if _, err := svc.ApplySync(ctx, p.ID, ""); !errors.Is(err, ports.ErrNotFound) {
		t.Errorf("a preview applies once: %v", err)
	}
}

func TestApplyRefusesAMovedTopology(t *testing.T) {
	ctx := context.Background()
	svc, _, _ := syncService(t, empty())
	p, _ := svc.PreviewSync(ctx)
	if _, err := svc.CreateEntity(ctx, domain.KindEnvironment, &domain.Environment{ID: "qa", Name: "QA", Kind: "other"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplySync(ctx, p.ID, ""); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Errorf("err = %v, want a precondition failure", err)
	}
	p, _ = svc.PreviewSync(ctx)
	if _, err := svc.ApplySync(ctx, p.ID, "stale"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Errorf("If-Match must equal the base revision: %v", err)
	}
}

func TestApplyRefusesAnExpiredOrInvalidPreview(t *testing.T) {
	ctx := context.Background()
	svc, _, src := syncService(t, empty())
	p, _ := svc.PreviewSync(ctx)
	svc.Now = func() time.Time { return time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC) }
	if _, err := svc.ApplySync(ctx, p.ID, ""); !errors.Is(err, ErrPreviewExpired) {
		t.Errorf("err = %v, want expired", err)
	}
	// A discovery whose instance points at a resource it does not include cannot be applied.
	src.data.Resources = src.data.Resources[1:]
	p, _ = svc.PreviewSync(ctx)
	if p.CanApply || len(p.Issues) == 0 {
		t.Fatalf("preview = %+v", p)
	}
	var invalid *ErrValidation
	if _, err := svc.ApplySync(ctx, p.ID, ""); !errors.As(err, &invalid) {
		t.Errorf("err = %v, want validation", err)
	}
}

func TestSyncErrors(t *testing.T) {
	ctx := context.Background()
	if _, err := (&Service{}).PreviewSync(ctx); !errors.Is(err, ErrSourceNotConfigured) {
		t.Errorf("not configured: %v", err)
	}
	svc, _, src := syncService(t, empty())
	src.err = errors.Join(ports.ErrSourceFailed, errors.New("Dynatrace rejected the credentials (401)"))
	if _, err := svc.PreviewSync(ctx); !errors.Is(err, ports.ErrSourceFailed) {
		t.Errorf("source failure: %v", err)
	}
	src.err = nil
	src.block = make(chan struct{})
	done := make(chan struct{})
	go func() { _, _ = svc.PreviewSync(ctx); close(done) }()
	for svc.Sync.running.TryLock() {
		svc.Sync.running.Unlock()
		time.Sleep(time.Millisecond)
	}
	if _, err := svc.CheckSource(ctx); !errors.Is(err, ErrSourceBusy) {
		t.Errorf("busy: %v", err)
	}
	close(src.block)
	<-done
}

func TestAliasesAreRevisionGuardedAndValidated(t *testing.T) {
	ctx := context.Background()
	svc, _, src := syncService(t, empty())
	aliases, rev, err := svc.SourceAliases(ctx)
	if err != nil || len(aliases) != 0 || rev != "0" {
		t.Fatalf("aliases = %v %q %v", aliases, rev, err)
	}
	if _, err := svc.SaveSourceAliases(ctx, map[string]domain.EntityID{"PaymentService": "payment"}, ""); err == nil {
		t.Error("If-Match is required")
	}
	rev, err = svc.SaveSourceAliases(ctx, map[string]domain.EntityID{"PaymentService": "payment"}, "0")
	if err != nil || rev != "1" {
		t.Fatalf("save = %q %v", rev, err)
	}
	if _, err := svc.SaveSourceAliases(ctx, map[string]domain.EntityID{"x": "y"}, "0"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Errorf("stale revision: %v", err)
	}
	var invalid *ErrValidation
	if _, err := svc.SaveSourceAliases(ctx, map[string]domain.EntityID{"Bad": "has/slash"}, "1"); !errors.As(err, &invalid) {
		t.Errorf("invalid ID: %v", err)
	}
	if _, err := svc.PreviewSync(ctx); err != nil || src.aliases["PaymentService"] != "payment" {
		t.Errorf("the discovery must receive the aliases: %v %v", src.aliases, err)
	}
}
