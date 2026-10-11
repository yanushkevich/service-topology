// Command seed validates shared fixtures (fixtures/) and loads them into ArcadeDB
// (docs/backend/LOCAL_DEVELOPMENT.md). Database settings come from the ARCADEDB_* environment.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

const usage = `usage: seed <command>

  validate [file]   validate a TopologyData JSON file (default: fixtures/topology/mock.v1.json)
  load [file]       create the database and schema if needed, then replace the stored topology
                    with the file (idempotent; snapshots and layouts are untouched)
  schema-check      verify the database, types, unique indexes, and schema version
`

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "validate":
		return validate(args[1:], stdout, stderr)
	case "load":
		return load(args[1:], os.Getenv, stdout, stderr)
	case "schema-check":
		return schemaCheck(os.Getenv, stdout, stderr)
	default:
		fmt.Fprint(stderr, usage)
		return 2
	}
}

func fixturePath(args []string) (string, error) {
	if len(args) > 0 {
		return args[0], nil
	}
	dir, err := fixtures.Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "topology", "mock.v1.json"), nil
}

func validate(args []string, stdout, stderr io.Writer) int {
	path, err := fixturePath(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	data, err := fixtures.LoadTopology(path)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "%s: %d environments, %d definitions, %d instances, %d resources, %d relationships, %d event types\n",
		path, len(data.Environments), len(data.ServiceDefinitions), len(data.ServiceInstances), len(data.Resources), len(data.Relationships), len(data.EventTypes))
	issues := domain.Validate(data)
	for _, i := range issues {
		fmt.Fprintf(stdout, "%s %s %s: %s\n", i.Severity, i.Code, i.EntityID, i.Message)
	}
	if len(issues) > 0 {
		fmt.Fprintf(stderr, "%d validation issue(s)\n", len(issues))
		return 1
	}
	fmt.Fprintln(stdout, "valid")
	return 0
}

func client(getenv func(string) string, stderr io.Writer) *arcadedb.Client {
	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintf(stderr, "invalid configuration:\n%v\n", err)
		return nil
	}
	if cfg.ArcadeDB == nil {
		fmt.Fprintln(stderr, "ARCADEDB_BASE_URL is not set (see docs/backend/LOCAL_DEVELOPMENT.md)")
		return nil
	}
	c, err := arcadedb.NewClient(cfg.ArcadeDB)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return nil
	}
	return c
}

func load(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	path, err := fixturePath(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	data, err := fixtures.LoadTopology(path)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	c := client(getenv, stderr)
	if c == nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		fmt.Fprintf(stderr, "schema: %v\n", err)
		return 1
	}
	res, err := arcadedb.NewTopologyRepository(c).ReplaceTopology(ctx, data, "fixture")
	if err != nil {
		var v *arcadedb.ValidationError
		if errors.As(err, &v) {
			for _, i := range v.Issues {
				fmt.Fprintf(stdout, "%s %s %s: %s\n", i.Severity, i.Code, i.EntityID, i.Message)
			}
		}
		fmt.Fprintf(stderr, "load: %v (nothing was written)\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "loaded %s into database %q: vertices %v, edges %v\n", path, c.Database(), res.Vertices, res.Edges)
	return 0
}

func schemaCheck(getenv func(string) string, stdout, stderr io.Writer) int {
	c := client(getenv, stderr)
	if c == nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := arcadedb.CheckSchema(ctx, c); err != nil {
		fmt.Fprintf(stderr, "schema-check: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "schema-check: database %q has schema version %d with all types and unique indexes\n", c.Database(), arcadedb.SchemaVersion)
	return 0
}
