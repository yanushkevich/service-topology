package domain

// Index is a read-only lookup structure derived once from TopologyData (topologyIndex.ts). As in the
// TypeScript Map-based index, a duplicate ID keeps the last entity, and grouped slices keep input order.
type Index struct {
	Data                  *TopologyData
	Environments          map[EntityID]*Environment
	Definitions           map[EntityID]*ServiceDefinition
	Instances             map[EntityID]*ServiceInstance
	Resources             map[EntityID]*InfrastructureResource
	Relationships         map[EntityID]*CommunicationRelationship
	EventTypes            map[EntityID]*EventType
	InstancesByDefinition map[EntityID][]*ServiceInstance
	InstancesByResource   map[EntityID][]*ServiceInstance
	ChildResources        map[EntityID][]*InfrastructureResource
	// Outgoing and Incoming hold relationships keyed by source and target entity.
	Outgoing map[EntityID][]*CommunicationRelationship
	Incoming map[EntityID][]*CommunicationRelationship
}

// BuildIndex indexes data. The returned index points into data; do not mutate data afterwards.
func BuildIndex(data *TopologyData) *Index {
	ix := &Index{
		Data:                  data,
		Environments:          make(map[EntityID]*Environment, len(data.Environments)),
		Definitions:           make(map[EntityID]*ServiceDefinition, len(data.ServiceDefinitions)),
		Instances:             make(map[EntityID]*ServiceInstance, len(data.ServiceInstances)),
		Resources:             make(map[EntityID]*InfrastructureResource, len(data.Resources)),
		Relationships:         make(map[EntityID]*CommunicationRelationship, len(data.Relationships)),
		EventTypes:            make(map[EntityID]*EventType, len(data.EventTypes)),
		InstancesByDefinition: map[EntityID][]*ServiceInstance{},
		InstancesByResource:   map[EntityID][]*ServiceInstance{},
		ChildResources:        map[EntityID][]*InfrastructureResource{},
		Outgoing:              map[EntityID][]*CommunicationRelationship{},
		Incoming:              map[EntityID][]*CommunicationRelationship{},
	}
	for i := range data.Environments {
		ix.Environments[data.Environments[i].ID] = &data.Environments[i]
	}
	for i := range data.ServiceDefinitions {
		ix.Definitions[data.ServiceDefinitions[i].ID] = &data.ServiceDefinitions[i]
	}
	for i := range data.ServiceInstances {
		inst := &data.ServiceInstances[i]
		ix.Instances[inst.ID] = inst
		ix.InstancesByDefinition[inst.ServiceDefinitionID] = append(ix.InstancesByDefinition[inst.ServiceDefinitionID], inst)
		if inst.ResourceID != nil {
			ix.InstancesByResource[*inst.ResourceID] = append(ix.InstancesByResource[*inst.ResourceID], inst)
		}
	}
	for i := range data.Resources {
		r := &data.Resources[i]
		ix.Resources[r.ID] = r
		if r.ParentResourceID != nil {
			ix.ChildResources[*r.ParentResourceID] = append(ix.ChildResources[*r.ParentResourceID], r)
		}
	}
	for i := range data.Relationships {
		r := &data.Relationships[i]
		ix.Relationships[r.ID] = r
		ix.Outgoing[r.SourceEntityID] = append(ix.Outgoing[r.SourceEntityID], r)
		ix.Incoming[r.TargetEntityID] = append(ix.Incoming[r.TargetEntityID], r)
	}
	for i := range data.EventTypes {
		ix.EventTypes[data.EventTypes[i].ID] = &data.EventTypes[i]
	}
	return ix
}

// ResourceAncestors returns the ancestors of a resource, root first. It stops at a missing parent or
// a cycle.
func (ix *Index) ResourceAncestors(resourceID EntityID) []*InfrastructureResource {
	var chain []*InfrastructureResource
	seen := map[EntityID]bool{resourceID: true}
	r := ix.Resources[resourceID]
	if r == nil {
		return nil
	}
	parentID := r.ParentResourceID
	for parentID != nil && !seen[*parentID] {
		parent := ix.Resources[*parentID]
		if parent == nil {
			break
		}
		chain = append([]*InfrastructureResource{parent}, chain...)
		seen[*parentID] = true
		parentID = parent.ParentResourceID
	}
	return chain
}

// EnvironmentOf returns the environment of an instance or resource and whether one is defined.
// Resources inherit the nearest ancestor's environment; ok=false means environment-independent
// (or unknown entity). An instance with a nil environment reports ok=false, as in TypeScript.
func (ix *Index) EnvironmentOf(id EntityID) (EntityID, bool) {
	if inst := ix.Instances[id]; inst != nil {
		if inst.EnvironmentID == nil {
			return "", false
		}
		return *inst.EnvironmentID, true
	}
	r := ix.Resources[id]
	if r == nil {
		return "", false
	}
	if r.EnvironmentID != nil {
		return *r.EnvironmentID, true
	}
	ancestors := ix.ResourceAncestors(id)
	for i := len(ancestors) - 1; i >= 0; i-- {
		if ancestors[i].EnvironmentID != nil {
			return *ancestors[i].EnvironmentID, true
		}
	}
	return "", false
}
