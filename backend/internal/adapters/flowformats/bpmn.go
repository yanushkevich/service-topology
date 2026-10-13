package flowformats

import (
	"encoding/xml"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// BPMN decodes BPMN 2.0 XML (docs/BUSINESS_FLOWS.md §4). Each process becomes a flow:
//   - tasks and activities become steps (user and manual tasks: manual; receive tasks and
//     intermediate catch events: wait; tasks marked isForCompensation: compensation);
//   - sequence flows become transitions; gateways are folded away (an exclusive or inclusive
//     gateway makes the task before it a decision, and its outgoing conditions become transition
//     conditions); message flows between pools become event transitions when mapped to an event
//     type, calls otherwise;
//   - end events become outcomes (error: failed, terminate: cancelled, compensate: compensated);
//   - a boundary timer on a task becomes its deadline; a compensation boundary event associated with
//     a compensation task becomes the task's compensatedBy.
//
// The service of each task is explicit, never guessed: the attribute st:service (namespace
// "https://service-topology.dev/bpmn") or the mapping's Tasks; st:entryPoint and st:eventType are
// optional. A task without a service rejects the import, naming the task.
type BPMN struct{}

func (BPMN) Name() string { return "bpmn" }

const stNamespace = "https://service-topology.dev/bpmn"

type bpmnDefinitions struct {
	Processes     []bpmnProcess     `xml:"process"`
	Collaboration bpmnCollaboration `xml:"collaboration"`
}

type bpmnCollaboration struct {
	MessageFlows []bpmnFlow        `xml:"messageFlow"`
	Participants []bpmnParticipant `xml:"participant"`
}

type bpmnParticipant struct {
	ID         string `xml:"id,attr"`
	ProcessRef string `xml:"processRef,attr"`
}

type bpmnProcess struct {
	ID       string        `xml:"id,attr"`
	Name     string        `xml:"name,attr"`
	Elements []bpmnElement `xml:",any"`
}

type bpmnElement struct {
	XMLName           xml.Name
	ID                string        `xml:"id,attr"`
	Name              string        `xml:"name,attr"`
	SourceRef         string        `xml:"sourceRef,attr"`
	TargetRef         string        `xml:"targetRef,attr"`
	AttachedTo        string        `xml:"attachedToRef,attr"`
	ForCompensation   string        `xml:"isForCompensation,attr"`
	MessageRef        string        `xml:"messageRef,attr"`
	Attrs             []xml.Attr    `xml:",any,attr"`
	Children          []bpmnElement `xml:",any"`
	Condition         string        `xml:"conditionExpression"`
	ErrorDefinition   *struct{}     `xml:"errorEventDefinition"`
	Terminate         *struct{}     `xml:"terminateEventDefinition"`
	Compensate        *struct{}     `xml:"compensateEventDefinition"`
	MessageDefinition *struct {
		MessageRef string `xml:"messageRef,attr"`
	} `xml:"messageEventDefinition"`
	TimerDefinition *struct {
		TimeDuration string `xml:"timeDuration"`
	} `xml:"timerEventDefinition"`
}

type bpmnFlow struct {
	ID         string `xml:"id,attr"`
	Name       string `xml:"name,attr"`
	SourceRef  string `xml:"sourceRef,attr"`
	TargetRef  string `xml:"targetRef,attr"`
	MessageRef string `xml:"messageRef,attr"`
}

func (e bpmnElement) attr(local string) string {
	for _, a := range e.Attrs {
		if a.Name.Local == local && a.Name.Space == stNamespace {
			return a.Value
		}
	}
	return ""
}

var taskKinds = map[string]string{
	"task": "task", "serviceTask": "task", "sendTask": "task", "scriptTask": "task", "businessRuleTask": "task", "callActivity": "task", "subProcess": "task",
	"userTask": "manual", "manualTask": "manual", "receiveTask": "wait", "intermediateCatchEvent": "wait",
}

func isGateway(local string) bool { return strings.HasSuffix(local, "Gateway") }

func (BPMN) Decode(content []byte, mapping ports.FlowMapping) ([]domain.BusinessFlow, error) {
	var defs bpmnDefinitions
	if err := xml.Unmarshal(content, &defs); err != nil {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "file", Message: "is not valid BPMN 2.0 XML: " + err.Error()}}}
	}
	if len(defs.Processes) == 0 {
		return nil, &ports.ImportError{Problems: []ports.ImportProblem{{Element: "definitions", Message: "contains no process"}}}
	}
	var problems []ports.ImportProblem
	flows := make([]domain.BusinessFlow, 0, len(defs.Processes))
	owner := map[string]int{}        // task ID → index of its flow
	serviceOf := map[string]string{} // task ID → service
	for _, p := range defs.Processes {
		flow, probs := decodeProcess(p, mapping, serviceOf)
		problems = append(problems, probs...)
		for _, s := range flow.Steps {
			owner[s.ID] = len(flows)
		}
		flows = append(flows, flow)
	}
	// Message flows between pools: a hand-off from a task in one process to a task in another. Both
	// tasks end up in the first process's flow, so a collaboration becomes one flow.
	for _, mf := range defs.Collaboration.MessageFlows {
		from, okFrom := owner[mf.SourceRef]
		to, okTo := owner[mf.TargetRef]
		if !okFrom || !okTo {
			continue
		}
		if from != to {
			flows[from].Steps = append(flows[from].Steps, flows[to].Steps...)
			flows[from].Transitions = append(flows[from].Transitions, flows[to].Transitions...)
			flows[from].Outcomes = append(flows[from].Outcomes, flows[to].Outcomes...)
			for _, s := range flows[to].Steps {
				owner[s.ID] = from
			}
			flows[to] = domain.BusinessFlow{}
		}
		via := domain.FlowTransitionVia{Kind: "call"}
		eventID := mapping.Events[mf.ID]
		if eventID == "" && mf.MessageRef != "" {
			eventID = mapping.Events["message:"+mf.MessageRef]
		}
		if eventID != "" {
			via = domain.FlowTransitionVia{Kind: "event", EventTypeID: &eventID}
		}
		flows[from].Transitions = append(flows[from].Transitions, domain.FlowTransition{ID: mf.ID, From: mf.SourceRef, To: mf.TargetRef, Via: via, Policies: []domain.FlowPolicy{}})
	}
	var out []domain.BusinessFlow
	for _, f := range flows {
		if f.ID != "" {
			out = append(out, f)
		}
	}
	if len(problems) > 0 {
		sort.SliceStable(problems, func(i, j int) bool { return problems[i].Element < problems[j].Element })
		return nil, &ports.ImportError{Problems: problems}
	}
	return out, nil
}

func decodeProcess(p bpmnProcess, mapping ports.FlowMapping, serviceOf map[string]string) (domain.BusinessFlow, []ports.ImportProblem) {
	var problems []ports.ImportProblem
	id := p.ID
	if !strings.HasPrefix(id, "flow-") {
		id = "flow-" + id
	}
	name := p.Name
	if name == "" {
		name = p.ID
	}
	flow := domain.BusinessFlow{ID: id, Name: name, Trigger: domain.FlowTrigger{Kind: "manual"}, Steps: []domain.FlowStep{}, Transitions: []domain.FlowTransition{}, Outcomes: []domain.FlowOutcome{}}

	kindOf := map[string]string{} // element ID → local name
	byID := map[string]bpmnElement{}
	var sequence []bpmnElement
	for _, e := range p.Elements {
		kindOf[e.ID] = e.XMLName.Local
		byID[e.ID] = e
		if e.XMLName.Local == "sequenceFlow" {
			sequence = append(sequence, e)
		}
	}
	deadline := map[string]float64{}
	compensationBoundary := map[string]string{} // boundary event ID → task it is attached to
	for _, e := range p.Elements {
		if e.XMLName.Local != "boundaryEvent" || e.AttachedTo == "" {
			continue
		}
		if e.TimerDefinition != nil && e.TimerDefinition.TimeDuration != "" {
			duration := strings.TrimSpace(e.TimerDefinition.TimeDuration)
			if ms, ok := isoDurationMs(duration); ok {
				deadline[e.AttachedTo] = ms
			} else {
				problems = append(problems, ports.ImportProblem{Element: e.ID, Message: fmt.Sprintf("timer duration %q is not an ISO 8601 duration such as PT10M", duration)})
			}
		}
		if e.Compensate != nil {
			compensationBoundary[e.ID] = e.AttachedTo
		}
	}
	compensatedBy := map[string]string{}
	for _, e := range p.Elements {
		if e.XMLName.Local == "association" {
			if task, ok := compensationBoundary[e.SourceRef]; ok {
				compensatedBy[task] = e.TargetRef
			}
		}
	}

	// Steps.
	for _, e := range p.Elements {
		kind, isTask := taskKinds[e.XMLName.Local]
		if !isTask {
			continue
		}
		if e.ForCompensation == "true" {
			kind = "compensation"
		}
		service := e.attr("service")
		if service == "" {
			service = mapping.Tasks[e.ID]
		}
		if service == "" {
			problems = append(problems, ports.ImportProblem{Element: e.ID, Message: fmt.Sprintf("task %q has no service: set st:service or map it in the mapping's tasks", firstNonEmpty(e.Name, e.ID))})
		}
		serviceOf[e.ID] = service
		step := domain.FlowStep{ID: e.ID, Name: firstNonEmpty(e.Name, e.ID), ServiceDefinitionID: service, Kind: kind}
		if entry := firstNonEmpty(e.attr("entryPoint"), mapping.EntryPoints[e.ID]); entry != "" {
			step.EntryPoint = &entry
		}
		if ms, ok := deadline[e.ID]; ok {
			step.DeadlineMs = &ms
		}
		if c, ok := compensatedBy[e.ID]; ok {
			step.CompensatedBy = &c
		}
		flow.Steps = append(flow.Steps, step)
	}
	isStep := func(id string) bool { _, ok := taskKinds[kindOf[id]]; return ok }

	// Outcomes.
	for _, e := range p.Elements {
		if e.XMLName.Local != "endEvent" {
			continue
		}
		kind := "success"
		switch {
		case e.ErrorDefinition != nil:
			kind = "failed"
		case e.Terminate != nil:
			kind = "cancelled"
		case e.Compensate != nil:
			kind = "compensated"
		}
		flow.Outcomes = append(flow.Outcomes, domain.FlowOutcome{ID: e.ID, Name: firstNonEmpty(e.Name, e.ID), Kind: kind})
	}
	isOutcome := func(id string) bool { return kindOf[id] == "endEvent" }

	// Transitions: follow sequence flows through gateways to the next step or outcome.
	outgoing := map[string][]bpmnElement{}
	for _, f := range sequence {
		outgoing[f.SourceRef] = append(outgoing[f.SourceRef], f)
	}
	type target struct {
		id, flowID, condition string
	}
	var reach func(from string, flowID, condition string, seen map[string]bool) []target
	reach = func(node string, flowID, condition string, seen map[string]bool) []target {
		if isStep(node) || isOutcome(node) {
			return []target{{node, flowID, condition}}
		}
		if seen[node] {
			return nil
		}
		seen[node] = true
		var out []target
		for _, f := range outgoing[node] {
			c := condition
			if fc := firstNonEmpty(strings.TrimSpace(f.Condition), f.Name); fc != "" && isGateway(kindOf[node]) && kindOf[node] != "parallelGateway" {
				c = fc
			}
			out = append(out, reach(f.TargetRef, f.ID, c, seen)...)
		}
		return out
	}
	for _, s := range flow.Steps {
		for _, f := range outgoing[s.ID] {
			cond := ""
			if isGateway(kindOf[f.TargetRef]) && (kindOf[f.TargetRef] == "exclusiveGateway" || kindOf[f.TargetRef] == "inclusiveGateway") {
				for i := range flow.Steps {
					if flow.Steps[i].ID == s.ID && flow.Steps[i].Kind == "task" {
						flow.Steps[i].Kind = "decision"
					}
				}
			} else if c := strings.TrimSpace(f.Condition); c != "" {
				cond = c
			}
			// Through a gateway, each target keeps the ID of the sequence flow that reaches it.
			for _, t := range reach(f.TargetRef, f.ID, cond, map[string]bool{}) {
				tr := domain.FlowTransition{ID: t.flowID, From: s.ID, To: t.id, Policies: []domain.FlowPolicy{}}
				if t.condition != "" {
					c := t.condition
					tr.Condition = &c
				}
				switch {
				case isOutcome(t.id) || serviceOf[t.id] == s.ServiceDefinitionID:
					tr.Via = domain.FlowTransitionVia{Kind: "local"}
				case firstNonEmpty(byID[t.flowID].attr("eventType"), mapping.Events[t.flowID]) != "":
					ev := firstNonEmpty(byID[t.flowID].attr("eventType"), mapping.Events[t.flowID])
					tr.Via = domain.FlowTransitionVia{Kind: "event", EventTypeID: &ev}
				default:
					tr.Via = domain.FlowTransitionVia{Kind: "call"}
				}
				flow.Transitions = append(flow.Transitions, tr)
			}
		}
	}

	// Start: the first step reached from a start event; its definition sets the trigger.
	for _, e := range p.Elements {
		if e.XMLName.Local != "startEvent" {
			continue
		}
		for _, f := range outgoing[e.ID] {
			if targets := reach(f.TargetRef, f.ID, "", map[string]bool{}); len(targets) > 0 && flow.StartStepID == "" {
				flow.StartStepID = targets[0].id
			}
		}
		switch {
		case e.MessageDefinition != nil:
			flow.Trigger = domain.FlowTrigger{Kind: "event"}
			if ev := firstNonEmpty(e.attr("eventType"), mapping.Events["message:"+e.MessageDefinition.MessageRef], mapping.Events[e.ID]); ev != "" {
				flow.Trigger.Ref = &ev
			}
		case e.TimerDefinition != nil:
			flow.Trigger = domain.FlowTrigger{Kind: "schedule"}
		}
	}
	if flow.StartStepID == "" {
		problems = append(problems, ports.ImportProblem{Element: p.ID, Message: "has no start event leading to a task"})
	}
	if len(flow.Outcomes) == 0 {
		problems = append(problems, ports.ImportProblem{Element: p.ID, Message: "has no end event"})
	}
	return flow, problems
}

var isoDuration = regexp.MustCompile(`^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$`)

// isoDurationMs parses the ISO 8601 durations BPMN timers use (P1D, PT10M, PT1H30M, PT2.5S).
func isoDurationMs(s string) (float64, bool) {
	m := isoDuration.FindStringSubmatch(s)
	if m == nil || s == "P" || s == "PT" {
		return 0, false
	}
	units := []float64{86_400_000, 3_600_000, 60_000, 1000}
	total := 0.0
	for i, part := range m[1:] {
		if part == "" {
			continue
		}
		v, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return 0, false
		}
		total += v * units[i]
	}
	return total, true
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
