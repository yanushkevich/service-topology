package arcadedb

import (
	"context"
	"encoding/json"
	"sort"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// SimulationRepository implements ports.SimulationRepository. Runs, events, and telemetry are
// documents (indexed by simulationId) holding validated JSON payloads; a run is written in one
// transaction with batched inserts.
type SimulationRepository struct{ c *Client }

var _ ports.SimulationRepository = (*SimulationRepository)(nil)

// NewSimulationRepository returns a simulation repository using c.
func NewSimulationRepository(c *Client) *SimulationRepository { return &SimulationRepository{c: c} }

const insertBatch = 500

func batches[T any](items []T, fn func(chunk []T) error) error {
	for start := 0; start < len(items); start += insertBatch {
		if err := fn(items[start:min(start+insertBatch, len(items))]); err != nil {
			return err
		}
	}
	return nil
}

// Save stores a run with its events and telemetry atomically.
func (r *SimulationRepository) Save(ctx context.Context, run *domain.SimulationRun, events []domain.StoredEvent, telemetry []domain.TelemetryObservation) error {
	payload, err := json.Marshal(run)
	if err != nil {
		return err
	}
	tx, err := r.c.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Command(ctx, "INSERT INTO SimulationRun SET id = :id, createdAt = :createdAt, payload = :payload",
		map[string]any{"id": run.ID, "createdAt": run.CreatedAt, "payload": string(payload)}); err != nil {
		return err
	}
	err = batches(events, func(chunk []domain.StoredEvent) error {
		docs := make([]map[string]any, len(chunk))
		for i, e := range chunk {
			p, _ := json.Marshal(e)
			docs[i] = map[string]any{"simulationId": e.SimulationID, "seq": e.Seq, "entityId": e.Event["entityId"], "type": e.Event["type"], "payload": string(p)}
		}
		_, err := tx.Command(ctx, "INSERT INTO SimulationEvent CONTENT :docs", map[string]any{"docs": docs})
		return err
	})
	if err != nil {
		return err
	}
	err = batches(telemetry, func(chunk []domain.TelemetryObservation) error {
		docs := make([]map[string]any, len(chunk))
		for i, o := range chunk {
			p, _ := json.Marshal(o)
			docs[i] = map[string]any{"simulationId": o.SimulationID, "seq": o.Seq, "subjectId": o.SubjectID, "metricName": o.MetricName, "payload": string(p)}
		}
		_, err := tx.Command(ctx, "INSERT INTO TelemetryObservation CONTENT :docs", map[string]any{"docs": docs})
		return err
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Get returns one run or ports.ErrNotFound.
func (r *SimulationRepository) Get(ctx context.Context, id string) (*domain.SimulationRun, error) {
	rows, err := r.c.Query(ctx, "SELECT payload FROM SimulationRun WHERE id = :id", map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ports.ErrNotFound
	}
	var run domain.SimulationRun
	return &run, payloadOf(rows[0], &run)
}

// List returns runs newest first.
func (r *SimulationRepository) List(ctx context.Context, limit int) ([]domain.SimulationRun, error) {
	rows, err := r.c.Query(ctx, "SELECT payload FROM SimulationRun", nil)
	if err != nil {
		return nil, err
	}
	out := []domain.SimulationRun{}
	for _, row := range rows {
		var run domain.SimulationRun
		if err := payloadOf(row, &run); err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return domain.Before(out[j].CreatedAt, out[i].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func filtered(base string, params map[string]any, filters map[string]string) string {
	keys := make([]string, 0, len(filters))
	for k := range filters {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys { // k is a fixed property name from this file, never input
		if filters[k] != "" {
			base += " AND " + k + " = :" + k
			params[k] = filters[k]
		}
	}
	return base + " ORDER BY seq"
}

// Events returns a run's events in sequence order.
func (r *SimulationRepository) Events(ctx context.Context, simulationID, entityID, eventType string) ([]domain.StoredEvent, error) {
	params := map[string]any{"sim": simulationID}
	rows, err := r.c.Query(ctx, filtered("SELECT payload FROM SimulationEvent WHERE simulationId = :sim", params,
		map[string]string{"entityId": entityID, "type": eventType}), params)
	if err != nil {
		return nil, err
	}
	out := make([]domain.StoredEvent, 0, len(rows))
	for _, row := range rows {
		var e domain.StoredEvent
		raw, _ := row["payload"].(string)
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

// Telemetry returns a run's observations in sequence order.
func (r *SimulationRepository) Telemetry(ctx context.Context, simulationID, subjectID, metricName string) ([]domain.TelemetryObservation, error) {
	params := map[string]any{"sim": simulationID}
	rows, err := r.c.Query(ctx, filtered("SELECT payload FROM TelemetryObservation WHERE simulationId = :sim", params,
		map[string]string{"subjectId": subjectID, "metricName": metricName}), params)
	if err != nil {
		return nil, err
	}
	out := make([]domain.TelemetryObservation, 0, len(rows))
	for _, row := range rows {
		var o domain.TelemetryObservation
		if err := payloadOf(row, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

// Prune removes expired runs (older than olderThan, or beyond the newest keep) with their records.
func (r *SimulationRepository) Prune(ctx context.Context, olderThan string, keep int) (int, error) {
	runs, err := r.List(ctx, 0)
	if err != nil {
		return 0, err
	}
	var expired []string
	for i, run := range runs {
		if (keep > 0 && i >= keep) || (olderThan != "" && domain.Before(run.CreatedAt, olderThan)) {
			expired = append(expired, run.ID)
		}
	}
	if len(expired) == 0 {
		return 0, nil
	}
	tx, err := r.c.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, t := range []string{"SimulationEvent", "TelemetryObservation"} {
		if _, err := tx.Command(ctx, "DELETE FROM "+t+" WHERE simulationId IN :ids", map[string]any{"ids": expired}); err != nil {
			return 0, err
		}
	}
	if _, err := tx.Command(ctx, "DELETE FROM SimulationRun WHERE id IN :ids", map[string]any{"ids": expired}); err != nil {
		return 0, err
	}
	return len(expired), tx.Commit(ctx)
}
