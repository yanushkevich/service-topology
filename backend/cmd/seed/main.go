// Command seed works with the shared fixtures (fixtures/). In Milestone B1 it validates them; writing
// them to ArcadeDB (`seed load`) and `schema-check` arrive with the adapter in Milestone B2.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

const usage = `usage: seed <command>

  validate [file]   validate a TopologyData JSON file (default: fixtures/topology/mock.v1.json)
  schema-check      verify ArcadeDB types and indexes (available in Milestone B2)
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
	case "schema-check", "load":
		fmt.Fprintf(stderr, "seed %s needs the ArcadeDB adapter (Milestone B2); not available yet\n", args[0])
		return 2
	default:
		fmt.Fprint(stderr, usage)
		return 2
	}
}

func validate(args []string, stdout, stderr io.Writer) int {
	path := ""
	if len(args) > 0 {
		path = args[0]
	} else {
		dir, err := fixtures.Dir()
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		path = filepath.Join(dir, "topology", "mock.v1.json")
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
