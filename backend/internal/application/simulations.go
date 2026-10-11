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
	if len(req.Actions) == 0 || len(req.Actions) > MaxSimulationActions {
		return nil, &ErrInvalid{"actions", fmt.Sprintf("between 1 and %d actions", MaxSimulationActions)}
	}
	if len(req.Watch) > MaxWatchedEntities {
		return nil, &ErrInvalid{"watch", fmt.Sprintf("at most %d entities", MaxWatchedEntities)}
	}
	if req.StartAt != "" && !validTime(req.StartAt) {
		return nil, &ErrInvalid{"startAt", "must be an RFC 3339 date-time"}
	}
	if len(req.Label) > 200 {
		return nil, &ErrInvalid{"label", "at most 200 characters"}
	}
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	exists := func(id string) bool { return ix.Instances[id] != nil || ix.Resources[id] != nil }
	ticks := 0
	for i, a := range req.Actions {
		switch a.Type {
		case "inject":
			if !exists(a.EntityID) {
				return nil, invalidAction(i, fmt.Sprintf("unknown service instance or resource %q", a.EntityID))
			}
			if a.Mode != domain.FailureUnavailable && a.Mode != domain.FailureDegraded {
				return nil, invalidAction(i, "mode must be unavailable or degraded")
			}
			if a.DurationTicks < 0 {
				return nil, invalidAction(i, "durationTicks must not be negative")
			}
		case "recover":
			if !exists(a.EntityID) {
				return nil, invalidAction(i, fmt.Sprintf("unknown service instance or resource %q", a.EntityID))
			}
		case "recoverAll", "reset":
		case "step":
			if a.Ticks < 1 {
				return nil, invalidAction(i, "ticks must be at least 1")
			}
			ticks += a.Ticks
		default:
			return nil, invalidAction(i, "type must be inject, recover, recoverAll, step, or reset")
		}
	}
	if ticks > MaxSimulationTicks {
		return nil, &ErrInvalid{"actions", fmt.Sprintf("at most %d ticks in total", MaxSimulationTicks)}
	}
	for _, id := range req.Watch {
		if !exists(id) && ix.Relationships[id] == nil {
			return nil, &ErrInvalid{"watch", fmt.Sprintf("unknown entity %q", id)}
		}
	}

	seed := uint32(1)
	if req.Seed != nil {
		seed = *req.Seed
	}
	runID := s.newID()
	recordedAt := s.now().UTC().Format(time.RFC3339)
	state := simulation.Create(ix.Data, seed, req.StartAt)
	startAt := state.Clock

	var events []domain.StoredEvent
	var telemetry []domain.TelemetryObservation
	eventsTruncated := false
	seenSeq := 1
	collect := func() {
		// Events added since the last collection; the engine keeps only its last MaxEvents.
		for _, e := range state.Events {
			n, _ := strconv.Atoi(strings.TrimPrefix(e.ID, "sim-"))
			if n < seenSeq {
				continue
			}
			if len(events) >= MaxStoredEvents {
				eventsTruncated = true
				continue
			}
			b, _ := json.Marshal(e)
			var m map[string]any
			_ = json.Unmarshal(b, &m)
			// Seq numbers the whole run; the engine's own ID (which restarts after reset) stays in Event.
			events = append(events, domain.StoredEvent{SimulationID: runID, Seq: len(events) + 1, Provenance: domain.ProvenanceSimulated, RecordedAt: recordedAt, Event: m})
		}
		if state.EventSeq-seenSeq > countFrom(state.Events, seenSeq) {
			eventsTruncated = true
		}
		seenSeq = state.EventSeq
		for _, id := range req.Watch {
			m := metricsOf(state.Data, id)
			if m == nil {
				continue
			}
			values := []*float64{m.LatencyMs, m.ThroughputPerSecond, m.ErrorRatePercent}
			for k, mu := range metricUnits {
				if values[k] == nil {
					continue
				}
				telemetry = append(telemetry, domain.TelemetryObservation{SimulationID: runID, Seq: len(telemetry) + 1, SubjectID: id, MetricName: mu.name,
					Value: *values[k], Unit: mu.unit, ObservedAt: state.Clock, RecordedAt: recordedAt, Provenance: domain.ProvenanceSimulated, IsSimulated: true})
			}
		}
	}
	collect()
	for _, a := range req.Actions {
		switch a.Type {
		case "inject":
			if state, err = state.Inject(a.EntityID, a.Mode, a.DurationTicks); err != nil {
				return nil, err
			}
			collect()
		case "recover":
			state = state.Recover(a.EntityID)
			collect()
		case "recoverAll":
			state = state.RecoverAll()
			collect()
		case "reset":
			state = state.Reset(req.StartAt)
			seenSeq = 1
			collect()
		case "step":
			for t := 0; t < a.Ticks; t++ { // per tick, so telemetry has one sample per tick
				state = state.Step(1)
				collect()
			}
		}
	}

	failures := []map[string]any{}
	for _, f := range state.Failures {
		b, _ := json.Marshal(f)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		failures = append(failures, m)
	}
	watch := req.Watch
	if watch == nil {
		watch = []domain.EntityID{}
	}
	actions := append([]domain.SimulationAction{}, req.Actions...)
	run := &domain.SimulationRun{ID: runID, CreatedAt: recordedAt, Label: req.Label, Seed: seed, StartAt: startAt,
		Actions: actions, Watch: watch, Tick: state.Tick, Clock: state.Clock, Failures: failures, Impacts: state.Impacts,
		EventCount: len(events), EventsTruncated: eventsTruncated, TelemetryCount: len(telemetry), Provenance: domain.ProvenanceSimulated, IsSimulated: true}

	if req.CaptureSnapshot {
		label := req.Label
		if label == "" {
			label = "Simulation " + runID
		}
		snap := &domain.Snapshot{SchemaVersion: domain.SnapshotSchemaVersion,
			SnapshotSummary: domain.SnapshotSummary{ID: runID, Label: label, TakenAt: state.Clock, Source: domain.SnapshotSourceSimulation, IsSimulated: true}, Data: *state.Data}
		if issues := domain.ValidateSnapshot(snap); len(issues) > 0 {
			return nil, fmt.Errorf("simulated state failed validation: %s %s", issues[0].Code, issues[0].Message)
		}
		if err := s.SnapshotRepo.Save(ctx, snap); err != nil {
			return nil, err
		}
		run.SnapshotID = &snap.ID
	}
	if err := s.SimRepo.Save(ctx, run, events, telemetry); err != nil {
		return nil, err
	}
	if s.SimulationRetention > 0 || s.SimulationMaxRuns > 0 {
		olderThan := ""
		if s.SimulationRetention > 0 {
			olderThan = s.now().Add(-s.SimulationRetention).UTC().Format(time.RFC3339)
		}
		if _, err := s.SimRepo.Prune(ctx, olderThan, s.SimulationMaxRuns); err != nil && s.Logger != nil {
			s.Logger.WarnContext(ctx, "simulation retention pruning failed", "error", err.Error())
		}
	}
	return run, nil
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
