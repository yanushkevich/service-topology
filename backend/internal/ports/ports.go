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

// ErrConflict reports a duplicate stable ID (e.g. creating a snapshot or layout that exists).
var ErrConflict = errors.New("conflict")

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
	// Save stores a new snapshot; an existing ID is ErrConflict, never an overwrite.
	Save(ctx context.Context, s *domain.Snapshot) error
}

// SavedLayoutRepository stores presentation layouts. The frontend's single save() maps to Create
// (POST, new ID) and Replace (PUT, existing ID).
type SavedLayoutRepository interface {
	// List returns layouts, newest first (createdAt descending, then ID).
	List(ctx context.Context) ([]domain.SavedLayout, error)
	// Create stores a new layout; ErrConflict if the ID exists.
	Create(ctx context.Context, l *domain.SavedLayout) error
	// Replace overwrites an existing layout; ErrNotFound if the ID does not exist.
	Replace(ctx context.Context, l *domain.SavedLayout) error
	// Remove deletes a layout; ErrNotFound if the ID does not exist.
	Remove(ctx context.Context, id string) error
}

// ReadinessCheck is one dependency checked by GET /readyz. Messages must not reveal connection
// details or credentials.
type ReadinessCheck interface {
	Name() string
	Check(ctx context.Context) error
}
