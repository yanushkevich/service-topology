package domain

import (
	"fmt"
	"strings"
)

// Severity of a validation issue. Every current rule is an error; warning is reserved.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

// Validation codes, identical to ValidationCode in apps/web/src/domain/validation.ts. They appear in
// API problem details (`errors[].code`), so they are part of the contract.
const (
	CodeEmptyID                          = "empty-id"
	CodeDuplicateID                      = "duplicate-id"
	CodeMissingEnvironment               = "missing-environment"
	CodeMissingServiceDefinition         = "missing-service-definition"
	CodeMissingResource                  = "missing-resource"
	CodeMissingParent                    = "missing-parent"
	CodeParentCycle                      = "parent-cycle"
	CodeMissingRelationshipEndpoint      = "missing-relationship-endpoint"
	CodeInvalidRelationshipEndpoint      = "invalid-relationship-endpoint"
	CodeSelfRelationship                 = "self-relationship"
	CodeEnvironmentMismatch              = "environment-mismatch"
	CodeEnvironmentConflict              = "environment-conflict"
	CodeCrossEnvironmentRelationship     = "cross-environment-relationship"
	CodeInvalidBindingTarget             = "invalid-binding-target"
	CodeMissingEventChannel              = "missing-event-channel"
	CodeInvalidEventChannel              = "invalid-event-channel"
	CodeDuplicateEventChannelEnvironment = "duplicate-event-channel-environment"
	CodeMissingEventService              = "missing-event-service"
	CodeEventFlowMissingRelationship     = "event-flow-missing-relationship"
)

// Issue is one integrity problem. Code and EntityID are stable; Message is for people.
type Issue struct {
	Severity Severity `json:"severity"`
	Code     string   `json:"code"`
	EntityID EntityID `json:"entityId"`
	Message  string   `json:"message"`
}

const environmentIndependent = "(environment-independent)"

// Validate checks the integrity rules of ADR-004, ADR-008, and ADR-014. It is a port of
// validateTopology and must return the same codes, entity IDs, and order; the shared conformance
// fixtures in /fixtures/conformance/validation enforce that.
func Validate(data *TopologyData) []Issue {
	var issues []Issue
	fail := func(code string, id EntityID, format string, args ...any) {
		issues = append(issues, Issue{Severity: SeverityError, Code: code, EntityID: id, Message: fmt.Sprintf(format, args...)})
	}

	// IDs are unique across every collection, so a bare ID resolves to exactly one entity.
	seen := map[EntityID]bool{}
	var all []EntityID
	for _, e := range data.Environments {
		all = append(all, e.ID)
	}
	for _, d := range data.ServiceDefinitions {
		all = append(all, d.ID)
	}
	for _, i := range data.ServiceInstances {
		all = append(all, i.ID)
	}
	for _, r := range data.Resources {
		all = append(all, r.ID)
	}
	for _, r := range data.Relationships {
		all = append(all, r.ID)
	}
	for _, e := range data.EventTypes {
		all = append(all, e.ID)
	}
	for _, id := range all {
		if strings.TrimSpace(id) == "" {
			fail(CodeEmptyID, id, "Entity has an empty ID")
		} else if seen[id] {
			fail(CodeDuplicateID, id, "Duplicate ID %q", id)
		}
		seen[id] = true
	}

	ix := BuildIndex(data)

	for i := range data.ServiceInstances {
		inst := &data.ServiceInstances[i]
		// Data from future adapters is untyped at runtime; an instance must name exactly one environment.
		if inst.EnvironmentID == nil {
			fail(CodeMissingEnvironment, inst.ID, "Instance must reference exactly one environment ID")
		} else if ix.Environments[*inst.EnvironmentID] == nil {
			fail(CodeMissingEnvironment, inst.ID, "Instance references unknown environment %q", *inst.EnvironmentID)
		}
		if ix.Definitions[inst.ServiceDefinitionID] == nil {
			fail(CodeMissingServiceDefinition, inst.ID, "Instance references unknown service definition %q", inst.ServiceDefinitionID)
		}
		if inst.ResourceID != nil {
			if ix.Resources[*inst.ResourceID] == nil {
				fail(CodeMissingResource, inst.ID, "Instance references unknown resource %q", *inst.ResourceID)
			} else if host, ok := ix.EnvironmentOf(*inst.ResourceID); ok && (inst.EnvironmentID == nil || host != *inst.EnvironmentID) {
				fail(CodeEnvironmentMismatch, inst.ID, "Instance is in %q but runs in a resource assigned to %q", deref(inst.EnvironmentID), host)
			}
		}
	}

	for i := range data.Resources {
		r := &data.Resources[i]
		if r.EnvironmentID != nil && ix.Environments[*r.EnvironmentID] == nil {
			fail(CodeMissingEnvironment, r.ID, "Resource references unknown environment %q", *r.EnvironmentID)
		}
		if r.ParentResourceID == nil {
			continue
		}
		// Environment is inherited through containment (ADR-008); a child may restate it but not change it.
		if r.EnvironmentID != nil {
			if inherited, ok := ix.EnvironmentOf(*r.ParentResourceID); ok && inherited != *r.EnvironmentID {
				fail(CodeEnvironmentConflict, r.ID, "Resource sets environment %q but its ancestors are in %q", *r.EnvironmentID, inherited)
			}
		}
		if ix.Resources[*r.ParentResourceID] == nil {
			fail(CodeMissingParent, r.ID, "Resource references unknown parent %q", *r.ParentResourceID)
			continue
		}
		// Walk up the parent chain; revisiting this resource means it is on a cycle.
		visited := map[EntityID]bool{}
		current := r.ParentResourceID
		for current != nil && !visited[*current] {
			if *current == r.ID {
				fail(CodeParentCycle, r.ID, "Resource %q is its own ancestor", r.ID)
				break
			}
			visited[*current] = true
			next := ix.Resources[*current]
			if next == nil {
				break
			}
			current = next.ParentResourceID
		}
	}

	for i := range data.Relationships {
		rel := &data.Relationships[i]
		if rel.SourceEntityID == rel.TargetEntityID {
			fail(CodeSelfRelationship, rel.ID, "Relationship connects an entity to itself")
		}
		for _, endpoint := range []EntityID{rel.SourceEntityID, rel.TargetEntityID} {
			if ix.Instances[endpoint] != nil {
				continue
			}
			res := ix.Resources[endpoint]
			switch {
			case res == nil && seen[endpoint]:
				fail(CodeInvalidRelationshipEndpoint, rel.ID, "Endpoint %q is not a service instance or resource", endpoint)
			case res == nil:
				fail(CodeMissingRelationshipEndpoint, rel.ID, "Relationship references unknown endpoint %q", endpoint)
			case containmentOnlyResourceTypes[res.Type]:
				fail(CodeInvalidRelationshipEndpoint, rel.ID, "Endpoint %q is a %s; containment is not communication", endpoint, res.Type)
			}
		}
		// RabbitMQ bindings: an exchange routes only to queues or other exchanges, never straight to a consumer.
		source, target := ix.Resources[rel.SourceEntityID], ix.Resources[rel.TargetEntityID]
		if source != nil && source.Type == "exchange" && (target == nil || (target.Type != "queue" && target.Type != "exchange")) {
			fail(CodeInvalidBindingTarget, rel.ID, "An exchange can only be bound to a queue or another exchange")
		}
		// Environments are isolated (ADR-008): only environment-independent entities may be shared.
		sourceEnv, sok := ix.EnvironmentOf(rel.SourceEntityID)
		targetEnv, tok := ix.EnvironmentOf(rel.TargetEntityID)
		if sok && tok && sourceEnv != "" && targetEnv != "" && sourceEnv != targetEnv {
			fail(CodeCrossEnvironmentRelationship, rel.ID, "Relationship crosses environments (%q → %q)", sourceEnv, targetEnv)
		}
	}

	// Event types (ADR-014) annotate existing messaging; they must agree with the relationships.
	for i := range data.EventTypes {
		e := &data.EventTypes[i]
		type entry struct{ key, channelID EntityID }
		var channels []entry // insertion-ordered, like the TypeScript Map
		has := func(key string) bool {
			for _, c := range channels {
				if c.key == key {
					return true
				}
			}
			return false
		}
		for _, channelID := range e.ChannelResourceIDs {
			channel := ix.Resources[channelID]
			if channel == nil {
				fail(CodeMissingEventChannel, e.ID, "Event type references unknown channel %q", channelID)
				continue
			}
			if !eventChannelTypes[channel.Type] {
				fail(CodeInvalidEventChannel, e.ID, "Channel %q is a %s, not a topic, queue, or exchange", channelID, channel.Type)
				continue
			}
			key := environmentIndependent
			if env, ok := ix.EnvironmentOf(channelID); ok {
				key = env
			}
			if has(key) || (len(channels) > 0 && (key == environmentIndependent || has(environmentIndependent))) {
				scope := fmt.Sprintf("environment %q", key)
				if key == environmentIndependent {
					scope = "all environments"
				}
				fail(CodeDuplicateEventChannelEnvironment, e.ID, "Event type has more than one channel for %s", scope)
				continue
			}
			channels = append(channels, entry{key, channelID})
		}
		for _, serviceID := range append(append([]EntityID{}, e.ProducerServiceIDs...), e.ConsumerServiceIDs...) {
			if ix.Definitions[serviceID] == nil {
				fail(CodeMissingEventService, e.ID, "Event type references unknown service definition %q", serviceID)
			}
		}
		for _, c := range channels {
			environmentID := c.key
			if environmentID == environmentIndependent {
				environmentID = ""
			}
			flow, ok := ix.ResolveEventFlow(e, environmentID)
			if !ok || flow.ChannelID != c.channelID {
				continue
			}
			check := func(participants []EventFlowParticipant, role, preposition string) {
				for _, p := range participants {
					if p.InstanceID != "" && len(p.RelationshipIDs) == 0 && ix.Definitions[p.ServiceDefinitionID] != nil {
						fail(CodeEventFlowMissingRelationship, e.ID, "%q is a %s of %q but has no relationship %s %q", p.InstanceID, role, e.Name, preposition, c.channelID)
					}
				}
			}
			check(flow.Producers, "producer", "to")
			check(flow.Consumers, "consumer", "from")
		}
	}

	return issues
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
