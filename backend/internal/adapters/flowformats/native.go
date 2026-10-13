// Package flowformats decodes workflow definitions into business flows (ADR-022,
// docs/BUSINESS_FLOWS.md §4): the native JSON/YAML flow file and BPMN 2.0 XML.
package flowformats

import (
	"bytes"
	"encoding/json"
	"fmt"

	"go.yaml.in/yaml/v3"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Native decodes the native flow definition file (schemas/business-flow.v1.schema.json): one
// BusinessFlow, or {"flows": [...]}, as JSON or YAML. `source` is set by the importer, not the file.
type Native struct{}

func (Native) Name() string { return "native" }

func (Native) Decode(content []byte, _ ports.FlowMapping) ([]domain.BusinessFlow, error) {
	raw := bytes.TrimSpace(content)
	if len(raw) == 0 {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "file", Message: "is empty"}}}
	}
	// YAML is a superset of JSON: decode generically, then strictly through JSON so unknown fields
	// and wrong types are reported exactly as for the API.
	var generic any
	if err := yaml.Unmarshal(raw, &generic); err != nil {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "file", Message: "is not valid JSON or YAML: " + err.Error()}}}
	}
	asJSON, err := json.Marshal(generic)
	if err != nil {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "file", Message: "cannot be read: " + err.Error()}}}
	}
	var wrapper struct {
		Flows []json.RawMessage `json:"flows"`
	}
	items := []json.RawMessage{asJSON}
	if m, ok := generic.(map[string]any); ok {
		if _, has := m["flows"]; has {
			if err := json.Unmarshal(asJSON, &wrapper); err != nil {
				return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "flows", Message: err.Error()}}}
			}
			items = wrapper.Flows
		}
	}
	var out []domain.BusinessFlow
	var problems []ports.ImportProblem
	for i, item := range items {
		var flow domain.BusinessFlow
		if err := fixtures.DecodeStrict(item, &flow); err != nil {
			problems = append(problems, ports.ImportProblem{Element: fmt.Sprintf("flows[%d]", i), Message: err.Error()})
			continue
		}
		if flow.Transitions == nil {
			flow.Transitions = []domain.FlowTransition{}
		}
		for t := range flow.Transitions {
			if flow.Transitions[t].Policies == nil {
				flow.Transitions[t].Policies = []domain.FlowPolicy{}
			}
		}
		out = append(out, flow)
	}
	if len(problems) > 0 {
		return nil, &ports.ImportError{Problems: problems}
	}
	if len(out) == 0 {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "flows", Message: "contains no flow"}}}
	}
	return out, nil
}
