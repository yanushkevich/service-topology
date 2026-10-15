package mongodb

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// IntegrationRepository implements ports.IntegrationStore: one document per source in
// integrations, _id = the source name (ADR-034). Aliases are stored as {name, id} pairs, since
// source names may contain characters that are awkward in field names ('.', '$').
type IntegrationRepository struct{ s *Store }

var _ ports.IntegrationStore = (*IntegrationRepository)(nil)

// NewIntegrationRepository returns an integration store using s.
func NewIntegrationRepository(s *Store) *IntegrationRepository { return &IntegrationRepository{s: s} }

type aliasDoc struct {
	Name string `bson:"name"`
	ID   string `bson:"id"`
}

// Aliases returns the source's aliases and their revision ("0" when none were saved).
func (r *IntegrationRepository) Aliases(ctx context.Context, source string) (map[string]domain.EntityID, string, error) {
	var doc struct {
		Aliases  []aliasDoc `bson:"aliases"`
		Revision int64      `bson:"aliasesRevision"`
	}
	err := r.s.coll(collIntegrations).FindOne(ctx, byID(source)).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return map[string]domain.EntityID{}, "0", nil
	}
	if err != nil {
		return nil, "", mapErr(err)
	}
	out := make(map[string]domain.EntityID, len(doc.Aliases))
	for _, a := range doc.Aliases {
		out[a.Name] = a.ID
	}
	return out, strconv.FormatInt(doc.Revision, 10), nil
}

// SaveAliases replaces the aliases in one update guarded by ifRevision. The first save upserts; a
// stale revision then collides with the existing document, which is reported as a stale revision.
func (r *IntegrationRepository) SaveAliases(ctx context.Context, source string, aliases map[string]domain.EntityID, ifRevision string) (string, error) {
	rev, err := strconv.ParseInt(ifRevision, 10, 64)
	if err != nil {
		return "", ports.ErrPreconditionFailed
	}
	list := make([]aliasDoc, 0, len(aliases))
	for _, name := range sortedNames(aliases) {
		list = append(list, aliasDoc{Name: name, ID: aliases[name]})
	}
	filter := append(byID(source), bson.E{Key: "aliasesRevision", Value: rev})
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "aliases", Value: list}}}, {Key: "$inc", Value: bson.D{{Key: "aliasesRevision", Value: int64(1)}}}}
	_, err = r.s.coll(collIntegrations).UpdateOne(ctx, filter, update, options.UpdateOne().SetUpsert(true))
	if mongo.IsDuplicateKeyError(err) {
		return "", ports.ErrPreconditionFailed
	}
	if err != nil {
		return "", mapErr(err)
	}
	return strconv.FormatInt(rev+1, 10), nil
}

// LastSync returns the last applied sync, or nil.
func (r *IntegrationRepository) LastSync(ctx context.Context, source string) (*ports.SyncRecord, error) {
	raw, err := r.s.coll(collIntegrations).FindOne(ctx, byID(source)).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, mapErr(err)
	}
	if _, err := raw.LookupErr("lastSync"); err != nil {
		return nil, nil
	}
	var out ports.SyncRecord
	if err := fromField(raw, "lastSync", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SaveLastSync records the last applied sync.
func (r *IntegrationRepository) SaveLastSync(ctx context.Context, source string, sync *ports.SyncRecord) error {
	payload, err := toDocument(sync)
	if err != nil {
		return err
	}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "lastSync", Value: payload}}}, {Key: "$setOnInsert", Value: bson.D{{Key: "aliasesRevision", Value: int64(0)}}}}
	_, err = r.s.coll(collIntegrations).UpdateOne(ctx, byID(source), update, options.UpdateOne().SetUpsert(true))
	return mapErr(err)
}

func sortedNames(m map[string]domain.EntityID) []string {
	return slices.Sorted(maps.Keys(m))
}

// observedEntity stores one entity's state; the overlay's map becomes a list because entity IDs
// may contain '.' (e.g. "payment-service.production").
type observedEntity struct {
	ID    string              `json:"id"`
	State ports.ObservedState `json:"state"`
}

type observationsPayload struct {
	Source     string           `json:"source"`
	ObservedAt string           `json:"observedAt"`
	IsExample  bool             `json:"isExample"`
	Entities   []observedEntity `json:"entities"`
}

// LoadObservations returns the source's stored overlay, or nil.
func (r *IntegrationRepository) LoadObservations(ctx context.Context, source string) (*ports.ObservationOverlay, error) {
	raw, err := r.s.coll(collObservations).FindOne(ctx, byID(source)).Raw()
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, mapErr(err)
	}
	var p observationsPayload
	if err := fromField(raw, "payload", &p); err != nil {
		return nil, err
	}
	out := &ports.ObservationOverlay{Source: p.Source, ObservedAt: p.ObservedAt, IsExample: p.IsExample, Entities: map[domain.EntityID]ports.ObservedState{}}
	for _, e := range p.Entities {
		out.Entities[e.ID] = e.State
	}
	return out, nil
}

// SaveObservations replaces the source's overlay in one document.
func (r *IntegrationRepository) SaveObservations(ctx context.Context, overlay *ports.ObservationOverlay) error {
	p := observationsPayload{Source: overlay.Source, ObservedAt: overlay.ObservedAt, IsExample: overlay.IsExample, Entities: []observedEntity{}}
	for _, id := range slices.Sorted(maps.Keys(overlay.Entities)) {
		p.Entities = append(p.Entities, observedEntity{ID: id, State: overlay.Entities[id]})
	}
	payload, err := toDocument(p)
	if err != nil {
		return err
	}
	doc := bson.D{{Key: "_id", Value: overlay.Source}, {Key: "observedAt", Value: overlay.ObservedAt}, {Key: "payload", Value: payload}}
	_, err = r.s.coll(collObservations).ReplaceOne(ctx, byID(overlay.Source), doc, options.Replace().SetUpsert(true))
	return mapErr(err)
}
