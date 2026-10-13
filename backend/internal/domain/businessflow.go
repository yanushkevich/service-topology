package domain

import "fmt"

// Business flows (ADR-022, docs/BUSINESS_FLOWS.md): a process across services, environment
// independent like an event type. Port of apps/web/src/domain/businessFlow.ts.

// FlowStep is one step of a business flow, owned by one service. IDs are unique within the flow.
type FlowStep struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	ServiceDefinitionID EntityID `json:"serviceDefinitionId"`
	Kind                string   `json:"kind"`
	EntryPoint          *string  `json:"entryPoint,omitempty"`
	DeadlineMs          *float64 `json:"deadlineMs,omitempty"`
	CompensatedBy       *string  `json:"compensatedBy,omitempty"`
}

// FlowPolicy is a protection on a transition: call, asynchronous, or process level.
type FlowPolicy struct {
	Type   string            `json:"type"`
	Label  string            `json:"label"`
	Config map[string]string `json:"config,omitempty"`
	State  *string           `json:"state,omitempty"`
	Stat   *string           `json:"stat,omitempty"`
}

// FlowTransitionVia says how control passes: local, call (optional explicit caller), or event.
type FlowTransitionVia struct {
	Kind            string    `json:"kind"`
	CallerServiceID *EntityID `json:"callerServiceId,omitempty"`
	EventTypeID     *EntityID `json:"eventTypeId,omitempty"`
}

// FlowTransition moves control from a step to a step or an outcome.
type FlowTransition struct {
	ID        string            `json:"id"`
	From      string            `json:"from"`
	To        string            `json:"to"`
	Via       FlowTransitionVia `json:"via"`
	Condition *string           `json:"condition,omitempty"`
	Policies  []FlowPolicy      `json:"policies"`
}

// FlowOutcome ends a flow.
type FlowOutcome struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

// FlowTrigger starts a flow.
type FlowTrigger struct {
	Kind string    `json:"kind"`
	Ref  *EntityID `json:"ref,omitempty"`
}

// FlowTarget is the end-to-end objective.
type FlowTarget struct {
	P95Ms        *float64 `json:"p95Ms,omitempty"`
	CompletionMs *float64 `json:"completionMs,omitempty"`
}

// FlowSource tells whether a flow was authored in the app or imported (read-only in the app).
type FlowSource struct {
	Kind       string  `json:"kind"`
	Format     *string `json:"format,omitempty"`
	Ref        *string `json:"ref,omitempty"`
	ImportedAt *string `json:"importedAt,omitempty"`
}

// BusinessFlow is a business process across services (ADR-022).
type BusinessFlow struct {
	ID          EntityID         `json:"id"`
	Name        string           `json:"name"`
	Description *string          `json:"description,omitempty"`
	Owner       *string          `json:"owner,omitempty"`
	Team        *string          `json:"team,omitempty"`
	Trigger     FlowTrigger      `json:"trigger"`
	StartStepID string           `json:"startStepId"`
	Target      *FlowTarget      `json:"target,omitempty"`
	Steps       []FlowStep       `json:"steps"`
	Transitions []FlowTransition `json:"transitions"`
	Outcomes    []FlowOutcome    `json:"outcomes"`
	Source      FlowSource       `json:"source"`
	Metadata    map[string]any   `json:"metadata,omitempty"`
}

// Step returns the step with this ID, or nil.
func (f *BusinessFlow) Step(id string) *FlowStep {
	for i := range f.Steps {
		if f.Steps[i].ID == id {
			return &f.Steps[i]
		}
	}
	return nil
}

func (f *BusinessFlow) hasOutcome(id string) bool {
	for _, o := range f.Outcomes {
		if o.ID == id {
			return true
		}
	}
	return false
}

// Backing statuses of a transition in one environment.
const (
	BackingBacked      = "backed"
	BackingUnbacked    = "unbacked"
	BackingNotDeployed = "not-deployed"
	BackingOutcome     = "outcome"
)

// TransitionBacking says how one transition is backed by the topology in an environment.
type TransitionBacking struct {
	Status          string     `json:"status"`
	RelationshipIDs []EntityID `json:"relationshipIds,omitempty"`
	ChannelID       EntityID   `json:"channelId,omitempty"`
	Reason          string     `json:"reason,omitempty"`
	ServiceIDs      []EntityID `json:"serviceDefinitionIds,omitempty"`
}

func (ix *Index) relationshipBetween(from, to EntityID) *CommunicationRelationship {
	for _, r := range ix.Outgoing[from] {
		if r.TargetEntityID == to {
			return r
		}
	}
	return nil
}

func uniqueIDs(ids ...EntityID) []EntityID {
	var out []EntityID
	seen := map[EntityID]bool{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// TransitionBacking resolves one transition in an environment, like transitionBacking in TypeScript:
// a call needs a relationship from the caller (or, without an explicit caller, the reply to a call
// the target made to the source); an event needs the event type's producer → channel → consumer
// relationships. Flows never invent communication.
func (ix *Index) TransitionBacking(flow *BusinessFlow, t *FlowTransition, environmentID EntityID) TransitionBacking {
	from, to := flow.Step(t.From), flow.Step(t.To)
	if from == nil || to == nil {
		return TransitionBacking{Status: BackingOutcome}
	}
	switch t.Via.Kind {
	case "local":
		return TransitionBacking{Status: BackingBacked}
	case "call":
		caller := from.ServiceDefinitionID
		explicit := t.Via.CallerServiceID != nil
		if explicit {
			caller = *t.Via.CallerServiceID
		}
		if caller == to.ServiceDefinitionID {
			return TransitionBacking{Status: BackingBacked}
		}
		services := []EntityID{caller, to.ServiceDefinitionID}
		if !explicit {
			services = append(services, from.ServiceDefinitionID)
		}
		var missing []EntityID
		for _, id := range uniqueIDs(services...) {
			if ix.instanceIn(id, environmentID) == "" {
				missing = append(missing, id)
			}
		}
		if len(missing) > 0 {
			return TransitionBacking{Status: BackingNotDeployed, ServiceIDs: missing}
		}
		callerInstance, target := ix.instanceIn(caller, environmentID), ix.instanceIn(to.ServiceDefinitionID, environmentID)
		if r := ix.relationshipBetween(callerInstance, target); r != nil {
			return TransitionBacking{Status: BackingBacked, RelationshipIDs: []EntityID{r.ID}}
		}
		if !explicit {
			if r := ix.relationshipBetween(target, callerInstance); r != nil {
				return TransitionBacking{Status: BackingBacked, RelationshipIDs: []EntityID{r.ID}}
			}
		}
		suffix := " (or the reverse)"
		if explicit {
			suffix = ""
		}
		return TransitionBacking{Status: BackingUnbacked, Reason: fmt.Sprintf("No relationship %q → %q%s in %s", callerInstance, target, suffix, environmentID)}
	}
	// event
	eventTypeID := EntityID("")
	if t.Via.EventTypeID != nil {
		eventTypeID = *t.Via.EventTypeID
	}
	eventType := ix.EventTypes[eventTypeID]
	if eventType == nil {
		return TransitionBacking{Status: BackingUnbacked, Reason: fmt.Sprintf("Unknown event type %q", eventTypeID)}
	}
	var missing []EntityID
	for _, id := range []EntityID{from.ServiceDefinitionID, to.ServiceDefinitionID} {
		if ix.instanceIn(id, environmentID) == "" {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		return TransitionBacking{Status: BackingNotDeployed, ServiceIDs: uniqueIDs(missing...)}
	}
	eventFlow, ok := ix.ResolveEventFlow(eventType, environmentID)
	if !ok {
		return TransitionBacking{Status: BackingUnbacked, Reason: fmt.Sprintf("%q has no channel in %s", eventType.Name, environmentID)}
	}
	var producer, consumer []EntityID
	for _, p := range eventFlow.Producers {
		if p.ServiceDefinitionID == from.ServiceDefinitionID {
			producer = p.RelationshipIDs
			break
		}
	}
	for _, c := range eventFlow.Consumers {
		if c.ServiceDefinitionID == to.ServiceDefinitionID {
			consumer = c.RelationshipIDs
			break
		}
	}
	if len(producer) == 0 || len(consumer) == 0 {
		return TransitionBacking{Status: BackingUnbacked, Reason: fmt.Sprintf("%q does not flow from %s to %s in %s", eventType.Name, from.ServiceDefinitionID, to.ServiceDefinitionID, environmentID)}
	}
	return TransitionBacking{Status: BackingBacked, RelationshipIDs: append(append([]EntityID{}, producer...), consumer...), ChannelID: eventFlow.ChannelID}
}

// ReachableFrom returns the step and outcome IDs reachable from the start step.
func (f *BusinessFlow) ReachableFrom(start string) map[string]bool {
	seen := map[string]bool{}
	queue := []string{start}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] {
			continue
		}
		seen[id] = true
		for _, t := range f.Transitions {
			if t.From == id {
				queue = append(queue, t.To)
			}
		}
	}
	return seen
}

// TypicalPath is the typical path from the start, like typicalPath in TypeScript without observed
// shares: every unconditional transition (they run in parallel); where a step has only conditional
// exits, the first declared one. Compensation steps are never typical.
func (f *BusinessFlow) TypicalPath() (steps, transitions []string) {
	queue := []string{f.StartStepID}
	seen := map[string]bool{}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] || f.Step(id) == nil {
			continue
		}
		seen[id] = true
		steps = append(steps, id)
		var unconditional, conditional []*FlowTransition
		for i := range f.Transitions {
			t := &f.Transitions[i]
			if t.From != id {
				continue
			}
			if to := f.Step(t.To); to != nil && to.Kind == "compensation" {
				continue
			}
			if t.Condition == nil {
				unconditional = append(unconditional, t)
			} else {
				conditional = append(conditional, t)
			}
		}
		taken := unconditional
		if len(taken) == 0 && len(conditional) > 0 {
			taken = conditional[:1]
		}
		for _, t := range taken {
			transitions = append(transitions, t.ID)
			queue = append(queue, t.To)
		}
	}
	return steps, transitions
}

// Outcome returns the outcome with this ID, or nil.
func (f *BusinessFlow) Outcome(id string) *FlowOutcome {
	for i := range f.Outcomes {
		if f.Outcomes[i].ID == id {
			return &f.Outcomes[i]
		}
	}
	return nil
}
