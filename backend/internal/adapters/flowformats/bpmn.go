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
	id := p.ID
	if !strings.HasPrefix(id, "flow-") {
		id = "flow-" + id
	}
	pr := newProcessReader(p, mapping, serviceOf)
	pr.flow = domain.BusinessFlow{ID: id, Name: firstNonEmpty(p.Name, p.ID), Trigger: domain.FlowTrigger{Kind: "manual"}, Steps: []domain.FlowStep{}, Transitions: []domain.FlowTransition{}, Outcomes: []domain.FlowOutcome{}}
	pr.readBoundaries()
	pr.readSteps()
	pr.readOutcomes()
	pr.readTransitions()
	pr.readStart()
	if pr.flow.StartStepID == "" {
		pr.problem(p.ID, "has no start event leading to a task")
	}
	if len(pr.flow.Outcomes) == 0 {
		pr.problem(p.ID, "has no end event")
	}
	return pr.flow, pr.problems
}

// processReader turns one BPMN process into a business flow, stage by stage. The lookups are
// built once from the process elements; serviceOf (task ID → service) is shared across processes.
type processReader struct {
	process   bpmnProcess
	mapping   ports.FlowMapping
	serviceOf map[string]string
	flow      domain.BusinessFlow
	problems  []ports.ImportProblem

	kindOf        map[string]string // element ID → local name
	byID          map[string]bpmnElement
	outgoing      map[string][]bpmnElement // element ID → sequence flows leaving it
	deadline      map[string]float64       // task ID → timer boundary duration
	compensatedBy map[string]string        // task ID → its compensation task
}

func newProcessReader(p bpmnProcess, mapping ports.FlowMapping, serviceOf map[string]string) *processReader {
	pr := &processReader{process: p, mapping: mapping, serviceOf: serviceOf, kindOf: map[string]string{}, byID: map[string]bpmnElement{},
		outgoing: map[string][]bpmnElement{}, deadline: map[string]float64{}, compensatedBy: map[string]string{}}
	for _, e := range p.Elements {
		pr.kindOf[e.ID] = e.XMLName.Local
		pr.byID[e.ID] = e
		if e.XMLName.Local == "sequenceFlow" {
			pr.outgoing[e.SourceRef] = append(pr.outgoing[e.SourceRef], e)
		}
	}
	return pr
}

func (pr *processReader) problem(element, message string) {
	pr.problems = append(pr.problems, ports.ImportProblem{Element: element, Message: message})
}

func (pr *processReader) isStep(id string) bool    { _, ok := taskKinds[pr.kindOf[id]]; return ok }
func (pr *processReader) isOutcome(id string) bool { return pr.kindOf[id] == "endEvent" }

// readBoundaries reads timer boundaries (step deadlines) and compensation boundaries, whose
// associations name the task that compensates the one they are attached to.
func (pr *processReader) readBoundaries() {
	compensationBoundary := map[string]string{} // boundary event ID → task it is attached to
	for _, e := range pr.process.Elements {
		if e.XMLName.Local != "boundaryEvent" || e.AttachedTo == "" {
			continue
		}
		if e.TimerDefinition != nil && e.TimerDefinition.TimeDuration != "" {
			duration := strings.TrimSpace(e.TimerDefinition.TimeDuration)
			if ms, ok := isoDurationMs(duration); ok {
				pr.deadline[e.AttachedTo] = ms
			} else {
				pr.problem(e.ID, fmt.Sprintf("timer duration %q is not an ISO 8601 duration such as PT10M", duration))
			}
		}
		if e.Compensate != nil {
			compensationBoundary[e.ID] = e.AttachedTo
		}
	}
	for _, e := range pr.process.Elements {
		if e.XMLName.Local == "association" {
			if task, ok := compensationBoundary[e.SourceRef]; ok {
				pr.compensatedBy[task] = e.TargetRef
			}
		}
	}
}

// readSteps makes a step of every task; its service comes from st:service or the mapping.
func (pr *processReader) readSteps() {
	for _, e := range pr.process.Elements {
		kind, isTask := taskKinds[e.XMLName.Local]
		if !isTask {
			continue
		}
		if e.ForCompensation == "true" {
			kind = "compensation"
		}
		service := firstNonEmpty(e.attr("service"), pr.mapping.Tasks[e.ID])
		if service == "" {
			pr.problem(e.ID, fmt.Sprintf("task %q has no service: set st:service or map it in the mapping's tasks", firstNonEmpty(e.Name, e.ID)))
		}
		pr.serviceOf[e.ID] = service
		step := domain.FlowStep{ID: e.ID, Name: firstNonEmpty(e.Name, e.ID), ServiceDefinitionID: service, Kind: kind}
		if entry := firstNonEmpty(e.attr("entryPoint"), pr.mapping.EntryPoints[e.ID]); entry != "" {
			step.EntryPoint = &entry
		}
		if ms, ok := pr.deadline[e.ID]; ok {
			step.DeadlineMs = &ms
		}
		if c, ok := pr.compensatedBy[e.ID]; ok {
			step.CompensatedBy = &c
		}
		pr.flow.Steps = append(pr.flow.Steps, step)
	}
}

// readOutcomes makes an outcome of every end event; its definition sets the kind.
func (pr *processReader) readOutcomes() {
	for _, e := range pr.process.Elements {
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
		pr.flow.Outcomes = append(pr.flow.Outcomes, domain.FlowOutcome{ID: e.ID, Name: firstNonEmpty(e.Name, e.ID), Kind: kind})
	}
}

// reachTarget is a step or outcome reached through a sequence flow (and any gateways after it).
type reachTarget struct {
	id, flowID, condition string
}

// reach follows sequence flows through gateways to the next steps or outcomes. A branch of a
// non-parallel gateway carries its condition (or, failing that, its name).
func (pr *processReader) reach(node, flowID, condition string, seen map[string]bool) []reachTarget {
	if pr.isStep(node) || pr.isOutcome(node) {
		return []reachTarget{{node, flowID, condition}}
	}
	if seen[node] {
		return nil
	}
	seen[node] = true
	var out []reachTarget
	for _, f := range pr.outgoing[node] {
		c := condition
		if fc := firstNonEmpty(strings.TrimSpace(f.Condition), f.Name); fc != "" && isGateway(pr.kindOf[node]) && pr.kindOf[node] != "parallelGateway" {
			c = fc
		}
		out = append(out, pr.reach(f.TargetRef, f.ID, c, seen)...)
	}
	return out
}

// readTransitions makes a transition from every step to each step or outcome it reaches. A step
// that leads into an exclusive or inclusive gateway becomes a decision.
func (pr *processReader) readTransitions() {
	for si := range pr.flow.Steps {
		s := &pr.flow.Steps[si]
		for _, f := range pr.outgoing[s.ID] {
			cond := ""
			if gw := pr.kindOf[f.TargetRef]; gw == "exclusiveGateway" || gw == "inclusiveGateway" {
				if s.Kind == "task" {
					s.Kind = "decision"
				}
			} else if c := strings.TrimSpace(f.Condition); c != "" {
				cond = c
			}
			// Through a gateway, each target keeps the ID of the sequence flow that reaches it.
			for _, t := range pr.reach(f.TargetRef, f.ID, cond, map[string]bool{}) {
				pr.flow.Transitions = append(pr.flow.Transitions, pr.transition(s, t))
			}
		}
	}
}

// transition is local within one service (or into an outcome), an event when the sequence flow
// names an event type, and a call otherwise.
func (pr *processReader) transition(from *domain.FlowStep, t reachTarget) domain.FlowTransition {
	tr := domain.FlowTransition{ID: t.flowID, From: from.ID, To: t.id, Policies: []domain.FlowPolicy{}}
	if t.condition != "" {
		c := t.condition
		tr.Condition = &c
	}
	event := firstNonEmpty(pr.byID[t.flowID].attr("eventType"), pr.mapping.Events[t.flowID])
	switch {
	case pr.isOutcome(t.id) || pr.serviceOf[t.id] == from.ServiceDefinitionID:
		tr.Via = domain.FlowTransitionVia{Kind: "local"}
	case event != "":
		tr.Via = domain.FlowTransitionVia{Kind: "event", EventTypeID: &event}
	default:
		tr.Via = domain.FlowTransitionVia{Kind: "call"}
	}
	return tr
}

// readStart sets the start step (the first step reached from a start event) and the trigger,
// from the start event's definition.
func (pr *processReader) readStart() {
	for _, e := range pr.process.Elements {
		if e.XMLName.Local != "startEvent" {
			continue
		}
		for _, f := range pr.outgoing[e.ID] {
			if targets := pr.reach(f.TargetRef, f.ID, "", map[string]bool{}); len(targets) > 0 && pr.flow.StartStepID == "" {
				pr.flow.StartStepID = targets[0].id
			}
		}
		switch {
		case e.MessageDefinition != nil:
			pr.flow.Trigger = domain.FlowTrigger{Kind: "event"}
			if ev := firstNonEmpty(e.attr("eventType"), pr.mapping.Events["message:"+e.MessageDefinition.MessageRef], pr.mapping.Events[e.ID]); ev != "" {
				pr.flow.Trigger.Ref = &ev
			}
		case e.TimerDefinition != nil:
			pr.flow.Trigger = domain.FlowTrigger{Kind: "schedule"}
		}
	}
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
