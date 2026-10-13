// Command importflows imports workflow definitions into the stored topology as business flows
// (ADR-022, docs/BUSINESS_FLOWS.md §4): a native JSON/YAML flow file or BPMN 2.0 XML. The import is
// idempotent, validates the whole topology before writing, and never overwrites an authored flow.
// Database settings come from the MONGODB_* environment, like cmd/seed.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"servicetopology/backend/internal/adapters/flowformats"
	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

func main() { os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr)) }

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("importflows", flag.ContinueOnError)
	fs.SetOutput(stderr)
	format := fs.String("format", "", "native or bpmn (default: bpmn for .bpmn/.xml files, else native)")
	mappingPath := fs.String("mapping", "", "JSON file mapping tasks to services and flows to event types")
	ref := fs.String("ref", "", "source shown on imported flows (default: the file name)")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: importflows [-format native|bpmn] [-mapping mapping.json] [-ref source] FILE")
	}
	if err := fs.Parse(args); err != nil || fs.NArg() != 1 {
		fs.Usage()
		return 2
	}
	path := fs.Arg(0)
	content, err := os.ReadFile(path) // #nosec G304 -- the operator names the file to import
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	req := application.FlowImport{Format: *format, Content: string(content), Ref: *ref}
	if req.Format == "" {
		req.Format = "native"
		if ext := strings.ToLower(filepath.Ext(path)); ext == ".bpmn" || ext == ".xml" {
			req.Format = "bpmn"
		}
	}
	if req.Ref == "" {
		req.Ref = filepath.Base(path)
	}
	if *mappingPath != "" {
		raw, err := os.ReadFile(*mappingPath) // #nosec G304 -- operator-supplied mapping file
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		var m ports.FlowMapping
		if err := json.Unmarshal(raw, &m); err != nil {
			fmt.Fprintf(stderr, "mapping %s: %v\n", *mappingPath, err)
			return 1
		}
		req.Mapping = m
	}

	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintf(stderr, "invalid configuration:\n%v\n", err)
		return 2
	}
	if cfg.MongoDB == nil {
		fmt.Fprintln(stderr, "MONGODB_URI is not set (see docs/backend/LOCAL_DEVELOPMENT.md)")
		return 2
	}
	store, err := mongodb.Connect(cfg.MongoDB, nil)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	defer store.Close(context.Background())
	svc := &application.Service{TopologyRepo: mongodb.NewTopologyRepository(store), FlowFormats: application.FlowFormats{"native": flowformats.Native{}, "bpmn": flowformats.BPMN{}}}
	res, err := svc.ImportFlows(ctx, req)
	if err != nil {
		var v *application.ErrValidation
		if errors.As(err, &v) {
			for _, i := range v.Issues {
				fmt.Fprintf(stdout, "%s %s %s: %s\n", i.Severity, i.Code, i.EntityID, i.Message)
			}
		}
		fmt.Fprintf(stderr, "import: %v (nothing was written)\n", err)
		return 1
	}
	for _, f := range res.Flows {
		fmt.Fprintf(stdout, "%-9s %s (%s)\n", f.Status, f.ID, f.Name)
	}
	fmt.Fprintf(stdout, "revision %s\n", res.Revision)
	return 0
}
