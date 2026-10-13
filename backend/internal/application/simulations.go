package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
	"servicetopology/backend/internal/simulation"
)

// Simulation bounds (docs/backend/API_SPEC.md "Simulation", ADR-016).
const (
	MaxSimulationActions = 100
	MaxSimulationTicks   = 500
	MaxWatchedEntities   = 5
	MaxStoredEvents      = 5000
)

var metricUnits = []struct{ name, unit string }{{"latencyMs", "ms"}, {"throughputPerSecond", "1/s"}, {"errorRatePercent", "%"}}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) newID() string {
	if s.NewID != nil {
		return s.NewID()
	}
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("run-%d-%s", s.now().UnixMilli(), hex.EncodeToString(b[:]))
}

func invalidAction(i int, reason string) error {
	return &ErrInvalid{Param: fmt.Sprintf("actions[%d]", i), Reason: reason}
}

// RunSimulation runs the deterministic engine on a read-only copy of the canonical topology,
// stores the run with its events and watched telemetry (provenance "simulated"), optionally
// captures the final state as a "simulation" snapshot, and applies retention. The canonical
// topology is never modified.
func (s *Service) RunSimulation(ctx context.Context, req *domain.SimulationRequest) (*domain.SimulationRun, error) {
	if err := checkSimulationBounds(req); err != nil {
		return nil, err
	}
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	if err := checkSimulationActions(req, ix); err != nil {
		return nil, err
	}
	seed := uint32(1)
	if req.Seed != nil {
		seed = *req.Seed
	}
	rec := &runRecorder{runID: s.newID(), recordedAt: s.now().UTC().Format(time.RFC3339), watch: req.Watch, seenSeq: 1}
	state := simulation.Create(ix.Data, seed, req.StartAt)
	startAt := state.Clock
	if state, err = rec.replay(state, req); err != nil {
		return nil, err
	}
	run := rec.run(req, seed, startAt, state)
	if req.CaptureSnapshot {
		if run.SnapshotID, err = s.saveSimulatedSnapshot(ctx, run, state); err != nil {
			return nil, err
		}
	}
	if err := s.SimRepo.Save(ctx, run, rec.events, rec.telemetry); err != nil {
		return nil, err
	}
	s.pruneSimulations(ctx)
	return run, nil
}

// checkSimulationBounds checks the request's sizes and formats before anything is read.
func checkSimulationBounds(req *domain.SimulationRequest) error {
	if len(req.Actions) == 0 || len(req.Actions) > MaxSimulationActions {
		return &ErrInvalid{"actions", fmt.Sprintf("between 1 and %d actions", MaxSimulationActions)}
	}
	if len(req.Watch) > MaxWatchedEntities {
		return &ErrInvalid{"watch", fmt.Sprintf("at most %d entities", MaxWatchedEntities)}
	}
	if req.StartAt != "" && !validTime(req.StartAt) {
		return &ErrInvalid{"startAt", "must be an RFC 3339 date-time"}
	}
	if len(req.Label) > 200 {
		return &ErrInvalid{"label", "at most 200 characters"}
	}
	return nil
}

// checkSimulationActions checks every action and watched entity against the topology, and the
// total number of ticks.
func checkSimulationActions(req *domain.SimulationRequest, ix *domain.Index) error {
	exists := func(id string) bool { return ix.Instances[id] != nil || ix.Resources[id] != nil }
	ticks := 0
	for i, a := range req.Actions {
		switch a.Type {
		case "inject":
			if !exists(a.EntityID) {
				return invalidAction(i, fmt.Sprintf("unknown service instance or resource %q", a.EntityID))
			}
			if a.Mode != domain.FailureUnavailable && a.Mode != domain.FailureDegraded {
				return invalidAction(i, "mode must be unavailable or degraded")
			}
			if a.DurationTicks < 0 {
				return invalidAction(i, "durationTicks must not be negative")
			}
		case "recover":
			if !exists(a.EntityID) {
				return invalidAction(i, fmt.Sprintf("unknown service instance or resource %q", a.EntityID))
			}
		case "recoverAll", "reset":
		case "step":
			if a.Ticks < 1 {
				return invalidAction(i, "ticks must be at least 1")
			}
			ticks += a.Ticks
		default:
			return invalidAction(i, "type must be inject, recover, recoverAll, step, or reset")
		}
	}
	if ticks > MaxSimulationTicks {
		return &ErrInvalid{"actions", fmt.Sprintf("at most %d ticks in total", MaxSimulationTicks)}
	}
	for _, id := range req.Watch {
		if !exists(id) && ix.Relationships[id] == nil {
			return &ErrInvalid{"watch", fmt.Sprintf("unknown entity %q", id)}
		}
	}
	return nil
}

// runRecorder collects a run's events and the watched entities' telemetry as the actions replay.
type runRecorder struct {
	runID, recordedAt string
	watch             []domain.EntityID
	events            []domain.StoredEvent
	telemetry         []domain.TelemetryObservation
	eventsTruncated   bool
	seenSeq           int // the engine's next unseen event number
}

// replay applies the actions in order, collecting after each one (and after every tick of a step,
// so telemetry has one sample per tick).
func (rec *runRecorder) replay(state *simulation.State, req *domain.SimulationRequest) (*simulation.State, error) {
	var err error
	rec.collect(state)
	for _, a := range req.Actions {
		switch a.Type {
		case "inject":
			if state, err = state.Inject(a.EntityID, a.Mode, a.DurationTicks); err != nil {
				return nil, err
			}
			rec.collect(state)
		case "recover":
			state = state.Recover(a.EntityID)
			rec.collect(state)
		case "recoverAll":
			state = state.RecoverAll()
			rec.collect(state)
		case "reset":
			state = state.Reset(req.StartAt)
			rec.seenSeq = 1
			rec.collect(state)
		case "step":
			for t := 0; t < a.Ticks; t++ {
				state = state.Step(1)
				rec.collect(state)
			}
		}
	}
	return state, nil
}

// collect records the events added since the last collection (the engine keeps only its last
// MaxEvents) and one sample per metric of every watched entity.
func (rec *runRecorder) collect(state *simulation.State) {
	for _, e := range state.Events {
		n, _ := strconv.Atoi(strings.TrimPrefix(e.ID, "sim-"))
		if n < rec.seenSeq {
			continue
		}
		if len(rec.events) >= MaxStoredEvents {
			rec.eventsTruncated = true
			continue
		}
		// Seq numbers the whole run; the engine's own ID (which restarts after reset) stays in Event.
		rec.events = append(rec.events, domain.StoredEvent{SimulationID: rec.runID, Seq: len(rec.events) + 1, Provenance: domain.ProvenanceSimulated, RecordedAt: rec.recordedAt, Event: asMap(e)})
	}
	if state.EventSeq-rec.seenSeq > countFrom(state.Events, rec.seenSeq) {
		rec.eventsTruncated = true
	}
	rec.seenSeq = state.EventSeq
	for _, id := range rec.watch {
		m := metricsOf(state.Data, id)
		if m == nil {
			continue
		}
		values := []*float64{m.LatencyMs, m.ThroughputPerSecond, m.ErrorRatePercent}
		for k, mu := range metricUnits {
			if values[k] == nil {
				continue
			}
			rec.telemetry = append(rec.telemetry, domain.TelemetryObservation{SimulationID: rec.runID, Seq: len(rec.telemetry) + 1, SubjectID: id, MetricName: mu.name,
				Value: *values[k], Unit: mu.unit, ObservedAt: state.Clock, RecordedAt: rec.recordedAt, Provenance: domain.ProvenanceSimulated, IsSimulated: true})
		}
	}
}

// run summarizes the finished run; it is always marked simulated.
func (rec *runRecorder) run(req *domain.SimulationRequest, seed uint32, startAt string, state *simulation.State) *domain.SimulationRun {
	failures := []map[string]any{}
	for _, f := range state.Failures {
		failures = append(failures, asMap(f))
	}
	watch := req.Watch
	if watch == nil {
		watch = []domain.EntityID{}
	}
	actions := append([]domain.SimulationAction{}, req.Actions...)
	return &domain.SimulationRun{ID: rec.runID, CreatedAt: rec.recordedAt, Label: req.Label, Seed: seed, StartAt: startAt,
		Actions: actions, Watch: watch, Tick: state.Tick, Clock: state.Clock, Failures: failures, Impacts: state.Impacts,
		EventCount: len(rec.events), EventsTruncated: rec.eventsTruncated, TelemetryCount: len(rec.telemetry), Provenance: domain.ProvenanceSimulated, IsSimulated: true}
}

// saveSimulatedSnapshot stores the final simulated state as a snapshot with the run's ID.
func (s *Service) saveSimulatedSnapshot(ctx context.Context, run *domain.SimulationRun, state *simulation.State) (*string, error) {
	label := run.Label
	if label == "" {
		label = "Simulation " + run.ID
	}
	snap := &domain.Snapshot{SchemaVersion: domain.SnapshotSchemaVersion,
		SnapshotSummary: domain.SnapshotSummary{ID: run.ID, Label: label, TakenAt: state.Clock, Source: domain.SnapshotSourceSimulation, IsSimulated: true}, Data: *state.Data}
	if issues := domain.ValidateSnapshot(snap); len(issues) > 0 {
		return nil, fmt.Errorf("simulated state failed validation: %s %s", issues[0].Code, issues[0].Message)
	}
	if err := s.SnapshotRepo.Save(ctx, snap); err != nil {
		return nil, err
	}
	return &snap.ID, nil
}

// pruneSimulations applies the retention settings. Failure is logged, not returned: the run is saved.
func (s *Service) pruneSimulations(ctx context.Context) {
	if s.SimulationRetention <= 0 && s.SimulationMaxRuns <= 0 {
		return
	}
	olderThan := ""
	if s.SimulationRetention > 0 {
		olderThan = s.now().Add(-s.SimulationRetention).UTC().Format(time.RFC3339)
	}
	if _, err := s.SimRepo.Prune(ctx, olderThan, s.SimulationMaxRuns); err != nil && s.Logger != nil {
		s.Logger.WarnContext(ctx, "simulation retention pruning failed", "error", err.Error())
	}
}

// asMap converts an engine value to the JSON object stored with the run.
func asMap(v any) map[string]any {
	b, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}

func countFrom(events []simulation.Event, from int) int {
	n := 0
	for _, e := range events {
		if seq, _ := strconv.Atoi(strings.TrimPrefix(e.ID, "sim-")); seq >= from {
			n++
		}
	}
	return n
}

func metricsOf(data *domain.TopologyData, id string) *domain.Metrics {
	for i := range data.ServiceInstances {
		if data.ServiceInstances[i].ID == id {
			return data.ServiceInstances[i].Metrics
		}
	}
	for i := range data.Resources {
		if data.Resources[i].ID == id {
			return data.Resources[i].Metrics
		}
	}
	for i := range data.Relationships {
		if data.Relationships[i].ID == id {
			return data.Relationships[i].Metrics
		}
	}
	return nil
}

// Simulation returns one stored run.
func (s *Service) Simulation(ctx context.Context, id string) (*domain.SimulationRun, error) {
	run, err := s.SimRepo.Get(ctx, id)
	if errors.Is(err, ports.ErrNotFound) {
		return nil, &NotFound{Detail: fmt.Sprintf("No simulation run with ID %q (it may have expired).", id)}
	}
	return run, err
}

// Simulations lists stored runs, newest first.
func (s *Service) Simulations(ctx context.Context, limit int) ([]domain.SimulationRun, error) {
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 200 {
		return nil, &ErrInvalid{"limit", "must be between 1 and 200"}
	}
	return s.SimRepo.List(ctx, limit)
}

// Page is a cursor page of items.
type Page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"nextCursor"`
}

func paginate[T any](items []T, cursorRaw string, limit int, fingerprint string) (*Page[T], error) {
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 1000 {
		return nil, &ErrInvalid{"limit", "must be between 1 and 1000"}
	}
	offset := 0
	if cursorRaw != "" {
		c, ok := decodeCursor(cursorRaw, fingerprint)
		if !ok {
			return nil, &ErrInvalid{"cursor", "unknown, malformed, or from a different query"}
		}
		offset = c
	}
	page := &Page[T]{Items: []T{}}
	if offset < len(items) {
		end := min(offset+limit, len(items))
		page.Items = items[offset:end]
		if end < len(items) {
			next := encodeCursor(end, fingerprint)
			page.NextCursor = &next
		}
	}
	return page, nil
}

// Events returns a run's events (required simulationId; optional entity and type filters).
func (s *Service) Events(ctx context.Context, simulationID, entityID, eventType, cursor string, limit int) (*Page[domain.StoredEvent], error) {
	if simulationID == "" {
		return nil, &ErrInvalid{"simulationId", "required (events are recorded per simulation run)"}
	}
	if _, err := s.Simulation(ctx, simulationID); err != nil {
		return nil, err
	}
	events, err := s.SimRepo.Events(ctx, simulationID, entityID, eventType)
	if err != nil {
		return nil, err
	}
	return paginate(events, cursor, limit, fingerprintOf("events", simulationID, entityID, eventType))
}

// Telemetry returns a run's watched metric samples.
func (s *Service) Telemetry(ctx context.Context, simulationID, subjectID, metricName, cursor string, limit int) (*Page[domain.TelemetryObservation], error) {
	if simulationID == "" {
		return nil, &ErrInvalid{"simulationId", "required (telemetry is recorded per simulation run)"}
	}
	if metricName != "" && metricName != "latencyMs" && metricName != "throughputPerSecond" && metricName != "errorRatePercent" {
		return nil, &ErrInvalid{"metricName", "must be latencyMs, throughputPerSecond, or errorRatePercent"}
	}
	if _, err := s.Simulation(ctx, simulationID); err != nil {
		return nil, err
	}
	obs, err := s.SimRepo.Telemetry(ctx, simulationID, subjectID, metricName)
	if err != nil {
		return nil, err
	}
	return paginate(obs, cursor, limit, fingerprintOf("telemetry", simulationID, subjectID, metricName))
}

// DiffResult is GET /topology/snapshots/{id}/diff.
type DiffResult struct {
	Before  string                  `json:"before"`
	After   string                  `json:"after"`
	Changes []domain.SnapshotChange `json:"changes"`
}

// DiffSnapshot compares a snapshot with another snapshot or with the current topology ("current").
func (s *Service) DiffSnapshot(ctx context.Context, id, against string) (*DiffResult, error) {
	before, err := s.Snapshot(ctx, id)
	if err != nil {
		return nil, err
	}
	if against == "" {
		against = "current"
	}
	var after *domain.TopologyData
	if against == "current" {
		ix, err := s.index(ctx)
		if err != nil {
			return nil, err
		}
		after = ix.Data
	} else {
		snap, err := s.Snapshot(ctx, against)
		if err != nil {
			return nil, err
		}
		after = &snap.Data
	}
	return &DiffResult{Before: id, After: against, Changes: domain.DiffTopology(&before.Data, after)}, nil
}
