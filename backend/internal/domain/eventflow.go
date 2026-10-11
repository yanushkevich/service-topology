package domain

// EventFlowParticipant is a producer or consumer definition resolved in one environment
// (eventFlow.ts). InstanceID is empty when the definition is not deployed there.
type EventFlowParticipant struct {
	ServiceDefinitionID EntityID
	InstanceID          EntityID
	// RelationshipIDs is the path between the instance and the channel; empty when not connected.
	RelationshipIDs []EntityID
	// ViaQueueID is set when a consumer reads from a queue bound to an exchange channel.
	ViaQueueID EntityID
}

// EventFlow is an event type resolved against one environment.
type EventFlow struct {
	EventType *EventType
	ChannelID EntityID
	Producers []EventFlowParticipant
	Consumers []EventFlowParticipant
}

// EventChannelIn returns the event's channel in an environment: one in that environment, else an
// environment-independent one.
func (ix *Index) EventChannelIn(e *EventType, environmentID EntityID) (EntityID, bool) {
	var known []EntityID
	for _, id := range e.ChannelResourceIDs {
		if ix.Resources[id] != nil {
			known = append(known, id)
		}
	}
	for _, id := range known {
		if env, ok := ix.EnvironmentOf(id); ok && env == environmentID {
			return id, true
		}
	}
	for _, id := range known {
		if _, ok := ix.EnvironmentOf(id); !ok {
			return id, true
		}
	}
	return "", false
}

func (ix *Index) instanceIn(definitionID, environmentID EntityID) EntityID {
	for _, inst := range ix.InstancesByDefinition[definitionID] {
		if inst.EnvironmentID != nil && *inst.EnvironmentID == environmentID {
			return inst.ID
		}
	}
	return ""
}

func (ix *Index) producerPath(instanceID, channelID EntityID) EventFlowParticipant {
	for _, r := range ix.Outgoing[instanceID] {
		if r.TargetEntityID == channelID {
			return EventFlowParticipant{RelationshipIDs: []EntityID{r.ID}}
		}
	}
	return EventFlowParticipant{}
}

func (ix *Index) consumerPath(instanceID, channelID EntityID) EventFlowParticipant {
	for _, r := range ix.Outgoing[channelID] {
		if r.TargetEntityID == instanceID {
			return EventFlowParticipant{RelationshipIDs: []EntityID{r.ID}}
		}
	}
	if ch := ix.Resources[channelID]; ch != nil && ch.Type == "exchange" {
		for _, binding := range ix.Outgoing[channelID] {
			if q := ix.Resources[binding.TargetEntityID]; q == nil || q.Type != "queue" {
				continue
			}
			for _, read := range ix.Outgoing[binding.TargetEntityID] {
				if read.TargetEntityID == instanceID {
					return EventFlowParticipant{RelationshipIDs: []EntityID{binding.ID, read.ID}, ViaQueueID: binding.TargetEntityID}
				}
			}
		}
	}
	return EventFlowParticipant{}
}

// ResolveEventFlow resolves one event type in an environment; ok=false when it has no channel there.
// Flows use only existing relationships; nothing is inferred.
func (ix *Index) ResolveEventFlow(e *EventType, environmentID EntityID) (EventFlow, bool) {
	channelID, ok := ix.EventChannelIn(e, environmentID)
	if !ok {
		return EventFlow{}, false
	}
	scope := environmentID
	if env, ok := ix.EnvironmentOf(channelID); ok {
		scope = env
	}
	participant := func(definitionID EntityID, path func(instanceID, channelID EntityID) EventFlowParticipant) EventFlowParticipant {
		p := EventFlowParticipant{ServiceDefinitionID: definitionID, InstanceID: ix.instanceIn(definitionID, scope)}
		if p.InstanceID != "" {
			found := path(p.InstanceID, channelID)
			p.RelationshipIDs, p.ViaQueueID = found.RelationshipIDs, found.ViaQueueID
		}
		return p
	}
	flow := EventFlow{EventType: e, ChannelID: channelID}
	for _, id := range e.ProducerServiceIDs {
		flow.Producers = append(flow.Producers, participant(id, ix.producerPath))
	}
	for _, id := range e.ConsumerServiceIDs {
		flow.Consumers = append(flow.Consumers, participant(id, ix.consumerPath))
	}
	return flow, true
}
