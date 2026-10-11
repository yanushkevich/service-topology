package domain

// Provenance of stored data (DOMAIN_MODEL.md "Metrics and provenance"). The API exposes it directly
// on events and telemetry, and as isSimulated (true unless observed) on metrics. Persisting data
// never changes its provenance.
const (
	ProvenanceMock      = "mock"
	ProvenanceSimulated = "simulated"
	ProvenanceObserved  = "observed"
	ProvenanceImported  = "imported"
)

// IsSimulatedProvenance maps provenance to the API's isSimulated flag.
func IsSimulatedProvenance(p string) bool { return p != ProvenanceObserved }

// SimulationAction is one step of a simulation run (POST /simulations).
type SimulationAction struct {
	Type          string `json:"type"` // inject, recover, recoverAll, step, reset
	EntityID      string `json:"entityId,omitempty"`
	Mode          string `json:"mode,omitempty"`
	DurationTicks int    `json:"durationTicks,omitempty"`
	Ticks         int    `json:"ticks,omitempty"`
}

// SimulationRequest describes an isolated, bounded simulation run.
type SimulationRequest struct {
	Seed            *uint32            `json:"seed,omitempty"`
	StartAt         string             `json:"startAt,omitempty"`
	Actions         []SimulationAction `json:"actions"`
	Watch           []EntityID         `json:"watch,omitempty"`
	CaptureSnapshot bool               `json:"captureSnapshot,omitempty"`
	Label           string             `json:"label,omitempty"`
}

// SimulationRun is the stored result of a run. It never changes the canonical topology.
type SimulationRun struct {
	ID              string             `json:"id"`
	CreatedAt       string             `json:"createdAt"`
	Label           string             `json:"label,omitempty"`
	Seed            uint32             `json:"seed"`
	StartAt         string             `json:"startAt"`
	Actions         []SimulationAction `json:"actions"`
	Watch           []EntityID         `json:"watch"`
	Tick            int                `json:"tick"`
	Clock           string             `json:"clock"`
	Failures        []map[string]any   `json:"failures"`
	Impacts         []Impact           `json:"impacts"`
	EventCount      int                `json:"eventCount"`
	EventsTruncated bool               `json:"eventsTruncated"`
	TelemetryCount  int                `json:"telemetryCount"`
	SnapshotID      *string            `json:"snapshotId"`
	Provenance      string             `json:"provenance"`
	IsSimulated     bool               `json:"isSimulated"`
}

// StoredEvent is a topology event with its run and provenance.
type StoredEvent struct {
	SimulationID string         `json:"simulationId"`
	Seq          int            `json:"seq"`
	Provenance   string         `json:"provenance"`
	RecordedAt   string         `json:"recordedAt"`
	Event        map[string]any `json:"event"`
}

// TelemetryObservation is one metric value at a (simulated) time.
type TelemetryObservation struct {
	SimulationID string  `json:"simulationId"`
	Seq          int     `json:"seq"`
	SubjectID    string  `json:"subjectId"`
	MetricName   string  `json:"metricName"` // latencyMs, throughputPerSecond, errorRatePercent
	Value        float64 `json:"value"`
	Unit         string  `json:"unit"`
	ObservedAt   string  `json:"observedAt"`
	RecordedAt   string  `json:"recordedAt"`
	Provenance   string  `json:"provenance"`
	IsSimulated  bool    `json:"isSimulated"`
}
