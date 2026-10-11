package domain

// SnapshotSchemaVersion and SavedLayoutSchemaVersion are the persisted payload versions
// (docs/schemas/topology-snapshot.v1.schema.json, saved-layout.v1.schema.json).
const (
	SnapshotSchemaVersion    = 1
	SavedLayoutSchemaVersion = 1
)

// Snapshot sources. IsSimulated must be true unless the source is observed.
const (
	SnapshotSourceFixture    = "fixture"
	SnapshotSourceSimulation = "simulation"
	SnapshotSourceObserved   = "observed"
)

// SnapshotSummary is a history list entry.
type SnapshotSummary struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	TakenAt     string `json:"takenAt"`
	Source      string `json:"source"`
	IsSimulated bool   `json:"isSimulated"`
}

// Snapshot is an immutable topology at a point in time (TopologySnapshot v1).
type Snapshot struct {
	SchemaVersion int `json:"schemaVersion"`
	SnapshotSummary
	Data TopologyData `json:"data"`
}

// LayoutFilters are the shared filters saved with a layout.
type LayoutFilters struct {
	Query     string   `json:"query"`
	Providers []string `json:"providers"`
	Health    []string `json:"health"`
	Groups    []string `json:"groups"`
}

// LayoutView is the view state a layout restores.
type LayoutView struct {
	EnvironmentID     EntityID      `json:"environmentId"`
	LayoutMode        string        `json:"layoutMode"`
	Filters           LayoutFilters `json:"filters"`
	CollapsedGroupIDs []string      `json:"collapsedGroupIds"`
}

// Position is a saved node position.
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// SavedLayout is presentation state only (SavedLayout v1); never canonical topology.
type SavedLayout struct {
	SchemaVersion int                 `json:"schemaVersion"`
	ID            string              `json:"id"`
	Name          string              `json:"name"`
	CreatedAt     string              `json:"createdAt"`
	View          LayoutView          `json:"view"`
	Positions     map[string]Position `json:"positions"`
}
