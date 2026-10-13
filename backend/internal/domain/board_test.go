package domain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

// Board rules must give the TypeScript reference's codes and paths, in order (ADR-031).
func TestBoardValidationConformance(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "conformance", "boards", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 10 {
		t.Fatalf("expected the board conformance set, found %d files", len(files))
	}
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var c fixtures.BoardCase
			if err := fixtures.DecodeStrict(raw, &c); err != nil {
				t.Fatalf("decode: %v", err)
			}
			topology, err := fixtures.LoadTopology(filepath.Join(dir, c.Topology))
			if err != nil {
				t.Fatal(err)
			}
			got := []fixtures.BoardIssue{}
			for _, issue := range domain.ValidateBoard(&c.Definition, topology) {
				got = append(got, fixtures.BoardIssue{Code: issue.Code, Path: issue.Path})
			}
			want := c.Expected
			if want == nil {
				want = []fixtures.BoardIssue{}
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s\n got: %+v\nwant: %+v", c.Description, got, want)
			}
		})
	}
}

// The board enumerations equal the board schema's.
func TestBoardEnumsMatchTheSchema(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "schemas", "transit-board-definition.v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Defs map[string]struct {
			Properties map[string]struct {
				Enum  []string `json:"enum"`
				Items struct {
					Enum []string `json:"enum"`
				} `json:"items"`
			} `json:"properties"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}
	for name, pair := range map[string][2][]string{
		"station kind": {domain.BoardStationKindValues, schema.Defs["Station"].Properties["kind"].Enum},
		"line group":   {domain.BoardLineGroupValues, schema.Defs["Line"].Properties["group"].Enum},
		"policy type":  {domain.BoardPolicyTypeValues, schema.Defs["Policy"].Properties["type"].Enum},
		"pattern":      {domain.PatternIDs, schema.Defs["Line"].Properties["patterns"].Items.Enum},
	} {
		if !reflect.DeepEqual(pair[0], pair[1]) {
			t.Errorf("%s: code %v, schema %v", name, pair[0], pair[1])
		}
	}
}
