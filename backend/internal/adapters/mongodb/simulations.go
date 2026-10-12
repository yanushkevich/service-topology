package mongodb

import (
	"context"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// SimulationRepository implements ports.SimulationRepository. Runs, events, and telemetry are
// documents holding validated values under payload, with the fields they are filtered by next to
// it (indexed by simulationId and seq). A run and its records are written in one transaction.
type SimulationRepository struct{ s *Store }

var _ ports.SimulationRepository = (*SimulationRepository)(nil)

// NewSimulationRepository returns a simulation repository using s.
func NewSimulationRepository(s *Store) *SimulationRepository { return &SimulationRepository{s: s} }

// Save stores a run with its events and telemetry atomically.
func (r *SimulationRepository) Save(ctx context.Context, run *domain.SimulationRun, events []domain.StoredEvent, telemetry []domain.TelemetryObservation) error {
	payload, err := toDocument(run)
	if err != nil {
		return err
	}
	eventDocs := make([]any, len(events))
	for i, e := range events {
		p, err := toDocument(e)
		if err != nil {
			return err
		}
		eventDocs[i] = bson.D{{Key: "simulationId", Value: e.SimulationID}, {Key: "seq", Value: e.Seq},
			{Key: "entityId", Value: e.Event["entityId"]}, {Key: "type", Value: e.Event["type"]}, {Key: "payload", Value: p}}
	}
	telemetryDocs := make([]any, len(telemetry))
	for i, o := range telemetry {
		p, err := toDocument(o)
		if err != nil {
			return err
		}
		telemetryDocs[i] = bson.D{{Key: "simulationId", Value: o.SimulationID}, {Key: "seq", Value: o.Seq},
			{Key: "subjectId", Value: o.SubjectID}, {Key: "metricName", Value: o.MetricName}, {Key: "payload", Value: p}}
	}
	return r.s.inTx(ctx, func(ctx context.Context) error {
		if _, err := r.s.coll(collRuns).InsertOne(ctx, bson.D{{Key: "_id", Value: run.ID}, {Key: "createdAt", Value: run.CreatedAt}, {Key: "payload", Value: payload}}); err != nil {
			return err
		}
		// InsertMany splits large inputs into batches within the server's message limits.
		if len(eventDocs) > 0 {
			if _, err := r.s.coll(collEvents).InsertMany(ctx, eventDocs); err != nil {
				return err
			}
		}
		if len(telemetryDocs) > 0 {
			if _, err := r.s.coll(collTelemetry).InsertMany(ctx, telemetryDocs); err != nil {
				return err
			}
		}
		return nil
	})
}

// Get returns one run or ports.ErrNotFound.
func (r *SimulationRepository) Get(ctx context.Context, id string) (*domain.SimulationRun, error) {
	var run domain.SimulationRun
	if err := findOne(ctx, r.s.coll(collRuns), id, &run); err != nil {
		return nil, err
	}
	return &run, nil
}

// List returns runs newest first.
func (r *SimulationRepository) List(ctx context.Context, limit int) ([]domain.SimulationRun, error) {
	cur, err := r.s.coll(collRuns).Find(ctx, bson.D{})
	if err != nil {
		return nil, mapErr(err)
	}
	out := []domain.SimulationRun{}
	err = each(ctx, cur, func(raw bson.Raw) error {
		var run domain.SimulationRun
		if err := fromField(raw, "payload", &run); err != nil {
			return err
		}
		out = append(out, run)
		return nil
	})
	if err != nil {
		return nil, err
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

// records returns a run's records matching the optional equality filters, in sequence order.
// Filter keys are fixed field names from this file; values are bound as BSON values.
func records[T any](ctx context.Context, r *SimulationRepository, coll, simulationID string, filters [][2]string) ([]T, error) {
	filter := bson.D{{Key: "simulationId", Value: simulationID}}
	for _, f := range filters {
		if f[1] != "" {
			filter = append(filter, bson.E{Key: f[0], Value: f[1]})
		}
	}
	cur, err := r.s.coll(coll).Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "seq", Value: 1}}).SetProjection(bson.D{{Key: "payload", Value: 1}}))
	if err != nil {
		return nil, mapErr(err)
	}
	out := []T{}
	err = each(ctx, cur, func(raw bson.Raw) error {
		var v T
		if err := fromField(raw, "payload", &v); err != nil {
			return err
		}
		out = append(out, v)
		return nil
	})
	return out, err
}

// Events returns a run's events in sequence order.
func (r *SimulationRepository) Events(ctx context.Context, simulationID, entityID, eventType string) ([]domain.StoredEvent, error) {
	return records[domain.StoredEvent](ctx, r, collEvents, simulationID, [][2]string{{"entityId", entityID}, {"type", eventType}})
}

// Telemetry returns a run's observations in sequence order.
func (r *SimulationRepository) Telemetry(ctx context.Context, simulationID, subjectID, metricName string) ([]domain.TelemetryObservation, error) {
	return records[domain.TelemetryObservation](ctx, r, collTelemetry, simulationID, [][2]string{{"subjectId", subjectID}, {"metricName", metricName}})
}

// Prune removes expired runs (older than olderThan, or beyond the newest keep) with their records.
func (r *SimulationRepository) Prune(ctx context.Context, olderThan string, keep int) (int, error) {
	runs, err := r.List(ctx, 0)
	if err != nil {
		return 0, err
	}
	var expired bson.A
	for i, run := range runs {
		if (keep > 0 && i >= keep) || (olderThan != "" && domain.Before(run.CreatedAt, olderThan)) {
			expired = append(expired, run.ID)
		}
	}
	if len(expired) == 0 {
		return 0, nil
	}
	in := bson.D{{Key: "$in", Value: expired}}
	err = r.s.inTx(ctx, func(ctx context.Context) error {
		for _, c := range []string{collEvents, collTelemetry} {
			if _, err := r.s.coll(c).DeleteMany(ctx, bson.D{{Key: "simulationId", Value: in}}); err != nil {
				return err
			}
		}
		_, err := r.s.coll(collRuns).DeleteMany(ctx, bson.D{{Key: "_id", Value: in}})
		return err
	})
	if err != nil {
		return 0, err
	}
	return len(expired), nil
}
