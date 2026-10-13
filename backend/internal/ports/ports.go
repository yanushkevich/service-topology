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

// BundleImporter replaces the whole canonical topology and every stored transit board in one atomic
// step (ADR-032, POST /imports/bundle). The application validates first. An expectedRevision of ""
// skips the revision check; otherwise ErrPreconditionFailed if the stored revision moved.
type BundleImporter interface {
	ReplaceAll(ctx context.Context, data *domain.TopologyData, boards []domain.BoardDefinition, expectedRevision, sourceType, updatedAt string) (*ReplaceResult, error)
}

// ReplaceResult is what a bundle import stored: the new topology revision, documents per topology
// module (keyed like the bundle), and the number of boards.
type ReplaceResult struct {
	Revision  string         `json:"revision"`
	Documents map[string]int `json:"documents"`
	Boards    int            `json:"boards"`
}

// FlowMapping makes the import of workflow definitions explicit (ADR-022): which service runs each
// task, and which event type carries a hand-off. Nothing is guessed.
type FlowMapping struct {
	// Tasks maps a definition's task (or activity) ID to a service definition ID.
	Tasks map[string]string `json:"tasks,omitempty"`
	// Events maps a sequence- or message-flow ID (or "message:<messageRef>") to an event type ID.
	Events map[string]string `json:"events,omitempty"`
	// EntryPoints maps a task ID to the operation that implements it (optional).
	EntryPoints map[string]string `json:"entryPoints,omitempty"`
}

// FlowFormat decodes workflow definitions of one format into business flows (ADR-022). Adapters
// live in internal/adapters/flowformats. Decode returns an *ImportError for content it cannot map.
type FlowFormat interface {
	Name() string
	Decode(content []byte, mapping FlowMapping) ([]domain.BusinessFlow, error)
}

// ImportProblem is one reason a definition cannot be imported, naming the element at fault.
type ImportProblem struct {
	Element string
	Message string
}

// ImportError reports why a workflow definition cannot be imported (e.g. tasks without a service).
type ImportError struct{ Problems []ImportProblem }

func (e *ImportError) Error() string {
	if len(e.Problems) == 0 {
		return "the definition cannot be imported"
	}
	return e.Problems[0].Element + ": " + e.Problems[0].Message
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

// BoardRepository stores transit board definitions, one per service (ADR-031). Revisions guard
// writes: an ifRevision that is not current fails with ErrPreconditionFailed (empty skips the check).
type BoardRepository interface {
	// List returns every stored board, by service ID.
	List(ctx context.Context) ([]domain.StoredBoard, error)
	// Get returns the board of a service; ErrNotFound if none is stored.
	Get(ctx context.Context, serviceID domain.EntityID) (*domain.StoredBoard, error)
	// Create stores a new definition at revision "1"; ErrConflict if the service has one.
	Create(ctx context.Context, def *domain.BoardDefinition, updatedAt string) (*domain.StoredBoard, error)
	// Replace stores a new revision; ErrNotFound, or ErrPreconditionFailed when ifRevision is stale.
	Replace(ctx context.Context, def *domain.BoardDefinition, ifRevision, updatedAt string) (*domain.StoredBoard, error)
	// Remove deletes the board; ErrNotFound, or ErrPreconditionFailed when ifRevision is stale.
	Remove(ctx context.Context, serviceID domain.EntityID, ifRevision string) error
}
