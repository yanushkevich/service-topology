import { environmentOf, type TopologyIndex } from './topologyIndex';
import type { Reach } from './traversal';
import type { EntityId, EventType } from './types';

/**
 * Event types resolved against one environment (PRODUCT_SPEC Revision 6 §M.1, ADR-014). Flows use
 * only existing relationships: producer → channel, channel → consumer, or exchange → bound queue →
 * consumer. Nothing is inferred.
 */

export interface EventFlowParticipant {
  serviceDefinitionId: EntityId;
  /** The definition's instance in this environment, or null when it is not deployed here. */
  instanceId: EntityId | null;
  /** Relationships on the path between the instance and the channel (empty when not connected). */
  relationshipIds: EntityId[];
  /** Queue between an exchange channel and a consumer, when the consumer reads from a bound queue. */
  viaQueueId?: EntityId;
}

export interface EventFlow {
  eventType: EventType;
  /** The channel carrying the event in this environment. */
  channelId: EntityId;
  producers: EventFlowParticipant[];
  consumers: EventFlowParticipant[];
}

/** The event's channel in an environment: its own environment, or an environment-independent one. */
export function eventChannelIn(index: TopologyIndex, eventType: EventType, environmentId: EntityId): EntityId | null {
  const known = eventType.channelResourceIds.filter((id) => index.resources.has(id));
  return (
    known.find((id) => environmentOf(index, id) === environmentId) ??
    known.find((id) => environmentOf(index, id) === undefined) ??
    null
  );
}

function instanceIn(index: TopologyIndex, definitionId: EntityId, environmentId: EntityId | undefined): EntityId | null {
  const instances = index.instancesByDefinition.get(definitionId) ?? [];
  // An environment-independent channel can only be resolved when the definition has a single instance.
  if (environmentId === undefined) return instances.length === 1 ? (instances[0]?.id ?? null) : null;
  return instances.find((i) => i.environmentId === environmentId)?.id ?? null;
}

function producerPath(index: TopologyIndex, instanceId: EntityId, channelId: EntityId): Pick<EventFlowParticipant, 'relationshipIds'> {
  const rel = (index.outgoing.get(instanceId) ?? []).find((r) => r.targetEntityId === channelId);
  return { relationshipIds: rel ? [rel.id] : [] };
}

function consumerPath(index: TopologyIndex, instanceId: EntityId, channelId: EntityId): Pick<EventFlowParticipant, 'relationshipIds' | 'viaQueueId'> {
  const direct = (index.outgoing.get(channelId) ?? []).find((r) => r.targetEntityId === instanceId);
  if (direct) return { relationshipIds: [direct.id] };
  if (index.resources.get(channelId)?.type === 'exchange') {
    for (const binding of index.outgoing.get(channelId) ?? []) {
      if (index.resources.get(binding.targetEntityId)?.type !== 'queue') continue;
      const read = (index.outgoing.get(binding.targetEntityId) ?? []).find((r) => r.targetEntityId === instanceId);
      if (read) return { relationshipIds: [binding.id, read.id], viaQueueId: binding.targetEntityId };
    }
  }
  return { relationshipIds: [] };
}

/** Resolve one event type in an environment, or null when it has no channel there. */
export function resolveEventFlow(index: TopologyIndex, eventType: EventType, environmentId: EntityId): EventFlow | null {
  const channelId = eventChannelIn(index, eventType, environmentId);
  if (!channelId) return null;
  const channelEnvironment = environmentOf(index, channelId);
  const scope = channelEnvironment ?? environmentId;
  const participant = (definitionId: EntityId, path: typeof producerPath): EventFlowParticipant => {
    const instanceId = instanceIn(index, definitionId, scope);
    return { serviceDefinitionId: definitionId, instanceId, ...(instanceId ? path(index, instanceId, channelId) : { relationshipIds: [] }) };
  };
  return {
    eventType,
    channelId,
    producers: eventType.producerServiceIds.map((id) => participant(id, producerPath)),
    consumers: eventType.consumerServiceIds.map((id) => participant(id, consumerPath)),
  };
}

/** Event types present in an environment, sorted by name. */
export function eventFlowsIn(index: TopologyIndex, environmentId: EntityId): EventFlow[] {
  return [...index.eventTypes.values()]
    .map((e) => resolveEventFlow(index, e, environmentId))
    .filter((f): f is EventFlow => f !== null)
    .sort((a, b) => a.eventType.name.localeCompare(b.eventType.name, 'en'));
}

/** Entities and relationships an event highlight emphasizes (same shape as selection reach). */
export function eventFlowReach(flow: EventFlow): Reach {
  const entityIds = new Set<EntityId>([flow.channelId]);
  const relationshipIds = new Set<EntityId>();
  for (const p of [...flow.producers, ...flow.consumers]) {
    if (!p.instanceId || p.relationshipIds.length === 0) continue;
    entityIds.add(p.instanceId);
    if (p.viaQueueId) entityIds.add(p.viaQueueId);
    p.relationshipIds.forEach((id) => relationshipIds.add(id));
  }
  return { entityIds, relationshipIds };
}
