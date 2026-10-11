import { PROPAGATION_RULES, type PropagationRuleId } from '../../domain/propagation';
import { endpointName, type TopologyIndex } from '../../domain/topologyIndex';
import type { SimulationEvent } from '../../simulation/engine';
export { formatClock } from '../../shared/format';
import { healthLabel, patternLabel, protocolLabel, relationshipStatusLabel } from '../../shared/mappings';

export const ruleTitle = (id: PropagationRuleId) => PROPAGATION_RULES.find((r) => r.id === id)?.title ?? id;

export interface EventDescription {
  title: string;
  detail?: string;
}

/**
 * Human-readable description of a simulated event. Names come from the simulation baseline so
 * events stay readable while browsing history. Propagated changes always name rule and path.
 */
export function describeEvent(index: TopologyIndex, event: SimulationEvent): EventDescription {
  const name = (id: string) => endpointName(index, id);
  const transition = (from?: string, to?: string) => (from && to ? `${healthLabel(from)} → ${healthLabel(to)}` : '');
  switch (event.type) {
    case 'failure-injected':
      return { title: `${name(event.entityId)}: simulated failure, ${transition(event.from, event.to)}`, ...(event.note ? { detail: event.note } : {}) };
    case 'recovered':
      return { title: `${name(event.entityId)}: recovered, ${transition(event.from, event.to)}`, ...(event.note ? { detail: event.note } : {}) };
    case 'health-changed': {
      const title = `${name(event.entityId)}: ${transition(event.from, event.to)}`;
      if (!event.cause) return { title, ...(event.note ? { detail: event.note } : {}) };
      const via = event.cause.viaRelationshipId ? index.relationships.get(event.cause.viaRelationshipId) : undefined;
      const how = via ? ` over ${protocolLabel(via.protocol)} (${patternLabel(via.pattern).toLowerCase()})` : ' (containment)';
      const root = event.cause.rootId !== event.cause.causeId ? ` Root failure: ${name(event.cause.rootId)}.` : '';
      return {
        title,
        detail: `Caused by ${name(event.cause.causeId)}${how}. Rule: ${ruleTitle(event.cause.ruleId)}.${root}`,
      };
    }
    case 'status-changed': {
      const r = index.relationships.get(event.entityId);
      const label = r ? `${name(r.sourceEntityId)} → ${name(r.targetEntityId)}` : event.entityId;
      return {
        title: `Connection ${label}: ${relationshipStatusLabel(event.from ?? 'unknown')} → ${relationshipStatusLabel(event.to ?? 'unknown')}`,
      };
    }
    case 'latency-anomaly':
      return { title: `${name(event.entityId)}: latency spike`, ...(event.note ? { detail: event.note } : {}) };
    case 'latency-normal':
      return { title: `${name(event.entityId)}: latency normal`, ...(event.note ? { detail: event.note } : {}) };
  }
}
