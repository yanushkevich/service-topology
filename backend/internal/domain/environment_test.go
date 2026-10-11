package domain_test

import (
	"testing"

	"servicetopology/backend/internal/domain"
)

func TestSortEnvironments(t *testing.T) {
	got := domain.SortEnvironments([]domain.Environment{
		{ID: "d", Name: "Dev", Kind: "development"}, {ID: "x", Name: "Sandbox", Kind: "other"},
		{ID: "p2", Name: "prod-eu", Kind: "production"}, {ID: "s", Name: "Staging", Kind: "staging"}, {ID: "p1", Name: "Prod-AU", Kind: "production"},
	})
	want := []string{"p1", "p2", "s", "d", "x"}
	for i, e := range got {
		if e.ID != want[i] {
			t.Fatalf("order %v", got)
		}
	}
}

func TestFilterEnvironmentKeepsAValidProjection(t *testing.T) {
	data, _ := loadMock(t)
	ix := domain.BuildIndex(data)
	for _, env := range []string{"production", "staging", "development"} {
		out, ok := ix.FilterEnvironment(env)
		if !ok {
			t.Fatalf("%s missing", env)
		}
		if issues := domain.Validate(out); len(issues) != 0 {
			t.Fatalf("%s projection invalid: %+v", env, issues[0])
		}
		for _, inst := range out.ServiceInstances {
			if *inst.EnvironmentID != env {
				t.Fatalf("%s: foreign instance %s", env, inst.ID)
			}
		}
		fx := domain.BuildIndex(out)
		for _, r := range out.Resources {
			if e, ok := ix.EnvironmentOf(r.ID); ok && e != env {
				t.Fatalf("%s: foreign resource %s", env, r.ID)
			}
			_ = fx
		}
	}
	if _, ok := ix.FilterEnvironment("ghost"); ok {
		t.Fatal("unknown environment accepted")
	}
	staging, _ := ix.FilterEnvironment("staging")
	if len(staging.EventTypes) != 3 || len(staging.EventTypes[0].ChannelResourceIDs) != 1 {
		t.Fatalf("staging event types: %+v", staging.EventTypes)
	}
}

func TestValidateSavedLayoutAndSnapshot(t *testing.T) {
	l := domain.SavedLayout{SchemaVersion: 1, ID: "l1", Name: "  On-call ", CreatedAt: "2026-10-11T09:00:00.000Z",
		View: domain.LayoutView{EnvironmentID: "production", LayoutMode: "topology", Filters: domain.LayoutFilters{Providers: []string{"aws"}}}}
	domain.NormalizeSavedLayout(&l)
	if issues := domain.ValidateSavedLayout(&l); len(issues) != 0 || l.Name != "On-call" {
		t.Fatalf("valid layout rejected: %+v", issues)
	}
	bad := l
	bad.View.LayoutMode, bad.CreatedAt, bad.View.Filters.Health = "3d", "yesterday", []string{"ok", "ok"}
	if n := len(domain.ValidateSavedLayout(&bad)); n != 5 { // layoutMode, createdAt, "ok" unknown ×2, repeated
		t.Fatalf("got %d issues, want 5", n)
	}
	data, _ := loadMock(t)
	s := domain.Snapshot{SchemaVersion: 1, SnapshotSummary: domain.SnapshotSummary{ID: "s1", Label: "x", TakenAt: "2026-10-11T06:00:00Z", Source: "fixture", IsSimulated: false}, Data: *data}
	if issues := domain.ValidateSnapshot(&s); len(issues) != 1 || issues[0].Code != domain.CodeInvalidSnapshot {
		t.Fatalf("fixture claiming observed-like isSimulated=false: %+v", issues)
	}
}
