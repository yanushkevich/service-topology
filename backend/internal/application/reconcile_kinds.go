package application

import "servicetopology/backend/internal/domain"

// What a source provides per kind (docs/DYNATRACE_CONNECTOR.md §4). An owned entity takes these
// fields from the source and keeps the rest (description, category, provider, version, endpoint,
// metrics, other metadata); an authored entity only gains the link. Base health of owned entities
// comes from discovery ("unknown"); live health is the observation overlay.

var environmentKind = entityKind[domain.Environment]{
	id:   func(e *domain.Environment) domain.EntityID { return e.ID },
	name: func(e *domain.Environment) string { return e.Name },
	owned: func(s, d domain.Environment, _ string) domain.Environment {
		s.Name, s.Kind = d.Name, d.Kind
		return s
	},
	link: func(s, _ domain.Environment, _ string) domain.Environment { return s },
	keep: func(s domain.Environment, _, _ string) domain.Environment { return s },
}

var definitionKind = entityKind[domain.ServiceDefinition]{
	id:   func(e *domain.ServiceDefinition) domain.EntityID { return e.ID },
	name: func(e *domain.ServiceDefinition) string { return e.Name },
	owned: func(s, d domain.ServiceDefinition, source string) domain.ServiceDefinition {
		s.Name = d.Name
		if d.Owner != nil {
			s.Owner = d.Owner
		}
		if d.Team != nil {
			s.Team = d.Team
		}
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	link: func(s, d domain.ServiceDefinition, source string) domain.ServiceDefinition {
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	keep: func(s domain.ServiceDefinition, source, now string) domain.ServiceDefinition {
		s.Metadata = markMissing(s.Metadata, source, now)
		return s
	},
}

var resourceKind = entityKind[domain.InfrastructureResource]{
	id:   func(e *domain.InfrastructureResource) domain.EntityID { return e.ID },
	name: func(e *domain.InfrastructureResource) string { return e.Name },
	// An authored topic, queue, or exchange with the same name in the same environment (often
	// inherited from its broker) is the same channel, so event types keep working.
	match: func(stored []domain.InfrastructureResource, d *domain.InfrastructureResource) (int, bool) {
		if !channelTypes[d.Type] || d.EnvironmentID == nil {
			return 0, false
		}
		for i, s := range stored {
			if s.Type == d.Type && s.Name == d.Name && effectiveEnvironment(stored, i) == *d.EnvironmentID {
				return i, true
			}
		}
		return 0, false
	},
	owned: func(s, d domain.InfrastructureResource, source string) domain.InfrastructureResource {
		s.Name, s.Type, s.ParentResourceID, s.EnvironmentID, s.Health = d.Name, d.Type, d.ParentResourceID, d.EnvironmentID, d.Health
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	link: func(s, d domain.InfrastructureResource, source string) domain.InfrastructureResource {
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	stamp: func(e *domain.InfrastructureResource, now string) { e.UpdatedAt = &now },
	keep: func(s domain.InfrastructureResource, source, now string) domain.InfrastructureResource {
		unknown := "unknown"
		s.Health = &unknown
		s.Metadata = markMissing(s.Metadata, source, now)
		return s
	},
}

var instanceKind = entityKind[domain.ServiceInstance]{
	id:   func(e *domain.ServiceInstance) domain.EntityID { return e.ID },
	name: func(e *domain.ServiceInstance) string { return e.ID },
	// An authored instance of the same service in the same environment is the same deployment.
	match: func(stored []domain.ServiceInstance, d *domain.ServiceInstance) (int, bool) {
		for i, s := range stored {
			if s.ServiceDefinitionID == d.ServiceDefinitionID && s.EnvironmentID != nil && d.EnvironmentID != nil && *s.EnvironmentID == *d.EnvironmentID {
				return i, true
			}
		}
		return 0, false
	},
	owned: func(s, d domain.ServiceInstance, source string) domain.ServiceInstance {
		s.ServiceDefinitionID, s.EnvironmentID, s.ResourceID, s.Health = d.ServiceDefinitionID, d.EnvironmentID, d.ResourceID, d.Health
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	link: func(s, d domain.ServiceInstance, source string) domain.ServiceInstance {
		if s.ResourceID == nil {
			s.ResourceID = d.ResourceID
		}
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	stamp: func(e *domain.ServiceInstance, now string) { e.UpdatedAt = now },
	keep: func(s domain.ServiceInstance, source, now string) domain.ServiceInstance {
		s.Health = "unknown"
		s.Metadata = markMissing(s.Metadata, source, now)
		return s
	},
}

var relationshipKind = entityKind[domain.CommunicationRelationship]{
	id:   func(e *domain.CommunicationRelationship) domain.EntityID { return e.ID },
	name: func(e *domain.CommunicationRelationship) string { return e.ID },
	// An authored relationship between the same entities is the same communication.
	match: func(stored []domain.CommunicationRelationship, d *domain.CommunicationRelationship) (int, bool) {
		for i, s := range stored {
			if s.SourceEntityID == d.SourceEntityID && s.TargetEntityID == d.TargetEntityID {
				return i, true
			}
		}
		return 0, false
	},
	owned: func(s, d domain.CommunicationRelationship, source string) domain.CommunicationRelationship {
		s.SourceEntityID, s.TargetEntityID, s.Pattern, s.Status = d.SourceEntityID, d.TargetEntityID, d.Pattern, d.Status
		// "other" means the source cannot tell; a protocol set here is kept.
		if d.Protocol != "other" {
			s.Protocol = d.Protocol
		}
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	link: func(s, d domain.CommunicationRelationship, source string) domain.CommunicationRelationship {
		s.Metadata = withLink(s.Metadata, d.Metadata, source)
		return s
	},
	stamp: func(e *domain.CommunicationRelationship, now string) { e.UpdatedAt = now },
	keep: func(s domain.CommunicationRelationship, source, now string) domain.CommunicationRelationship {
		s.Status = "inactive"
		s.Metadata = markMissing(s.Metadata, source, now)
		return s
	},
}

// channelTypes are the resource types that carry messages.
var channelTypes = map[string]bool{"topic": true, "queue": true, "exchange": true}

// effectiveEnvironment is a resource's environment, set on it or inherited from its nearest
// ancestor; "" when none. Bounded by the number of resources, so a cycle cannot loop.
func effectiveEnvironment(resources []domain.InfrastructureResource, at int) domain.EntityID {
	byID := make(map[domain.EntityID]int, len(resources))
	for i, r := range resources {
		byID[r.ID] = i
	}
	for steps := 0; steps <= len(resources); steps++ {
		r := resources[at]
		if r.EnvironmentID != nil {
			return *r.EnvironmentID
		}
		if r.ParentResourceID == nil {
			return ""
		}
		parent, ok := byID[*r.ParentResourceID]
		if !ok {
			return ""
		}
		at = parent
	}
	return ""
}
