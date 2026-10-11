// Package ports declares the interfaces application services depend on. Adapters (ArcadeDB in
// Milestone B2, in-memory fakes in tests) implement them. They mirror the frontend repositories
// (apps/web/src/data/**/…Repository.ts) that the HTTP API backs (`x-repository` in docs/api/openapi.json).
package ports

import (
	"context"
	"errors"

	"servicetopology/backend/internal/domain"
)

// ErrNotFound reports a missing entity, snapshot, or layout. Adapters wrap it.
var ErrNotFound = errors.New("not found")

// ErrUnavailable reports that a required dependency (the database) cannot be reached. HTTP maps it
// to 503; callers never treat a partial result as complete.
var ErrUnavailable = errors.New("dependency unavailable")

// TopologyRepository returns canonical topology data (GET /topology).
type TopologyRepository interface {
	// GetTopology returns the whole topology, or one environment's part when environmentID is not
	// empty (environment-independent resources are included in every environment).
	GetTopology(ctx context.Context, environmentID domain.EntityID) (*domain.TopologyData, error)
}

// SnapshotQuery bounds a history listing (GET /topology/snapshots?from=&to=).
type SnapshotQuery struct {
	From, To string // RFC 3339; empty = unbounded
}

// SnapshotRepository stores immutable topology snapshots.
type SnapshotRepository interface {
	// List returns summaries, oldest first.
	List(ctx context.Context, q SnapshotQuery) ([]domain.SnapshotSummary, error)
	Get(ctx context.Context, id string) (*domain.Snapshot, error)
	// Save stores a new snapshot; an existing ID is a conflict, never an overwrite.
	Save(ctx context.Context, s *domain.Snapshot) error
}

// SavedLayoutRepository stores presentation layouts.
type SavedLayoutRepository interface {
	// List returns layouts, newest first.
	List(ctx context.Context) ([]domain.SavedLayout, error)
	// Save inserts or replaces by ID.
	Save(ctx context.Context, l *domain.SavedLayout) error
	Remove(ctx context.Context, id string) error
}

// ReadinessCheck is one dependency checked by GET /readyz. Messages must not reveal connection
// details or credentials.
type ReadinessCheck interface {
	Name() string
	Check(ctx context.Context) error
}
