package mongodb

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Backend-only bookkeeping lives in each canonical document's _meta object and is stripped on read
// (DOMAIN_MODEL.md "Metrics and provenance"; never part of the API payload).
//
//	ord         position in the canonical collection, so reads preserve order
//	recordedAt  when this backend stored the record
//	sourceType  where the record came from: "fixture", later adapter names
//	endpoints   relationships only: [sourceEntityId, targetEntityId], for undirected traversal
var stripped = map[string]bool{"_id": true, "_meta": true}

// ValidationError is returned when a topology fails domain validation; nothing was written.
type ValidationError struct{ Issues []domain.Issue }

func (e *ValidationError) Error() string {
	return fmt.Sprintf("topology failed validation with %d issue(s), first: %s %s", len(e.Issues), e.Issues[0].Code, e.Issues[0].EntityID)
}

// IsValidation reports whether err is a ValidationError.
func IsValidation(err error) bool {
	var v *ValidationError
	return errors.As(err, &v)
}

// TopologyRepository stores and reads the canonical topology. It implements ports.TopologyRepository.
//
// Reads are cached by revision: every import writes a new random revision to the topologyState
// document in the same transaction as the data, and every read first fetches the revision (one _id
// lookup). An unchanged revision returns the cached topology; a changed one (also from another
// process, e.g. `seed load`) re-reads it in a snapshot transaction. Returned data is shared and must
// be treated as read-only.
type TopologyRepository struct {
	s   *Store
	now func() time.Time

	mu       sync.Mutex
	revision string
	cached   *domain.TopologyData
	hits     atomic.Uint64
	misses   atomic.Uint64
}

var (
	_ ports.TopologyRepository     = (*TopologyRepository)(nil)
	_ ports.TopologyMetaRepository = (*TopologyRepository)(nil)
)

// NewTopologyRepository returns a repository using s.
func NewTopologyRepository(s *Store) *TopologyRepository {
	return &TopologyRepository{s: s, now: time.Now}
}

// ImportResult counts the documents an import wrote, by collection.
type ImportResult struct {
	Documents map[string]int
}

// canonicalDoc is an entity's canonical JSON as BSON, with _id first and the bookkeeping last.
func canonicalDoc(id string, entity any, meta bson.D) (bson.D, error) {
	d, err := toDocument(entity)
	if err != nil {
		return nil, err
	}
	return append(append(bson.D{{Key: "_id", Value: id}}, d...), bson.E{Key: "_meta", Value: meta}), nil
}

// ReplaceTopology validates data and, in one transaction, replaces the stored canonical topology
// with it (snapshots, layouts, and runs are untouched). Importing the same data twice yields the
// same state, so seeding is idempotent. On any failure nothing is committed.
func (r *TopologyRepository) ReplaceTopology(ctx context.Context, data *domain.TopologyData, sourceType string) (ImportResult, error) {
	if issues := domain.Validate(data); len(issues) > 0 {
		return ImportResult{}, &ValidationError{Issues: issues}
	}
	recordedAt := r.now().UTC().Format(time.RFC3339)
	docs := map[string][]any{}
	add := func(coll, id string, ord int, entity any, extra ...bson.E) error {
		meta := append(bson.D{{Key: "ord", Value: ord}, {Key: "recordedAt", Value: recordedAt}, {Key: "sourceType", Value: sourceType}}, extra...)
		d, err := canonicalDoc(id, entity, meta)
		if err != nil {
			return err
		}
		docs[coll] = append(docs[coll], d)
		return nil
	}
	var err error
	for i, e := range data.Environments {
		err = errors.Join(err, add(collEnvironments, e.ID, i, e))
	}
	for i, d := range data.ServiceDefinitions {
		err = errors.Join(err, add(collServiceDefinitions, d.ID, i, d))
	}
	for i, inst := range data.ServiceInstances {
		err = errors.Join(err, add(collServiceInstances, inst.ID, i, inst))
	}
	for i, res := range data.Resources {
		err = errors.Join(err, add(collResources, res.ID, i, res))
	}
	for i, rel := range data.Relationships {
		err = errors.Join(err, add(collRelationships, rel.ID, i, rel, bson.E{Key: "endpoints", Value: bson.A{rel.SourceEntityID, rel.TargetEntityID}}))
	}
	for i, e := range data.EventTypes {
		err = errors.Join(err, add(collEventTypes, e.ID, i, e))
	}
	if err != nil {
		return ImportResult{}, err
	}
	var b [16]byte
	_, _ = rand.Read(b[:])
	revision := hex.EncodeToString(b[:])

	res := ImportResult{Documents: map[string]int{}}
	err = r.s.inTx(ctx, func(ctx context.Context) error {
		for _, c := range canonicalCollections {
			if _, err := r.s.coll(c).DeleteMany(ctx, bson.D{}); err != nil {
				return err
			}
			if len(docs[c]) == 0 {
				continue
			}
			if _, err := r.s.coll(c).InsertMany(ctx, docs[c]); err != nil {
				return err
			}
		}
		_, err := r.s.coll(collTopologyState).ReplaceOne(ctx, bson.D{{Key: "_id", Value: "topology"}},
			bson.D{{Key: "revision", Value: revision}, {Key: "recordedAt", Value: recordedAt}, {Key: "sourceType", Value: sourceType}},
			options.Replace().SetUpsert(true))
		return err
	})
	if err != nil {
		return ImportResult{}, err
	}
	for _, c := range canonicalCollections {
		res.Documents[c] = len(docs[c])
	}
	return res, nil
}

type topologyState struct {
	Revision   string `bson:"revision"`
	RecordedAt string `bson:"recordedAt"`
	SourceType string `bson:"sourceType"`
}

func readState(ctx context.Context, s *Store) (topologyState, error) {
	var st topologyState
	err := s.coll(collTopologyState).FindOne(ctx, bson.D{{Key: "_id", Value: "topology"}}).Decode(&st)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return topologyState{}, nil
	}
	return st, mapErr(err)
}

// TopologyMeta returns the stored topology's revision and source (ports.TopologyMetaRepository).
func (r *TopologyRepository) TopologyMeta(ctx context.Context) (*ports.TopologyMeta, error) {
	st, err := readState(ctx, r.s)
	if err != nil {
		return nil, err
	}
	return &ports.TopologyMeta{Revision: st.Revision, RecordedAt: st.RecordedAt, SourceType: st.SourceType, IsMock: st.SourceType != "observed"}, nil
}

// CacheStats returns read-cache hits and misses since start (metrics).
func (r *TopologyRepository) CacheStats() (hits, misses uint64) {
	return r.hits.Load(), r.misses.Load()
}

// GetTopology returns the stored canonical topology in its original collection order. Environment
// projection is done by the application layer on the full (cached) topology (domain.FilterEnvironment).
func (r *TopologyRepository) GetTopology(ctx context.Context, environmentID domain.EntityID) (*domain.TopologyData, error) {
	if environmentID != "" {
		return nil, fmt.Errorf("mongodb: environment projection happens in the application layer; call GetTopology with an empty environment")
	}
	st, err := readState(ctx, r.s)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	if st.Revision != "" && st.Revision == r.revision && r.cached != nil {
		cached := r.cached
		r.mu.Unlock()
		r.hits.Add(1)
		return cached, nil
	}
	r.mu.Unlock()
	r.misses.Add(1)

	var data *domain.TopologyData
	var revision string
	// Read the revision and every collection in one snapshot so the parts belong together.
	err = r.s.inTx(ctx, func(ctx context.Context) error {
		st, err := readState(ctx, r.s)
		if err != nil {
			return err
		}
		revision = st.Revision
		data = &domain.TopologyData{}
		reads := []struct {
			coll string
			into any
		}{
			{collEnvironments, &data.Environments},
			{collServiceDefinitions, &data.ServiceDefinitions},
			{collServiceInstances, &data.ServiceInstances},
			{collResources, &data.Resources},
			{collRelationships, &data.Relationships},
			{collEventTypes, &data.EventTypes},
		}
		for _, read := range reads {
			if err := findAll(ctx, r.s.coll(read.coll), bson.D{}, read.into); err != nil {
				return fmt.Errorf("stored %s documents: %w", read.coll, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Collections are arrays in the contract; an absent event type list stays absent.
	if len(data.EventTypes) == 0 {
		data.EventTypes = nil
	}
	if revision != "" {
		r.mu.Lock()
		r.revision, r.cached = revision, data
		r.mu.Unlock()
	}
	return data, nil
}

var byOrd = options.Find().SetSort(bson.D{{Key: "_meta.ord", Value: 1}})

// findAll decodes the canonical documents matching filter, in canonical order, into a pointer to a
// slice (always non-nil afterwards).
func findAll(ctx context.Context, coll *mongo.Collection, filter bson.D, into any) error {
	cur, err := coll.Find(ctx, filter, byOrd)
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	var buf bytes.Buffer
	buf.WriteByte('[')
	for n := 0; cur.Next(ctx); n++ {
		if n > 0 {
			buf.WriteByte(',')
		}
		raw, err := toJSON(cur.Current, stripped)
		if err != nil {
			return err
		}
		buf.Write(raw)
	}
	if err := cur.Err(); err != nil {
		return err
	}
	buf.WriteByte(']')
	return decodeStrict(buf.Bytes(), into)
}
