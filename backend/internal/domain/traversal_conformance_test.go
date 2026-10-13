package domain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

// Traversal, propagation, and event flows must equal the TypeScript reference exactly (values and
// order) on every case in fixtures/conformance/{traversal,impact,eventflows}.

type caseFile struct {
	Topology string
	Cases    []json.RawMessage
}

func loadCases(t *testing.T, rel string) (*domain.Index, []json.RawMessage) {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, rel))
	if err != nil {
		t.Fatal(err)
	}
	var f caseFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	data, err := fixtures.LoadTopology(filepath.Join(dir, f.Topology))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) == 0 {
		t.Fatalf("%s has no cases", rel)
	}
	return domain.BuildIndex(data), f.Cases
}

func same(t *testing.T, label string, got any, want json.RawMessage) {
	t.Helper()
	g, _ := json.Marshal(got)
	var a, b any
	_ = json.Unmarshal(g, &a)
	_ = json.Unmarshal(want, &b)
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	if string(x) != string(y) {
		t.Errorf("%s\n got: %.600s\nwant: %.600s", label, x, y)
	}
}

func TestDependencyTreeConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/traversal/dependency-trees.json")
	for _, raw := range cases {
		var c struct {
			EntityID  string `json:"entityId"`
			Direction string
			Expected  json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		same(t, c.EntityID+" "+c.Direction, ix.DependencyTree(c.EntityID, c.Direction, 0), c.Expected)
	}
}

func TestNeighborhoodConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/traversal/neighborhoods.json")
	for _, raw := range cases {
		var c struct {
			CenterID string `json:"centerId"`
			Depth    int
			Expected json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		same(t, c.CenterID, domain.SortedIDs(ix.Neighborhood(c.CenterID, c.Depth)), c.Expected)
	}
}

func TestReachConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/traversal/reach.json")
	for _, raw := range cases {
		var c struct {
			StartID  string `json:"startId"`
			Mode     string
			Expected json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		r := ix.ReachFrom(c.StartID, c.Mode)
		same(t, c.StartID+" "+c.Mode, map[string]any{"entityIds": domain.SortedIDs(r.EntityIDs), "relationshipIds": domain.SortedIDs(r.RelationshipIDs)}, c.Expected)
	}
}

func TestImpactConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/impact/impacts.json")
	for _, raw := range cases {
		var c struct {
			Roots    []domain.FailureRoot
			Expected json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		same(t, "impact", ix.AnalyzeImpact(c.Roots), c.Expected)
	}
}

func TestEventFlowConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/eventflows/flows.json")
	for _, raw := range cases {
		var c struct {
			EnvironmentID string `json:"environmentId"`
			Expected      json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		same(t, c.EnvironmentID, ix.EventFlowsIn(c.EnvironmentID), c.Expected)
	}
}

func TestFlowImpactConformance(t *testing.T) {
	ix, cases := loadCases(t, "conformance/impact/flows.json")
	for _, raw := range cases {
		var c struct {
			Roots    []domain.FailureRoot
			Expected json.RawMessage
		}
		_ = json.Unmarshal(raw, &c)
		same(t, "flow impact", ix.FlowImpacts(c.Roots, ix.AnalyzeImpact(c.Roots)), c.Expected)
	}
}
