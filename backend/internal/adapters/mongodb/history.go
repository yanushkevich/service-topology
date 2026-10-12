package mongodb

import (
	"context"
	"errors"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Snapshots and saved layouts are documents keyed by their stable ID: indexed fields next to the
// validated value under payload. Snapshots are immutable and layouts are replaced whole, so the
// payload is always one exact value (PERSISTENCE.md: bounded snapshot payloads; a document is at
// most 16 MB).

// SnapshotRepository implements ports.SnapshotRepository.
type SnapshotRepository struct{ s *Store }

// LayoutRepository implements ports.SavedLayoutRepository.
type LayoutRepository struct{ s *Store }

var (
	_ ports.SnapshotRepository    = (*SnapshotRepository)(nil)
	_ ports.SavedLayoutRepository = (*LayoutRepository)(nil)
)

// NewSnapshotRepository returns a snapshot repository using s.
func NewSnapshotRepository(s *Store) *SnapshotRepository { return &SnapshotRepository{s: s} }

// NewLayoutRepository returns a layout repository using s.
func NewLayoutRepository(s *Store) *LayoutRepository { return &LayoutRepository{s: s} }

var before = domain.Before

func byID(id string) bson.D { return bson.D{{Key: "_id", Value: id}} }

// findOne decodes one document's payload; ports.ErrNotFound when there is none.
func findOne(ctx context.Context, coll *mongo.Collection, id string, into any) error {
	raw, err := coll.FindOne(ctx, byID(id), options.FindOne().SetProjection(bson.D{{Key: "payload", Value: 1}})).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return ports.ErrNotFound
	}
	if err != nil {
		return mapErr(err)
	}
	return fromField(raw, "payload", into)
}

// each calls fn with every document the cursor returns.
func each(ctx context.Context, cur *mongo.Cursor, fn func(raw bson.Raw) error) error {
	defer cur.Close(ctx)
	for cur.Next(ctx) {
		if err := fn(cur.Current); err != nil {
			return err
		}
	}
	return mapErr(cur.Err())
}

// List returns summaries ordered by takenAt (oldest first), optionally bounded by RFC 3339 times.
// Times are compared as instants, so offsets other than Z sort correctly.
func (r *SnapshotRepository) List(ctx context.Context, q ports.SnapshotQuery) ([]domain.SnapshotSummary, error) {
	cur, err := r.s.coll(collSnapshots).Find(ctx, bson.D{}, options.Find().SetProjection(bson.D{{Key: "summary", Value: 1}}))
	if err != nil {
		return nil, mapErr(err)
	}
	out := []domain.SnapshotSummary{}
	err = each(ctx, cur, func(raw bson.Raw) error {
		var s domain.SnapshotSummary
		if err := fromField(raw, "summary", &s); err != nil {
			return err
		}
		if q.From != "" && before(s.TakenAt, q.From) || q.To != "" && before(q.To, s.TakenAt) {
			return nil
		}
		out = append(out, s)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if before(out[i].TakenAt, out[j].TakenAt) != before(out[j].TakenAt, out[i].TakenAt) {
			return before(out[i].TakenAt, out[j].TakenAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// Get returns one snapshot or ports.ErrNotFound.
func (r *SnapshotRepository) Get(ctx context.Context, id string) (*domain.Snapshot, error) {
	var s domain.Snapshot
	if err := findOne(ctx, r.s.coll(collSnapshots), id, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// Save stores a new, already validated snapshot; ports.ErrConflict if the ID exists (_id index).
func (r *SnapshotRepository) Save(ctx context.Context, s *domain.Snapshot) error {
	payload, err := toDocument(s)
	if err != nil {
		return err
	}
	summary, err := toDocument(s.SnapshotSummary)
	if err != nil {
		return err
	}
	_, err = r.s.coll(collSnapshots).InsertOne(ctx, bson.D{{Key: "_id", Value: s.ID}, {Key: "takenAt", Value: s.TakenAt}, {Key: "summary", Value: summary}, {Key: "payload", Value: payload}})
	return mapErr(err)
}

// List returns layouts newest first (createdAt descending, then ID).
func (r *LayoutRepository) List(ctx context.Context) ([]domain.SavedLayout, error) {
	cur, err := r.s.coll(collLayouts).Find(ctx, bson.D{})
	if err != nil {
		return nil, mapErr(err)
	}
	out := []domain.SavedLayout{}
	err = each(ctx, cur, func(raw bson.Raw) error {
		var l domain.SavedLayout
		if err := fromField(raw, "payload", &l); err != nil {
			return err
		}
		out = append(out, l)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return before(out[j].CreatedAt, out[i].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func layoutDoc(l *domain.SavedLayout) (bson.D, error) {
	payload, err := toDocument(l)
	if err != nil {
		return nil, err
	}
	return bson.D{{Key: "_id", Value: l.ID}, {Key: "createdAt", Value: l.CreatedAt}, {Key: "payload", Value: payload}}, nil
}

// Create stores a new layout; ports.ErrConflict if the ID exists.
func (r *LayoutRepository) Create(ctx context.Context, l *domain.SavedLayout) error {
	doc, err := layoutDoc(l)
	if err != nil {
		return err
	}
	_, err = r.s.coll(collLayouts).InsertOne(ctx, doc)
	return mapErr(err)
}

// Replace overwrites an existing layout; ports.ErrNotFound if it does not exist.
func (r *LayoutRepository) Replace(ctx context.Context, l *domain.SavedLayout) error {
	doc, err := layoutDoc(l)
	if err != nil {
		return err
	}
	res, err := r.s.coll(collLayouts).ReplaceOne(ctx, byID(l.ID), doc)
	if err != nil {
		return mapErr(err)
	}
	if res.MatchedCount == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// Remove deletes a layout; ports.ErrNotFound if it does not exist.
func (r *LayoutRepository) Remove(ctx context.Context, id string) error {
	res, err := r.s.coll(collLayouts).DeleteOne(ctx, byID(id))
	if err != nil {
		return mapErr(err)
	}
	if res.DeletedCount == 0 {
		return ports.ErrNotFound
	}
	return nil
}
