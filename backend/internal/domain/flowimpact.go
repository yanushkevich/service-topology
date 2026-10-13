package domain

import "sort"

// Flows in impact analysis (ADR-025, docs/BUSINESS_FLOWS.md §12): the explained propagation result
// mapped onto business flows. Port of apps/web/src/domain/flowImpact.ts (same sections and names);
// fixtures/conformance/impact/flows.json checks parity. Always simulated reasoning.
//
// A step is affected when its service instance fails, unless the instance only fails over a
// relationship that backs one of the flow's own transitions: the flow models that call or event as
// a hand-off, so the failure shows at the step it enters. An unavailable channel affects the step
// its event enters; a degraded one (backlog) does not, as in the propagation rules.

// AffectedStep is one step of a flow that the failure reaches, with its cause chain.
type AffectedStep struct {
	StepID string `json:"stepId"`
	Effect string `json:"effect"`
	// EntityID is the failing entity behind it: the step's service instance, or the channel its input arrives on.
	EntityID EntityID `json:"entityId"`
	// Path is failure root → … → EntityID, from the propagation result.
	Path   []EntityID `json:"path"`
	Reason string     `json:"reason"`
}

// Likely outcome kinds.
const (
	LikelyOutcomeReached = "outcome"
	LikelyDelayed        = "delayed"
	LikelyUnknown        = "unknown"
)

// LikelyOutcome is where the first affected step leads: an outcome (with or without compensation),
// delayed (behind redelivery or a dead-letter queue), or unknown (no failure path modelled).
type LikelyOutcome struct {
	Kind         string `json:"kind"`
	OutcomeID    string `json:"outcomeId,omitempty"`
	Compensated  *bool  `json:"compensated,omitempty"`
	TransitionID string `json:"transitionId,omitempty"`
}

// FlowImpact is one flow in one environment under the failure.
type FlowImpact struct {
	FlowID        EntityID       `json:"flowId"`
	EnvironmentID EntityID       `json:"environmentId"`
	Steps         []AffectedStep `json:"steps"`
	// FirstAffectedStepID is the first affected step on the typical path; nil when it is untouched.
	FirstAffectedStepID *string        `json:"firstAffectedStepId"`
	LikelyOutcome       *LikelyOutcome `json:"likelyOutcome"`
}

type failingEntity struct {
	effect string
	path   []EntityID
	via    EntityID
}

// failingEntities indexes the roots and their impacts by entity.
func failingEntities(roots []FailureRoot, impacts []Impact) map[EntityID]failingEntity {
	out := map[EntityID]failingEntity{}
	for _, r := range roots {
		out[r.EntityID] = failingEntity{effect: r.Mode, path: []EntityID{r.EntityID}}
	}
	for _, i := range impacts {
		if _, ok := out[i.EntityID]; !ok {
			out[i.EntityID] = failingEntity{effect: i.Effect, path: i.Path, via: i.ViaRelationshipID}
		}
	}
	return out
}

// FlowImpacts lists every flow with an affected step, per environment (by ID), flows by ID.
func (ix *Index) FlowImpacts(roots []FailureRoot, impacts []Impact) []FlowImpact {
	failing := failingEntities(roots, impacts)
	out := []FlowImpact{}
	if len(failing) == 0 {
		return out
	}
	environments := make([]EntityID, 0, len(ix.Environments))
	for id := range ix.Environments {
		environments = append(environments, id)
	}
	sort.Slice(environments, func(i, j int) bool { return environments[i] < environments[j] })
	flows := make([]*BusinessFlow, 0, len(ix.BusinessFlows))
	for _, f := range ix.BusinessFlows {
		flows = append(flows, f)
	}
	sort.Slice(flows, func(i, j int) bool { return flows[i].ID < flows[j].ID })
	for _, environmentID := range environments {
		for _, flow := range flows {
			if !ix.deployedIn(flow, environmentID) {
				continue
			}
			if impact := ix.flowImpact(flow, environmentID, failing); len(impact.Steps) > 0 {
				out = append(out, impact)
			}
		}
	}
	return out
}

func (ix *Index) deployedIn(flow *BusinessFlow, environmentID EntityID) bool {
	for _, s := range flow.Steps {
		if ix.instanceIn(s.ServiceDefinitionID, environmentID) != "" {
			return true
		}
	}
	return false
}

// flowImpact is one flow in one environment against the failing entities.
func (ix *Index) flowImpact(flow *BusinessFlow, environmentID EntityID, failing map[EntityID]failingEntity) FlowImpact {
	backings := make([]TransitionBacking, len(flow.Transitions))
	for i := range flow.Transitions {
		backings[i] = ix.TransitionBacking(flow, &flow.Transitions[i], environmentID)
	}
	steps := ix.affectedSteps(flow, environmentID, backings, failing)
	typicalSteps, typicalTransitions := flow.TypicalPath()
	affected := map[string]bool{}
	for _, s := range steps {
		affected[s.StepID] = true
	}
	impact := FlowImpact{FlowID: flow.ID, EnvironmentID: environmentID, Steps: steps}
	for _, id := range typicalSteps {
		if affected[id] {
			first := id
			impact.FirstAffectedStepID = &first
			typical := map[string]bool{}
			for _, t := range typicalTransitions {
				typical[t] = true
			}
			outcome := likelyOutcome(flow, backings, id, typical, failing)
			impact.LikelyOutcome = &outcome
			break
		}
	}
	return impact
}

func (ix *Index) affectedSteps(flow *BusinessFlow, environmentID EntityID, backings []TransitionBacking, failing map[EntityID]failingEntity) []AffectedStep {
	handOffs := map[EntityID]bool{}
	for _, b := range backings {
		if b.Status == BackingBacked {
			for _, id := range b.RelationshipIDs {
				handOffs[id] = true
			}
		}
	}
	byStep := map[string]AffectedStep{}
	add := func(step AffectedStep) {
		if existing, ok := byStep[step.StepID]; !ok || severity[step.Effect] > severity[existing.Effect] {
			byStep[step.StepID] = step
		}
	}
	for _, step := range flow.Steps {
		instanceID := ix.instanceIn(step.ServiceDefinitionID, environmentID)
		f, ok := failing[instanceID]
		if instanceID == "" || !ok {
			continue
		}
		if f.via != "" && handOffs[f.via] {
			continue // shown at the step the hand-off enters
		}
		add(AffectedStep{StepID: step.ID, Effect: f.effect, EntityID: instanceID, Path: f.path, Reason: "service"})
	}
	for i, t := range flow.Transitions {
		b := backings[i]
		if b.Status != BackingBacked || b.ChannelID == "" || flow.Step(t.To) == nil {
			continue
		}
		if f, ok := failing[b.ChannelID]; ok && f.effect == FailureUnavailable {
			add(AffectedStep{StepID: t.To, Effect: f.effect, EntityID: b.ChannelID, Path: f.path, Reason: "input-channel"})
		}
	}
	order := map[string]int{}
	for i, s := range flow.Steps {
		order[s.ID] = i
	}
	out := make([]AffectedStep, 0, len(byStep))
	for _, s := range byStep {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return order[out[i].StepID] < order[out[j].StepID] })
	return out
}

// declares: a policy is declared unless it is recorded as missing.
func declares(t *FlowTransition, policyType string) bool {
	for _, p := range t.Policies {
		if p.Type == policyType && (p.State == nil || *p.State != "missing") {
			return true
		}
	}
	return false
}

func likelyOutcome(flow *BusinessFlow, backings []TransitionBacking, stepID string, typical map[string]bool, failing map[EntityID]failingEntity) LikelyOutcome {
	for i := range flow.Transitions {
		t, b := &flow.Transitions[i], backings[i]
		if t.To != stepID || !typical[t.ID] || t.Via.Kind != "event" || !(declares(t, "redelivery") || declares(t, "dead-letter")) {
			continue
		}
		if b.Status == BackingBacked && b.ChannelID != "" && failing[b.ChannelID].effect != FailureUnavailable {
			return LikelyOutcome{Kind: LikelyDelayed, TransitionID: t.ID}
		}
	}
	for _, exit := range flow.Transitions {
		if exit.From != stepID || typical[exit.ID] {
			continue
		}
		if outcomeID, compensated, ok := failureEnd(flow, exit.To); ok {
			return LikelyOutcome{Kind: LikelyOutcomeReached, OutcomeID: outcomeID, Compensated: &compensated}
		}
	}
	return LikelyOutcome{Kind: LikelyUnknown}
}

// failureEnd follows a failure exit: the first non-success outcome reached (breadth first), and
// whether a compensation step is reachable.
func failureEnd(flow *BusinessFlow, start string) (outcomeID string, compensated, ok bool) {
	seen := map[string]bool{}
	queue := []string{start}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] {
			continue
		}
		seen[id] = true
		if o := flow.Outcome(id); o != nil && o.Kind != "success" && !ok {
			outcomeID, ok = o.ID, true
		}
		if s := flow.Step(id); s != nil && s.Kind == "compensation" {
			compensated = true
		}
		for _, t := range flow.Transitions {
			if t.From == id {
				queue = append(queue, t.To)
			}
		}
	}
	return outcomeID, compensated, ok
}
