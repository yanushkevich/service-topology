package mongodb

import (
	"context"
	"errors"
	"sort"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// BoardRepository implements ports.BoardRepository: one document per service in transitBoards,
// _id = the service definition ID, with an integer revision bumped on every replace (ADR-031).
type BoardRepository struct{ s *Store }

var _ ports.BoardRepository = (*BoardRepository)(nil)

// NewBoardRepository returns a board repository using s.
func NewBoardRepository(s *Store) *BoardRepository { return &BoardRepository{s: s} }

func decodeBoard(raw bson.Raw) (*domain.StoredBoard, error) {
	var def domain.BoardDefinition
	if err := fromField(raw, "payload", &def); err != nil {
		return nil, err
	}
	rev, _ := raw.Lookup("revision").AsInt64OK()
	updatedAt, _ := raw.Lookup("updatedAt").StringValueOK()
	return &domain.StoredBoard{Definition: def, Revision: strconv.FormatInt(rev, 10), UpdatedAt: updatedAt}, nil
}

// List returns every stored board, by service ID.
func (r *BoardRepository) List(ctx context.Context) ([]domain.StoredBoard, error) {
	cur, err := r.s.coll(collBoards).Find(ctx, bson.D{})
	if err != nil {
		return nil, mapErr(err)
	}
	out := []domain.StoredBoard{}
	err = each(ctx, cur, func(raw bson.Raw) error {
		b, err := decodeBoard(raw)
		if err != nil {
			return err
		}
		out = append(out, *b)
		return nil
	})
	sort.Slice(out, func(i, j int) bool {
		return out[i].Definition.ServiceDefinitionID < out[j].Definition.ServiceDefinitionID
	})
	return out, err
}

// Get returns the board of a service; ports.ErrNotFound if none is stored.
func (r *BoardRepository) Get(ctx context.Context, serviceID domain.EntityID) (*domain.StoredBoard, error) {
	raw, err := r.s.coll(collBoards).FindOne(ctx, byID(serviceID)).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ports.ErrNotFound
	}
	if err != nil {
		return nil, mapErr(err)
	}
	return decodeBoard(raw)
}

// Create stores a new definition at revision 1; ports.ErrConflict if the service has one.
func (r *BoardRepository) Create(ctx context.Context, def *domain.BoardDefinition, updatedAt string) (*domain.StoredBoard, error) {
	payload, err := toDocument(def)
	if err != nil {
		return nil, err
	}
	doc := bson.D{{Key: "_id", Value: def.ServiceDefinitionID}, {Key: "revision", Value: int64(1)}, {Key: "updatedAt", Value: updatedAt}, {Key: "payload", Value: payload}}
	if _, err := r.s.coll(collBoards).InsertOne(ctx, doc); err != nil {
		return nil, mapErr(err)
	}
	return &domain.StoredBoard{Definition: *def, Revision: "1", UpdatedAt: updatedAt}, nil
}

// Replace stores a new revision in one atomic update guarded by ifRevision.
func (r *BoardRepository) Replace(ctx context.Context, def *domain.BoardDefinition, ifRevision, updatedAt string) (*domain.StoredBoard, error) {
	payload, err := toDocument(def)
	if err != nil {
		return nil, err
	}
	filter, err := r.guard(def.ServiceDefinitionID, ifRevision)
	if err != nil {
		return nil, err
	}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "payload", Value: payload}, {Key: "updatedAt", Value: updatedAt}}}, {Key: "$inc", Value: bson.D{{Key: "revision", Value: int64(1)}}}}
	raw, err := r.s.coll(collBoards).FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, r.missOrStale(ctx, def.ServiceDefinitionID)
	}
	if err != nil {
		return nil, mapErr(err)
	}
	return decodeBoard(raw)
}

// Remove deletes the board, guarded by ifRevision.
func (r *BoardRepository) Remove(ctx context.Context, serviceID domain.EntityID, ifRevision string) error {
	filter, err := r.guard(serviceID, ifRevision)
	if err != nil {
		return err
	}
	res, err := r.s.coll(collBoards).DeleteOne(ctx, filter)
	if err != nil {
		return mapErr(err)
	}
	if res.DeletedCount == 0 {
		return r.missOrStale(ctx, serviceID)
	}
	return nil
}

// guard is the filter of a revision-guarded write; a revision that is not a number never matches.
func (r *BoardRepository) guard(serviceID domain.EntityID, ifRevision string) (bson.D, error) {
	filter := byID(serviceID)
	if ifRevision == "" {
		return filter, nil
	}
	rev, err := strconv.ParseInt(ifRevision, 10, 64)
	if err != nil {
		return nil, ports.ErrPreconditionFailed
	}
	return append(filter, bson.E{Key: "revision", Value: rev}), nil
}

// missOrStale tells a missing board from a stale revision after a guarded write matched nothing.
func (r *BoardRepository) missOrStale(ctx context.Context, serviceID domain.EntityID) error {
	n, err := r.s.coll(collBoards).CountDocuments(ctx, byID(serviceID))
	if err != nil {
		return mapErr(err)
	}
	if n == 0 {
		return ports.ErrNotFound
	}
	return ports.ErrPreconditionFailed
}
