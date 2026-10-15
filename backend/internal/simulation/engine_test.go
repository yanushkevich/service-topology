package simulation_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/simulation"
)

type action struct {
	Type          string
	EntityID      string `json:"entityId"`
	Mode          string
	DurationTicks int `json:"durationTicks"`
	Ticks         int
}

func canonical(t *testing.T, v any) string {
	t.Helper()
	b, _ := json.Marshal(v)
	var x any
	_ = json.Unmarshal(b, &x)
	out, _ := json.Marshal(x)
	return string(out)
}

// Every state of every scripted scenario must equal the TypeScript engine's.
func TestEngineConformance(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "conformance", "simulation", "scenarios.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Topology  string
		Scenarios []struct {
			Name     string
			Seed     uint32
			StartAt  string `json:"startAt"`
			Observed []string
			Actions  []action
			States   []map[string]json.RawMessage
		}
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	baseline, err := fixtures.LoadTopology(filepath.Join(dir, file.Topology))
	if err != nil {
		t.Fatal(err)
	}
	for _, sc := range file.Scenarios {
		t.Run(sc.Name, func(t *testing.T) {
			state := simulation.Create(withObservedMetrics(t, baseline, sc.Observed), sc.Seed, sc.StartAt)
			check := func(step int) {
				want := sc.States[step]
				got := map[string]any{"tick": state.Tick, "clock": state.Clock, "rng": state.RNG, "drift": state.Drift, "anomalies": state.Anomalies,
					"failures": state.Failures, "impacts": state.Impacts, "events": state.Events, "eventSeq": state.EventSeq, "data": state.Data}
				for key, w := range want {
					if g := canonical(t, got[key]); g != canonical(t, w) {
						t.Fatalf("after action %d, %s differs\n got: %.500s\nwant: %.500s", step, key, g, canonical(t, w))
					}
				}
			}
			check(0)
			for i, a := range sc.Actions {
				switch a.Type {
				case "inject":
					next, err := state.Inject(a.EntityID, a.Mode, a.DurationTicks)
					if err != nil {
						t.Fatal(err)
					}
					state = next
				case "recover":
					state = state.Recover(a.EntityID)
				case "recoverAll":
					state = state.RecoverAll()
				case "step":
					state = state.Step(a.Ticks)
				case "reset":
					state = state.Reset("")
				}
				check(i + 1)
			}
		})
	}
}

// withObservedMetrics marks the listed instances' metrics observed, as the fixture generator does.
func withObservedMetrics(t *testing.T, data *domain.TopologyData, ids []string) *domain.TopologyData {
	t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	out := &domain.TopologyData{}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatal(err)
	}
	for i := range out.ServiceInstances {
		if m := out.ServiceInstances[i].Metrics; m != nil && slices.Contains(ids, out.ServiceInstances[i].ID) {
			m.IsSimulated = false
		}
	}
	return out
}

func TestDiffConformance(t *testing.T) {
	dir, _ := fixtures.Dir()
	raw, err := os.ReadFile(filepath.Join(dir, "conformance", "history", "diffs.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Before, After string
			Expected      json.RawMessage
		}
	}
	_ = json.Unmarshal(raw, &file)
	load := func(id string) *domain.TopologyData {
		if id == "mock" {
			d, err := fixtures.LoadTopology(filepath.Join(dir, "topology", "mock.v1.json"))
			if err != nil {
				t.Fatal(err)
			}
			return d
		}
		b, err := os.ReadFile(filepath.Join(dir, "snapshots", id+".v1.json"))
		if err != nil {
			t.Fatal(err)
		}
		var s domain.Snapshot
		if err := fixtures.DecodeStrict(b, &s); err != nil {
			t.Fatal(err)
		}
		return &s.Data
	}
	for _, c := range file.Cases {
		if g, w := canonical(t, domain.DiffTopology(load(c.Before), load(c.After))), canonical(t, c.Expected); g != w {
			t.Errorf("%s → %s\n got: %.400s\nwant: %.400s", c.Before, c.After, g, w)
		}
	}
}

func TestToFixedMatchesJavaScript(t *testing.T) {
	for in, want := range map[float64]string{1.125: "1.13", 1.355: "1.35", 1.4: "1.40", 0.005: "0.01", 1.6: "1.60", 1.345: "1.34"} {
		if got := simulation.SimulationToFixed(in); got != want {
			t.Errorf("toFixed(%v) = %s, want %s", in, got, want)
		}
	}
}
