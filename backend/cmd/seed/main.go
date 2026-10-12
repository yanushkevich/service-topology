// Command seed validates shared fixtures (fixtures/) and loads them into MongoDB
// (docs/backend/LOCAL_DEVELOPMENT.md). Database settings come from the MONGODB_* environment.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

const usage = `usage: seed <command>

  validate [file]   validate a TopologyData JSON file (default: fixtures/topology/mock.v1.json)
  load [file]       create the collections and indexes if needed, then replace the stored topology
                    with the file (idempotent; snapshots and layouts are untouched)
  schema-check      verify the database, collections, validators, indexes, and schema version
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

func client(getenv func(string) string, stderr io.Writer) *mongodb.Store {
	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintf(stderr, "invalid configuration:\n%v\n", err)
		return nil
	}
	if cfg.MongoDB == nil {
		fmt.Fprintln(stderr, "MONGODB_URI is not set (see docs/backend/LOCAL_DEVELOPMENT.md)")
		return nil
	}
	c, err := mongodb.Connect(cfg.MongoDB, nil)
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
	defer c.Close(context.Background())
	if err := mongodb.EnsureSchema(ctx, c); err != nil {
		fmt.Fprintf(stderr, "schema: %v\n", err)
		return 1
	}
	res, err := mongodb.NewTopologyRepository(c).ReplaceTopology(ctx, data, "fixture")
	if err != nil {
		var v *mongodb.ValidationError
		if errors.As(err, &v) {
			for _, i := range v.Issues {
				fmt.Fprintf(stdout, "%s %s %s: %s\n", i.Severity, i.Code, i.EntityID, i.Message)
			}
		}
		fmt.Fprintf(stderr, "load: %v (nothing was written)\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "loaded %s into database %q: documents %v\n", path, c.Database(), res.Documents)
	if len(args) == 0 {
		// Default load also brings in the history fixtures the frontend uses.
		if code := loadSnapshots(ctx, c, stdout, stderr); code != 0 {
			return code
		}
	}
	return 0
}

// loadSnapshots stores fixtures/snapshots/*.json. Snapshots are immutable: an identical stored
// snapshot is skipped, a different one with the same ID is an error (never overwritten).
func loadSnapshots(ctx context.Context, c *mongodb.Store, stdout, stderr io.Writer) int {
	dir, err := fixtures.Dir()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	files, _ := filepath.Glob(filepath.Join(dir, "snapshots", "*.json"))
	repo := mongodb.NewSnapshotRepository(c)
	added, same := 0, 0
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		var snap domain.Snapshot
		if err := fixtures.DecodeStrict(raw, &snap); err != nil {
			fmt.Fprintf(stderr, "%s: %v\n", file, err)
			return 1
		}
		if issues := domain.ValidateSnapshot(&snap); len(issues) > 0 {
			fmt.Fprintf(stderr, "%s: invalid snapshot: %s %s\n", file, issues[0].Code, issues[0].Message)
			return 1
		}
		existing, err := repo.Get(ctx, snap.ID)
		switch {
		case errors.Is(err, ports.ErrNotFound):
			if err := repo.Save(ctx, &snap); err != nil {
				fmt.Fprintf(stderr, "snapshot %s: %v\n", snap.ID, err)
				return 1
			}
			added++
		case err != nil:
			fmt.Fprintf(stderr, "snapshot %s: %v\n", snap.ID, err)
			return 1
		default:
			a, _ := json.Marshal(existing)
			b, _ := json.Marshal(&snap)
			if string(a) != string(b) {
				fmt.Fprintf(stderr, "snapshot %s already exists with different content; snapshots are immutable\n", snap.ID)
				return 1
			}
			same++
		}
	}
	fmt.Fprintf(stdout, "snapshots: %d added, %d already present\n", added, same)
	return 0
}

func schemaCheck(getenv func(string) string, stdout, stderr io.Writer) int {
	c := client(getenv, stderr)
	if c == nil {
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	defer c.Close(context.Background())
	if err := mongodb.CheckSchema(ctx, c); err != nil {
		fmt.Fprintf(stderr, "schema-check: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "schema-check: database %q has schema version %d with all collections, validators, and indexes\n", c.Database(), mongodb.SchemaVersion)
	return 0
}
