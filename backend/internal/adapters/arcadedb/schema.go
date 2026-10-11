package arcadedb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// SchemaVersion is the version of the types, properties, and indexes below. Bump it with additive
// changes only; record breaking ones in docs/backend/DATABASE_DECISIONS.md.
const SchemaVersion = 1

// Vertex types for canonical entities (docs/backend/PERSISTENCE.md). Each has a unique `id`.
var vertexTypes = []string{"Environment", "ServiceDefinition", "ServiceInstance", "Resource", "EventType"}

// Edge types. Only COMMUNICATES has an application ID (the relationship ID); the others are derived
// from reference properties and have none.
var edgeTypes = []string{"COMMUNICATES", "CONTAINS", "HOSTED_IN", "INSTANCE_OF", "IN_ENVIRONMENT", "CARRIED_ON", "PRODUCED_BY", "CONSUMED_BY"}

// schemaInfoType is a document type holding the applied schema version.
const schemaInfoType = "SchemaInfo"

// ddl returns the idempotent schema statements. All names are constants from this file, never input.
func ddl() []string {
	var s []string
	for _, t := range vertexTypes {
		s = append(s,
			"CREATE VERTEX TYPE "+t+" IF NOT EXISTS",
			"CREATE PROPERTY "+t+".id IF NOT EXISTS STRING (mandatory true, notnull true)",
			"CREATE PROPERTY "+t+".ord IF NOT EXISTS INTEGER",
			"CREATE INDEX IF NOT EXISTS ON "+t+" (id) UNIQUE",
		)
	}
	for _, t := range edgeTypes {
		s = append(s, "CREATE EDGE TYPE "+t+" IF NOT EXISTS")
	}
	s = append(s,
		"CREATE PROPERTY COMMUNICATES.id IF NOT EXISTS STRING (mandatory true, notnull true)",
		"CREATE INDEX IF NOT EXISTS ON COMMUNICATES (id) UNIQUE",
		// Registry and topology filters (PERSISTENCE.md "Schema, constraints, and indexes").
		"CREATE PROPERTY ServiceInstance.environmentId IF NOT EXISTS STRING",
		"CREATE INDEX IF NOT EXISTS ON ServiceInstance (environmentId) NOTUNIQUE",
		"CREATE PROPERTY Resource.type IF NOT EXISTS STRING",
		"CREATE INDEX IF NOT EXISTS ON Resource (type) NOTUNIQUE",
		"CREATE PROPERTY Resource.parentResourceId IF NOT EXISTS STRING",
		"CREATE INDEX IF NOT EXISTS ON Resource (parentResourceId) NOTUNIQUE",
		"CREATE DOCUMENT TYPE "+schemaInfoType+" IF NOT EXISTS",
		"CREATE PROPERTY "+schemaInfoType+".id IF NOT EXISTS STRING (mandatory true, notnull true)",
		"CREATE INDEX IF NOT EXISTS ON "+schemaInfoType+" (id) UNIQUE",
	)
	return s
}

// ErrSchemaNewer reports a database initialized by a newer backend; this one must not touch it.
var ErrSchemaNewer = errors.New("database schema is newer than this backend")

// EnsureSchema creates the database if needed and applies the schema idempotently. It never deletes
// data. It refuses to run against a database whose schema version is newer than SchemaVersion.
func EnsureSchema(ctx context.Context, c *Client) error {
	exists, err := c.Exists(ctx)
	if err != nil {
		return err
	}
	if !exists {
		if err := c.CreateDatabase(ctx); err != nil {
			return err
		}
	} else if v, err := appliedVersion(ctx, c); err == nil && v > SchemaVersion {
		return fmt.Errorf("%w: database has version %d, backend supports %d", ErrSchemaNewer, v, SchemaVersion)
	}
	for _, stmt := range ddl() {
		if _, err := c.Command(ctx, stmt, nil); err != nil {
			return fmt.Errorf("schema statement %q: %w", stmt, err)
		}
	}
	_, err = c.Command(ctx, "UPDATE "+schemaInfoType+" SET id = 'schema', version = :version UPSERT WHERE id = 'schema'",
		map[string]any{"version": SchemaVersion})
	return err
}

func appliedVersion(ctx context.Context, c *Client) (int, error) {
	rows, err := c.Query(ctx, "SELECT version FROM "+schemaInfoType+" WHERE id = 'schema'", nil)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, errors.New("no schema version recorded")
	}
	n, ok := rows[0]["version"].(json.Number)
	if !ok {
		return 0, errors.New("schema version has an unexpected type")
	}
	v, err := n.Int64()
	return int(v), err
}

// CheckSchema verifies the database exists, every type and unique index is present, and the
// recorded version equals SchemaVersion. Used by readiness and `seed schema-check`.
func CheckSchema(ctx context.Context, c *Client) error {
	exists, err := c.Exists(ctx)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: %s", ErrDatabaseNotFound, c.Database())
	}
	types, err := c.Query(ctx, "SELECT name FROM schema:types", nil)
	if err != nil {
		return err
	}
	present := map[string]bool{}
	for _, t := range types {
		if name, ok := t["name"].(string); ok {
			present[name] = true
		}
	}
	indexes, err := c.Query(ctx, "SELECT FROM schema:indexes", nil)
	if err != nil {
		return err
	}
	uniqueID := map[string]bool{}
	for _, ix := range indexes {
		typeName, _ := ix["typeName"].(string)
		unique, _ := ix["unique"].(bool)
		props, _ := json.Marshal(ix["properties"])
		if unique && string(props) == `[["id"]]` {
			uniqueID[typeName] = true
		}
	}
	var missing []string
	for _, t := range append(append(append([]string{}, vertexTypes...), edgeTypes...), schemaInfoType) {
		if !present[t] {
			missing = append(missing, "type "+t)
		}
	}
	for _, t := range append(append([]string{}, vertexTypes...), "COMMUNICATES", schemaInfoType) {
		if !uniqueID[t] {
			missing = append(missing, "unique index "+t+"(id)")
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("schema incomplete: missing %s", strings.Join(missing, ", "))
	}
	v, err := appliedVersion(ctx, c)
	if err != nil {
		return err
	}
	if v != SchemaVersion {
		return fmt.Errorf("schema version %d, backend expects %d", v, SchemaVersion)
	}
	return nil
}
