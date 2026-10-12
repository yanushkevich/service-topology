// Package ports declares the interfaces application services depend on. Adapters (MongoDB since
// ADR-019, in-memory fakes in tests) implement them. They mirror the frontend repositories
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

// ErrPreconditionFailed reports a write whose expected topology revision is no longer current
// (another write happened since it was read). HTTP maps it to 412.
var ErrPreconditionFailed = errors.New("topology revision changed")

// Write operations on one canonical entity (ADR-020).
const (
	OpCreate  = "create"
	OpReplace = "replace"
	OpDelete  = "delete"
)

// EntityChange is one validated change to the canonical topology. Entity is the domain value
// (*domain.Environment, …, *domain.EventType); nil for deletes.
type EntityChange struct {
	Op     string
	Kind   string // a domain.WritableKinds value
	ID     domain.EntityID
	Entity any
}

// TopologyWriter changes the canonical topology one entity at a time (ADR-020). The application
// validates the whole resulting topology first; the adapter applies the change atomically, only if
// the stored revision still equals expectedRevision, and stores a new revision with it.
type TopologyWriter interface {
	// CurrentTopology returns the whole topology with the revision it belongs to. The data is shared
	// and read-only.
	CurrentTopology(ctx context.Context) (*domain.TopologyData, string, error)
	// ApplyChange applies change and returns the new revision. ErrPreconditionFailed if the revision
	// moved; ErrConflict if a created ID exists; ErrNotFound if a replaced or deleted ID does not.
	ApplyChange(ctx context.Context, change EntityChange, expectedRevision, sourceType string) (string, error)
}

// TopologyMeta describes the stored topology (GET /meta). SourceType says where it came from
// ("fixture" for seeded mock data); only observed sources are not mock.
type TopologyMeta struct {
	Revision   string `json:"revision"`
	RecordedAt string `json:"recordedAt"`
	SourceType string `json:"sourceType"`
	IsMock     bool   `json:"isMock"`
}

// TopologyMetaRepository is implemented by topology repositories that can describe their data.
type TopologyMetaRepository interface {
	TopologyMeta(ctx context.Context) (*TopologyMeta, error)
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

// Traversal directions over communication relationships.
const (
	DirectionUpstream   = "upstream"   // follow outgoing relationships (what it depends on)
	DirectionDownstream = "downstream" // follow incoming relationships (what depends on it)
	DirectionBoth       = "both"       // undirected (neighborhoods)
)

// ErrTooLarge reports a traversal that would visit more entities than the server allows.
var ErrTooLarge = errors.New("traversal too large")

// Subgraph is the part of the communication graph within a bounded distance of a start entity:
// every entity reachable in at most MaxDepth hops in the given direction, and every relationship
// between them. Shortest paths of length <= MaxDepth computed on it equal those on the full graph.
type Subgraph struct {
	StartID       domain.EntityID
	EntityIDs     []domain.EntityID
	Relationships []domain.CommunicationRelationship
}

// GraphRepository answers bounded graph questions in the database instead of loading the whole
// topology (docs/backend/PERSISTENCE.md "Query routing").
type GraphRepository interface {
	// Subgraph returns the bounded subgraph around startID; ErrNotFound if startID is not a service
	// instance or resource; ErrTooLarge if more than maxEntities would be visited.
	Subgraph(ctx context.Context, startID domain.EntityID, direction string, maxDepth, maxEntities int) (*Subgraph, error)
}

// SimulationRepository stores simulation runs with their events and telemetry. A run and its
// records are written together and removed together by retention.
type SimulationRepository interface {
	Save(ctx context.Context, run *domain.SimulationRun, events []domain.StoredEvent, telemetry []domain.TelemetryObservation) error
	Get(ctx context.Context, id string) (*domain.SimulationRun, error)
	// List returns runs newest first.
	List(ctx context.Context, limit int) ([]domain.SimulationRun, error)
	// Events returns a run's events in sequence order, optionally filtered by entity and type.
	Events(ctx context.Context, simulationID, entityID, eventType string) ([]domain.StoredEvent, error)
	// Telemetry returns a run's observations in sequence order, optionally filtered.
	Telemetry(ctx context.Context, simulationID, subjectID, metricName string) ([]domain.TelemetryObservation, error)
	// Prune deletes runs created before olderThan (RFC 3339) and, beyond keep, the oldest ones,
	// with their events and telemetry. Returns how many runs were removed.
	Prune(ctx context.Context, olderThan string, keep int) (int, error)
}

// ReadinessCheck is one dependency checked by GET /readyz. Messages must not reveal connection
// details or credentials.
type ReadinessCheck interface {
	Name() string
	Check(ctx context.Context) error
}
