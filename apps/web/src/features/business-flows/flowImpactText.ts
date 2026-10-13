import { outcomeById, stepById } from '../../domain/businessFlow';
import type { AffectedStep, FlowImpact } from '../../domain/flowImpact';
import type { FailureRoot } from '../../domain/propagation';
import { endpointName, type TopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow, EntityId } from '../../domain/types';

/**
 * Plain-language text for a simulated flow impact (docs/BUSINESS_FLOWS.md §12), e.g. "Card
 * Processor API unavailable → Checkout stops at Authorize payment, likely Cancelled, with
 * compensation." The callers label it simulated; it never says "live".
 */
export interface FlowImpactText {
  /** The simulated root failure: "Card Processor API unavailable". */
  cause: string;
  /** "stops at Authorize payment", or the affected steps when the typical path is untouched. */
  stop: string;
  /** "likely Cancelled, with compensation"; empty when the typical path is untouched. */
  likely: string;
  sentence: string;
}

export interface FlowImpactNames {
  entity: (id: EntityId) => string;
  event: (id: EntityId) => string;
}

export function describeFlowImpact(impact: FlowImpact, flow: BusinessFlow, failures: readonly FailureRoot[], names: FlowImpactNames): FlowImpactText {
  const first = impact.steps.find((s) => s.stepId === impact.firstAffectedStepId) ?? impact.steps[0];
  const rootId = first?.path[0];
  const mode = failures.find((f) => f.entityId === rootId)?.mode;
  const cause = rootId ? `${names.entity(rootId)} ${mode ?? 'failing'}` : 'A simulated failure';
  const stepName = (id: string) => stepById(flow, id)?.name ?? id;
  const offPath = `${impact.steps.length} step${impact.steps.length === 1 ? '' : 's'} affected off the typical path`;
  const stop = impact.firstAffectedStepId ? `stops at ${stepName(impact.firstAffectedStepId)}` : offPath;
  const likely = likelyText(impact, flow, names);
  return { cause, stop, likely, sentence: `${cause} → ${flow.name} ${stop}${likely ? `, ${likely}` : ''}.` };
}

function likelyText(impact: FlowImpact, flow: BusinessFlow, names: FlowImpactNames): string {
  const outcome = impact.likelyOutcome;
  if (!outcome) return '';
  switch (outcome.kind) {
    case 'outcome':
      return `likely ${outcomeById(flow, outcome.outcomeId)?.name ?? outcome.outcomeId}${outcome.compensated ? ', with compensation' : ''}`;
    case 'delayed': {
      const via = flow.transitions.find((t) => t.id === outcome.transitionId)?.via;
      return `likely delayed: ${via?.kind === 'event' ? names.event(via.eventTypeId) : 'the event'} waits for redelivery`;
    }
    case 'unknown':
      return 'and no failure path is modelled from there';
  }
}

/** One affected step and its cause chain: "Authorize payment: degraded (Card Processor API → Payment Service)". */
export function describeAffectedStep(step: AffectedStep, flow: BusinessFlow, entity: (id: EntityId) => string): string {
  const via = step.reason === 'input-channel' ? ', its input channel' : '';
  return `${stepById(flow, step.stepId)?.name ?? step.stepId}: ${step.effect}${via} (${step.path.map(entity).join(' → ')})`;
}

/** Names from the topology for the text. */
export function flowImpactNames(index: TopologyIndex): FlowImpactNames {
  return { entity: (id) => endpointName(index, id), event: (id) => index.eventTypes.get(id)?.name ?? id };
}
