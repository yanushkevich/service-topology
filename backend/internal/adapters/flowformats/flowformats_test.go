package flowformats_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/adapters/flowformats"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

func example(t *testing.T, name string) []byte {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "flows", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func mock(t *testing.T) *domain.TopologyData {
	t.Helper()
	dir, _ := fixtures.Dir()
	data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", "mock.v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// withFlows validates the example topology plus imported flows (as the importer does).
func withFlows(t *testing.T, flows []domain.BusinessFlow) []domain.Issue {
	t.Helper()
	data := mock(t)
	for _, f := range flows {
		f.Source = domain.FlowSource{Kind: "imported"}
		data.BusinessFlows = append(data.BusinessFlows, f)
	}
	return domain.Validate(data)
}

func TestNativeYAMLAndJSON(t *testing.T) {
	flows, err := flowformats.Native{}.Decode(example(t, "daily-payout.flow.yaml"), ports.FlowMapping{})
	if err != nil {
		t.Fatal(err)
	}
	if len(flows) != 1 || flows[0].ID != "flow-daily-payout" || len(flows[0].Steps) != 3 || flows[0].Transitions[0].Policies[0].Config["timeoutMs"] != "60000" {
		t.Fatalf("decoded: %+v", flows)
	}
	if issues := withFlows(t, flows); issues != nil {
		t.Fatalf("example flow must validate against the example topology: %v", issues)
	}
	// JSON, and a {"flows": [...]} wrapper.
	wrapped := `{"flows":[{"id":"flow-a","name":"A","trigger":{"kind":"manual"},"startStepId":"s","steps":[{"id":"s","name":"S","serviceDefinitionId":"order-service","kind":"task"}],"transitions":[{"id":"t","from":"s","to":"o","via":{"kind":"local"}}],"outcomes":[{"id":"o","name":"O","kind":"success"}]}]}`
	flows, err = flowformats.Native{}.Decode([]byte(wrapped), ports.FlowMapping{})
	if err != nil || len(flows) != 1 || flows[0].Transitions[0].Policies == nil {
		t.Fatalf("wrapped JSON: %v %+v", err, flows)
	}
	// Unknown fields and empty files are reported, not ignored.
	var ie *ports.ImportError
	if _, err := (flowformats.Native{}).Decode([]byte("id: x\nname: X\nsurprise: 1\n"), ports.FlowMapping{}); !errors.As(err, &ie) || !strings.Contains(ie.Error(), "surprise") {
		t.Fatalf("unknown field: %v", err)
	}
	if _, err := (flowformats.Native{}).Decode([]byte("  "), ports.FlowMapping{}); !errors.As(err, &ie) {
		t.Fatalf("empty: %v", err)
	}
}

func TestBPMN(t *testing.T) {
	flows, err := flowformats.BPMN{}.Decode(example(t, "order-cancellation.bpmn"), ports.FlowMapping{})
	if err != nil {
		t.Fatal(err)
	}
	if len(flows) != 1 {
		t.Fatalf("flows: %d", len(flows))
	}
	f := flows[0]
	if f.ID != "flow-order-cancellation" || f.Name != "Order cancellation" || f.StartStepID != "Task_cancel" {
		t.Fatalf("flow: %+v", f)
	}
	step := func(id string) domain.FlowStep {
		for _, s := range f.Steps {
			if s.ID == id {
				return s
			}
		}
		t.Fatalf("no step %s", id)
		return domain.FlowStep{}
	}
	if s := step("Task_cancel"); s.Kind != "decision" || s.ServiceDefinitionID != "order-service" || s.EntryPoint == nil || *s.EntryPoint != "CancelOrder" {
		t.Fatalf("exclusive gateway makes the task before it a decision: %+v", s)
	}
	if s := step("Task_void"); s.DeadlineMs == nil || *s.DeadlineMs != 30_000 {
		t.Fatalf("boundary timer PT30S becomes a 30 s deadline: %+v", s)
	}
	if s := step("Task_release"); s.Kind != "wait" {
		t.Fatalf("receive task waits: %+v", s)
	}
	transitions := map[string]domain.FlowTransition{}
	for _, tr := range f.Transitions {
		transitions[tr.ID] = tr
	}
	if tr := transitions["Flow_void"]; tr.From != "Task_cancel" || tr.To != "Task_void" || tr.Via.Kind != "call" || tr.Condition == nil || *tr.Condition != "payment was authorized" {
		t.Fatalf("gateway folded into a conditional call: %+v", tr)
	}
	if tr := transitions["Flow_release"]; tr.Via.Kind != "event" || *tr.Via.EventTypeID != "event-order-cancelled" {
		t.Fatalf("st:eventType makes an event hand-off: %+v", tr)
	}
	if len(f.Outcomes) != 1 || f.Outcomes[0].Kind != "success" {
		t.Fatalf("outcomes: %+v", f.Outcomes)
	}
	if issues := withFlows(t, flows); issues != nil {
		t.Fatalf("imported BPMN must validate against the example topology: %v", issues)
	}
}

func TestBPMNRejectsUnmappedTasksAndAcceptsAMapping(t *testing.T) {
	raw := strings.ReplaceAll(string(example(t, "order-cancellation.bpmn")), ` st:service="payment-service"`, "")
	_, err := flowformats.BPMN{}.Decode([]byte(raw), ports.FlowMapping{})
	var ie *ports.ImportError
	if !errors.As(err, &ie) || len(ie.Problems) != 1 || ie.Problems[0].Element != "Task_void" || !strings.Contains(ie.Problems[0].Message, `"Void authorization" has no service`) {
		t.Fatalf("unmapped task must be named: %v", err)
	}
	flows, err := flowformats.BPMN{}.Decode([]byte(raw), ports.FlowMapping{Tasks: map[string]string{"Task_void": "payment-service"}})
	if err != nil || flows[0].Steps[1].ServiceDefinitionID == "" {
		t.Fatalf("mapping: %v", err)
	}
	if _, err := (flowformats.BPMN{}).Decode([]byte("<nope"), ports.FlowMapping{}); !errors.As(err, &ie) {
		t.Fatalf("invalid XML: %v", err)
	}
}
