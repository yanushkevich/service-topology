package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/fixtures"
)

func TestValidateMockFixture(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"validate"}, &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s %s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "valid") {
		t.Fatalf("output: %s", out.String())
	}
}

func TestValidateReportsIssues(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	// Extract the topology of a conformance case into a plain TopologyData file.
	raw, err := os.ReadFile(filepath.Join(dir, "conformance", "validation", "parent-cycle.json"))
	if err != nil {
		t.Fatal(err)
	}
	var c fixtures.ValidationCase
	if err := fixtures.DecodeStrict(raw, &c); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "cycle.json")
	b, _ := jsonMarshal(c.Topology)
	if err := os.WriteFile(file, b, 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errOut bytes.Buffer
	if code := run([]string{"validate", file}, &out, &errOut); code != 1 || !strings.Contains(out.String(), "parent-cycle") {
		t.Fatalf("exit %d: %s", code, out.String())
	}
}

func TestDatabaseCommandsAreNotAvailableYet(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := run([]string{"schema-check"}, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "B2") {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
}
