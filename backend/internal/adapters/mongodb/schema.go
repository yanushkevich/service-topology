package mongodb

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// SchemaVersion is the version of the collections, validators, and indexes below. Bump it with
// additive changes only; record breaking ones in docs/backend/DATABASE_DECISIONS.md.
//
// History: 1 = MongoDB layout (ADR-019): canonical collections, history, layouts, simulation runs.
const SchemaVersion = 1

// Canonical topology collections, in TopologyData order. Each document is the entity's canonical
// JSON plus _id (= the entity's stable ID) and _meta (backend-only bookkeeping).
const (
	collEnvironments       = "environments"
	collServiceDefinitions = "serviceDefinitions"
	collServiceInstances   = "serviceInstances"
	collResources          = "resources"
	collRelationships      = "relationships"
	collEventTypes         = "eventTypes"
)

// Other collections.
const (
	collTopologyState = "topologyState" // one document: revision, recordedAt, sourceType
	collSchemaInfo    = "schemaInfo"    // one document: the applied schema version
	collSnapshots     = "snapshots"
	collLayouts       = "savedLayouts"
	collRuns          = "simulationRuns"
	collEvents        = "simulationEvents"
	collTelemetry     = "telemetryObservations"
)

var canonicalCollections = []string{collEnvironments, collServiceDefinitions, collServiceInstances, collResources, collRelationships, collEventTypes}

func allCollections() []string {
	return append(slices.Clone(canonicalCollections), collTopologyState, collSchemaInfo, collSnapshots, collLayouts, collRuns, collEvents, collTelemetry)
}

type indexSpec struct {
	collection string
	keys       bson.D
	unique     bool
}

func (i indexSpec) name() string {
	parts := make([]string, len(i.keys))
	for n, k := range i.keys {
		parts[n] = fmt.Sprintf("%s_%v", k.Key, k.Value)
	}
	return strings.Join(parts, "_")
}

// indexes are created by EnsureSchema and verified by CheckSchema (names are derived from keys).
// Every collection also has MongoDB's unique _id index, which enforces stable-ID uniqueness.
func indexes() []indexSpec {
	var s []indexSpec
	for _, c := range canonicalCollections {
		s = append(s, indexSpec{c, bson.D{{Key: "_meta.ord", Value: 1}}, false}) // reads in canonical order
	}
	return append(s,
		// Bounded traversal ($graphLookup) and subgraph loads (PERSISTENCE.md "Query routing").
		indexSpec{collRelationships, bson.D{{Key: "sourceEntityId", Value: 1}}, false},
		indexSpec{collRelationships, bson.D{{Key: "targetEntityId", Value: 1}}, false},
		indexSpec{collRelationships, bson.D{{Key: "_meta.endpoints", Value: 1}}, false},
		// Registry and topology filters.
		indexSpec{collServiceInstances, bson.D{{Key: "environmentId", Value: 1}}, false},
		indexSpec{collResources, bson.D{{Key: "type", Value: 1}}, false},
		indexSpec{collResources, bson.D{{Key: "parentResourceId", Value: 1}}, false},
		indexSpec{collSnapshots, bson.D{{Key: "takenAt", Value: 1}}, false},
		indexSpec{collRuns, bson.D{{Key: "createdAt", Value: 1}}, false},
		// A run's records, in order; seq is unique within a run.
		indexSpec{collEvents, bson.D{{Key: "simulationId", Value: 1}, {Key: "seq", Value: 1}}, true},
		indexSpec{collTelemetry, bson.D{{Key: "simulationId", Value: 1}, {Key: "seq", Value: 1}}, true},
	)
}

// validator is the $jsonSchema every canonical document must satisfy: a string id equal in type to
// _id, and the backend bookkeeping. Domain rules are enforced by validation before writing; this
// guards against writes that bypass the adapter.
func validator() bson.D {
	return bson.D{{Key: "$jsonSchema", Value: bson.D{
		{Key: "bsonType", Value: "object"},
		{Key: "required", Value: bson.A{"_id", "id", "_meta"}},
		{Key: "properties", Value: bson.D{
			{Key: "_id", Value: bson.D{{Key: "bsonType", Value: "string"}}},
			{Key: "id", Value: bson.D{{Key: "bsonType", Value: "string"}, {Key: "minLength", Value: 1}}},
			{Key: "_meta", Value: bson.D{
				{Key: "bsonType", Value: "object"},
				{Key: "required", Value: bson.A{"ord", "recordedAt", "sourceType"}},
			}},
		}},
	}}}
}

// ErrSchemaNewer reports a database initialized by a newer backend; this one must not touch it.
var ErrSchemaNewer = errors.New("database schema is newer than this backend")

// EnsureSchema creates missing collections, validators, and indexes idempotently and records the
// schema version. It never deletes data and refuses a database with a newer schema version.
func EnsureSchema(ctx context.Context, s *Store) error {
	if v, err := appliedVersion(ctx, s); err == nil && v > SchemaVersion {
		return fmt.Errorf("%w: database has version %d, backend supports %d", ErrSchemaNewer, v, SchemaVersion)
	}
	existing, err := s.db().ListCollectionNames(ctx, bson.D{})
	if err != nil {
		return mapErr(err)
	}
	for _, c := range allCollections() {
		if slices.Contains(existing, c) {
			continue
		}
		opts := options.CreateCollection()
		if slices.Contains(canonicalCollections, c) {
			opts.SetValidator(validator())
		}
		if err := s.db().CreateCollection(ctx, c, opts); err != nil && !isNamespaceExists(err) {
			return fmt.Errorf("create collection %s: %w", c, mapErr(err))
		}
	}
	for _, c := range canonicalCollections { // also brings older collections up to date
		cmd := bson.D{{Key: "collMod", Value: c}, {Key: "validator", Value: validator()}, {Key: "validationLevel", Value: "strict"}}
		if err := s.db().RunCommand(ctx, cmd).Err(); err != nil {
			return fmt.Errorf("validator %s: %w", c, mapErr(err))
		}
	}
	for _, ix := range indexes() {
		model := mongo.IndexModel{Keys: ix.keys, Options: options.Index().SetName(ix.name()).SetUnique(ix.unique)}
		if _, err := s.coll(ix.collection).Indexes().CreateOne(ctx, model); err != nil {
			return fmt.Errorf("index %s.%s: %w", ix.collection, ix.name(), mapErr(err))
		}
	}
	_, err = s.coll(collSchemaInfo).UpdateOne(ctx, bson.D{{Key: "_id", Value: "schema"}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "version", Value: SchemaVersion}}}}, options.UpdateOne().SetUpsert(true))
	return mapErr(err)
}

func isNamespaceExists(err error) bool {
	var ce mongo.CommandError
	return errors.As(err, &ce) && ce.Code == 48
}

func appliedVersion(ctx context.Context, s *Store) (int, error) {
	var doc struct {
		Version int `bson:"version"`
	}
	err := s.coll(collSchemaInfo).FindOne(ctx, bson.D{{Key: "_id", Value: "schema"}}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return 0, errors.New("no schema version recorded")
	}
	if err != nil {
		return 0, mapErr(err)
	}
	return doc.Version, nil
}

// CheckSchema verifies the database exists, every collection, validator, and index is present, and
// the recorded version equals SchemaVersion. Used by `seed schema-check` and restores.
func CheckSchema(ctx context.Context, s *Store) error {
	exists, err := s.Exists(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: %s", ErrDatabaseNotFound, s.Database())
	}
	specs, err := s.db().ListCollectionSpecifications(ctx, bson.D{})
	if err != nil {
		return mapErr(err)
	}
	present := map[string]bool{}
	validated := map[string]bool{}
	for _, spec := range specs {
		present[spec.Name] = true
		if v, err := spec.Options.LookupErr("validator"); err == nil && v.Type == bson.TypeEmbeddedDocument {
			validated[spec.Name] = true
		}
	}
	var missing []string
	for _, c := range allCollections() {
		if !present[c] {
			missing = append(missing, "collection "+c)
		}
	}
	for _, c := range canonicalCollections {
		if present[c] && !validated[c] {
			missing = append(missing, "validator "+c)
		}
	}
	names := map[string]map[string]bool{}
	for _, ix := range indexes() {
		if !present[ix.collection] {
			continue
		}
		if names[ix.collection] == nil {
			specs, err := s.coll(ix.collection).Indexes().ListSpecifications(ctx)
			if err != nil {
				return mapErr(err)
			}
			names[ix.collection] = map[string]bool{}
			for _, sp := range specs {
				names[ix.collection][sp.Name] = true
			}
		}
		if !names[ix.collection][ix.name()] {
			missing = append(missing, "index "+ix.collection+"."+ix.name())
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("schema incomplete: missing %s", strings.Join(missing, ", "))
	}
	v, err := appliedVersion(ctx, s)
	if err != nil {
		return err
	}
	if v != SchemaVersion {
		return fmt.Errorf("schema version %d, backend expects %d", v, SchemaVersion)
	}
	return nil
}
