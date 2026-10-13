//go:build integration

package mongodb_test

import (
	"errors"
	"testing"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Board definitions on the database: revisions bump atomically, stale and missing writes are told
// apart, and the stored definition round-trips (ADR-031).
func TestBoardRepositoryOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	repo := mongodb.NewBoardRepository(s)
	db := domain.EntityID("rds-orders-prod")
	def := &domain.BoardDefinition{
		ServiceDefinitionID: "order-service",
		Stations: []domain.BoardStation{
			{ID: "caller:gw", Name: "API Gateway", Kind: "caller"},
			{ID: "dep:db", Name: "orders-db", Kind: "dependency", EntityID: &db},
		},
		Lines:    []domain.BoardLine{{ID: "H1", Code: "H1", Name: "POST /v1/orders", Group: "http", Signature: "POST /v1/orders", Caller: "API Gateway", Route: []domain.BoardBranch{{Stations: []string{"caller:gw", "dep:db"}, Kind: "sequential"}}, Patterns: []string{}}},
		Policies: []domain.BoardPolicy{},
		Tables:   []domain.BoardTable{{ID: "orders", StationID: "dep:db", Name: "orders", Writes: []string{"H1"}, Reads: []string{}}},
	}

	if _, err := repo.Get(ctx, "order-service"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("empty: %v", err)
	}
	created, err := repo.Create(ctx, def, "2026-10-12T08:00:00Z")
	if err != nil || created.Revision != "1" {
		t.Fatalf("create: %v %+v", err, created)
	}
	if _, err := repo.Create(ctx, def, "2026-10-12T08:00:00Z"); !errors.Is(err, ports.ErrConflict) {
		t.Fatalf("second create: %v", err)
	}
	def.Lines[0].Name = "Place an order"
	replaced, err := repo.Replace(ctx, def, "1", "2026-10-12T09:00:00Z")
	if err != nil || replaced.Revision != "2" || replaced.UpdatedAt != "2026-10-12T09:00:00Z" {
		t.Fatalf("replace: %v %+v", err, replaced)
	}
	if _, err := repo.Replace(ctx, def, "1", "2026-10-12T10:00:00Z"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("stale replace: %v", err)
	}
	unguarded, err := repo.Replace(ctx, def, "", "2026-10-12T10:00:00Z")
	if err != nil || unguarded.Revision != "3" {
		t.Fatalf("unguarded replace: %v %+v", err, unguarded)
	}
	got, err := repo.Get(ctx, "order-service")
	if err != nil || got.Revision != "3" || got.Definition.Lines[0].Name != "Place an order" || *got.Definition.Stations[1].EntityID != "rds-orders-prod" {
		t.Fatalf("read back: %v %+v", err, got)
	}
	list, err := repo.List(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %d", err, len(list))
	}
	if err := repo.Remove(ctx, "order-service", "2"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("stale remove: %v", err)
	}
	if err := repo.Remove(ctx, "order-service", "3"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := repo.Remove(ctx, "order-service", ""); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("remove missing: %v", err)
	}
	if _, err := repo.Replace(ctx, def, "", "2026-10-12T11:00:00Z"); !errors.Is(err, ports.ErrNotFound) {
		t.Fatalf("replace missing: %v", err)
	}
}
