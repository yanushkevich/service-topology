package domain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

// Registry rows, filtering, and sorting must equal the TypeScript reference (registry.ts), including
// CLDR collation order, on every case in fixtures/conformance/registry.
func TestRegistryConformance(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob(filepath.Join(dir, "conformance", "registry", "*.json"))
	if len(files) < 100 {
		t.Fatalf("expected the registry conformance set, found %d", len(files))
	}
	indexes := map[string]*domain.Index{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var c struct {
			Description   string
			Topology      string
			EnvironmentID string `json:"environmentId"`
			Filters       domain.Filters
			Sort          string
			Expected      json.RawMessage
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		ix := indexes[c.Topology]
		if ix == nil {
			data, err := fixtures.LoadTopology(filepath.Join(dir, c.Topology))
			if err != nil {
				t.Fatal(err)
			}
			ix = domain.BuildIndex(data)
			indexes[c.Topology] = ix
		}
		sortSpec, ok := domain.ParseRegistrySort(c.Sort)
		if !ok {
			t.Fatalf("%s: bad sort %q", file, c.Sort)
		}
		got := domain.SortRegistryRows(domain.FilterRegistryRows(ix.BuildRegistryRows(), c.Filters, c.EnvironmentID), sortSpec)
		gotJSON, _ := json.Marshal(got)
		var a, b any
		_ = json.Unmarshal(gotJSON, &a)
		_ = json.Unmarshal(c.Expected, &b)
		if !jsonEqual(a, b) {
			t.Errorf("%s (%s)\n got: %s\nwant: %s", filepath.Base(file), c.Description, ids(got), idsJSON(c.Expected))
		}
	}
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

func ids(rows []domain.RegistryRow) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Ref.ID)
	}
	return out
}

func idsJSON(raw json.RawMessage) []string {
	var rows []struct{ Ref domain.EntityRef }
	_ = json.Unmarshal(raw, &rows)
	out := []string{}
	for _, r := range rows {
		out = append(out, r.Ref.ID)
	}
	return out
}
