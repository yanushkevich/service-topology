import { resolveEventFlow } from './eventFlow';
import type { TopologyIndex } from './topologyIndex';
import type { BusinessFlow, EntityId, FlowOutcome, FlowStep, FlowTransition } from './types';

/**
 * Business flows resolved against one environment (ADR-022, docs/BUSINESS_FLOWS.md §2). Each
 * transition between two services is checked against the topology: a relationship for a call, the
 * event type's producer → channel → consumer relationships for an event. Nothing is inferred.
 */

export type TransitionBacking =
  /** Backed by these relationships (none for a local hand-off). */
  | { status: 'backed'; relationshipIds: EntityId[]; channelId?: EntityId }
  /** Both services run here, but the topology does not connect them as the transition says. */
  | { status: 'unbacked'; reason: string }
  /** One of the services is not deployed in this environment. */
  | { status: 'not-deployed'; serviceDefinitionIds: EntityId[] }
  /** The transition ends the flow (its target is an outcome). */
  | { status: 'outcome' };

export interface ResolvedFlowStep {
  step: FlowStep;
  /** The owning service's instance in this environment, or null when it is not deployed here. */
  instanceId: EntityId | null;
}

export interface ResolvedFlow {
  flow: BusinessFlow;
  environmentId: EntityId;
  steps: ResolvedFlowStep[];
  transitions: { transition: FlowTransition; backing: TransitionBacking }[];
}

export const stepById = (flow: BusinessFlow, id: string): FlowStep | undefined => flow.steps.find((s) => s.id === id);
export const outcomeById = (flow: BusinessFlow, id: string): FlowOutcome | undefined => flow.outcomes.find((o) => o.id === id);

function instanceIn(index: TopologyIndex, definitionId: EntityId, environmentId: EntityId): EntityId | null {
  return (index.instancesByDefinition.get(definitionId) ?? []).find((i) => i.environmentId === environmentId)?.id ?? null;
}

const relationshipBetween = (index: TopologyIndex, from: EntityId, to: EntityId) => (index.outgoing.get(from) ?? []).find((r) => r.targetEntityId === to);

/** How one transition is backed in an environment. Structural errors (unknown steps, …) are validation's job. */
export function transitionBacking(index: TopologyIndex, flow: BusinessFlow, transition: FlowTransition, environmentId: EntityId): TransitionBacking {
  const from = stepById(flow, transition.from);
  const to = stepById(flow, transition.to);
  if (!from || !to) return { status: 'outcome' };
  const via = transition.via;
  if (via.kind === 'local') return { status: 'backed', relationshipIds: [] };

  if (via.kind === 'call') {
    const caller = via.callerServiceId ?? from.serviceDefinitionId;
    if (caller === to.serviceDefinitionId) return { status: 'backed', relationshipIds: [] };
    const services = [...new Set([caller, to.serviceDefinitionId, ...(via.callerServiceId ? [] : [from.serviceDefinitionId])])];
    const missing = services.filter((id) => !instanceIn(index, id, environmentId));
    if (missing.length) return { status: 'not-deployed', serviceDefinitionIds: missing };
    const callerInstance = instanceIn(index, caller, environmentId) ?? '';
    const target = instanceIn(index, to.serviceDefinitionId, environmentId) ?? '';
    const call = relationshipBetween(index, callerInstance, target);
    if (call) return { status: 'backed', relationshipIds: [call.id] };
    // Without an explicit caller, control may return on the reply to a call the target made to the source.
    if (!via.callerServiceId) {
      const reply = relationshipBetween(index, target, callerInstance);
      if (reply) return { status: 'backed', relationshipIds: [reply.id] };
    }
    return { status: 'unbacked', reason: `No relationship "${callerInstance}" → "${target}"${via.callerServiceId ? '' : ' (or the reverse)'} in ${environmentId}` };
  }

  const eventType = index.eventTypes.get(via.eventTypeId);
  if (!eventType) return { status: 'unbacked', reason: `Unknown event type "${via.eventTypeId}"` };
  const missing = [from.serviceDefinitionId, to.serviceDefinitionId].filter((id) => !instanceIn(index, id, environmentId));
  if (missing.length) return { status: 'not-deployed', serviceDefinitionIds: [...new Set(missing)] };
  const eventFlow = resolveEventFlow(index, eventType, environmentId);
  if (!eventFlow) return { status: 'unbacked', reason: `"${eventType.name}" has no channel in ${environmentId}` };
  const producer = eventFlow.producers.find((p) => p.serviceDefinitionId === from.serviceDefinitionId);
  const consumer = eventFlow.consumers.find((c) => c.serviceDefinitionId === to.serviceDefinitionId);
  if (!producer?.relationshipIds.length || !consumer?.relationshipIds.length) {
    return { status: 'unbacked', reason: `"${eventType.name}" does not flow from ${from.serviceDefinitionId} to ${to.serviceDefinitionId} in ${environmentId}` };
  }
  return { status: 'backed', relationshipIds: [...producer.relationshipIds, ...consumer.relationshipIds], channelId: eventFlow.channelId };
}

/** One flow in one environment: where each step runs and how each transition is backed. */
export function resolveBusinessFlow(index: TopologyIndex, flow: BusinessFlow, environmentId: EntityId): ResolvedFlow {
  return {
    flow,
    environmentId,
    steps: flow.steps.map((step) => ({ step, instanceId: instanceIn(index, step.serviceDefinitionId, environmentId) })),
    transitions: flow.transitions.map((transition) => ({ transition, backing: transitionBacking(index, flow, transition, environmentId) })),
  };
}

/** Flows with at least one step deployed in the environment, sorted by name. */
export function businessFlowsIn(index: TopologyIndex, environmentId: EntityId): ResolvedFlow[] {
  return [...index.businessFlows.values()]
    .map((flow) => resolveBusinessFlow(index, flow, environmentId))
    .filter((r) => r.steps.some((s) => s.instanceId !== null))
    .sort((a, b) => a.flow.name.localeCompare(b.flow.name, 'en'));
}

/** Step and outcome IDs reachable from the start step. */
export function reachableFrom(flow: BusinessFlow, startId = flow.startStepId): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift() ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    for (const t of flow.transitions) if (t.from === id) queue.push(t.to);
  }
  return seen;
}
