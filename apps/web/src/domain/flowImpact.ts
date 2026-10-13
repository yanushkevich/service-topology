import { outcomeById, resolveBusinessFlow, stepById, typicalPath, type ResolvedFlow } from './businessFlow';
import type { FailureMode, FailureRoot, Impact } from './propagation';
import type { TopologyIndex } from './topologyIndex';
import type { BusinessFlow, EntityId, FlowTransition } from './types';

/**
 * Flows in impact analysis (ADR-025, docs/BUSINESS_FLOWS.md §12): the explained propagation result
 * mapped onto business flows. Pure and deterministic; ported to backend/internal/domain/flowimpact.go
 * with conformance fixtures (fixtures/conformance/impact/flows.json). Always simulated reasoning.
 *
 * A step is affected when its service instance fails, unless the instance only fails over a
 * relationship that backs one of the flow's own transitions: the flow models that call or event as
 * a hand-off, so the failure shows at the step it enters. An unavailable channel affects the step
 * its event enters; a degraded one (backlog) does not, as in the propagation rules.
 */

export interface AffectedStep {
  stepId: string;
  effect: FailureMode;
  /** The failing entity behind it: the step's service instance, or the channel its input arrives on. */
  entityId: EntityId;
  /** Failure root → … → entityId, from the propagation result. */
  path: EntityId[];
  reason: 'service' | 'input-channel';
}

export type LikelyOutcome =
  /** Where the step's failure path ends, and whether compensation runs on the way. */
  | { kind: 'outcome'; outcomeId: string; compensated: boolean }
  /** Entered by an event with redelivery or a dead-letter queue on a channel that is not unavailable: it waits. */
  | { kind: 'delayed'; transitionId: string }
  /** The flow models no failure path from the step. */
  | { kind: 'unknown' };

export interface FlowImpact {
  flowId: string;
  environmentId: EntityId;
  /** In the flow's step order. */
  steps: AffectedStep[];
  /** The first affected step on the typical path; null when the typical path is untouched. */
  firstAffectedStepId: string | null;
  /** The likely outcome from that step; null with it. */
  likelyOutcome: LikelyOutcome | null;
}

interface Failing {
  effect: FailureMode;
  path: EntityId[];
  viaRelationshipId?: EntityId | undefined;
}

const SEVERITY: Record<FailureMode, number> = { degraded: 1, unavailable: 2 };

/** Roots and their impacts, by entity. */
function failingEntities(roots: readonly FailureRoot[], impacts: readonly Impact[]): Map<EntityId, Failing> {
  const out = new Map<EntityId, Failing>();
  for (const r of roots) out.set(r.entityId, { effect: r.mode, path: [r.entityId] });
  for (const i of impacts) if (!out.has(i.entityId)) out.set(i.entityId, { effect: i.effect, path: i.path, viaRelationshipId: i.viaRelationshipId });
  return out;
}

/** Every flow with an affected step, per environment (by ID), flows by ID. */
export function flowImpacts(index: TopologyIndex, roots: readonly FailureRoot[], impacts: readonly Impact[]): FlowImpact[] {
  const failing = failingEntities(roots, impacts);
  if (failing.size === 0) return [];
  const environments = [...index.environments.keys()].sort();
  const flows = [...index.businessFlows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: FlowImpact[] = [];
  for (const environmentId of environments) {
    for (const flow of flows) {
      const resolved = resolveBusinessFlow(index, flow, environmentId);
      if (!resolved.steps.some((s) => s.instanceId !== null)) continue;
      const impact = flowImpact(resolved, failing);
      if (impact.steps.length > 0) out.push(impact);
    }
  }
  return out;
}

/** One resolved flow against the failing entities. */
function flowImpact(resolved: ResolvedFlow, failing: Map<EntityId, Failing>): FlowImpact {
  const { flow } = resolved;
  const steps = affectedSteps(resolved, failing);
  const typical = typicalPath(flow);
  const affected = new Set(steps.map((s) => s.stepId));
  const firstAffectedStepId = typical.steps.find((id) => affected.has(id)) ?? null;
  return {
    flowId: flow.id,
    environmentId: resolved.environmentId,
    steps,
    firstAffectedStepId,
    likelyOutcome: firstAffectedStepId === null ? null : likelyOutcome(resolved, firstAffectedStepId, new Set(typical.transitions), failing),
  };
}

function affectedSteps(resolved: ResolvedFlow, failing: Map<EntityId, Failing>): AffectedStep[] {
  const handOffs = new Set(resolved.transitions.flatMap(({ backing }) => (backing.status === 'backed' ? backing.relationshipIds : [])));
  const byStep = new Map<string, AffectedStep>();
  const add = (step: AffectedStep) => {
    const existing = byStep.get(step.stepId);
    if (!existing || SEVERITY[step.effect] > SEVERITY[existing.effect]) byStep.set(step.stepId, step);
  };
  for (const { step, instanceId } of resolved.steps) {
    const f = instanceId === null ? undefined : failing.get(instanceId);
    if (!f || instanceId === null) continue;
    if (f.viaRelationshipId !== undefined && handOffs.has(f.viaRelationshipId)) continue; // shown at the step the hand-off enters
    add({ stepId: step.id, effect: f.effect, entityId: instanceId, path: f.path, reason: 'service' });
  }
  for (const { transition, backing } of resolved.transitions) {
    if (backing.status !== 'backed' || backing.channelId === undefined || !stepById(resolved.flow, transition.to)) continue;
    const f = failing.get(backing.channelId);
    if (f?.effect === 'unavailable') add({ stepId: transition.to, effect: f.effect, entityId: backing.channelId, path: f.path, reason: 'input-channel' });
  }
  const order = new Map(resolved.flow.steps.map((s, i) => [s.id, i]));
  return [...byStep.values()].sort((a, b) => (order.get(a.stepId) ?? 0) - (order.get(b.stepId) ?? 0));
}

/** A policy is declared unless it is recorded as missing. */
const declares = (t: FlowTransition, type: string) => t.policies.some((p) => p.type === type && p.state !== 'missing');

function likelyOutcome(resolved: ResolvedFlow, stepId: string, typical: Set<string>, failing: Map<EntityId, Failing>): LikelyOutcome {
  const { flow } = resolved;
  const entering = resolved.transitions.find(
    ({ transition: t, backing }) =>
      t.to === stepId &&
      typical.has(t.id) &&
      t.via.kind === 'event' &&
      (declares(t, 'redelivery') || declares(t, 'dead-letter')) &&
      backing.status === 'backed' &&
      backing.channelId !== undefined &&
      failing.get(backing.channelId)?.effect !== 'unavailable',
  );
  if (entering) return { kind: 'delayed', transitionId: entering.transition.id };
  for (const exit of flow.transitions.filter((t) => t.from === stepId && !typical.has(t.id))) {
    const end = failureEnd(flow, exit.to);
    if (end) return { kind: 'outcome', ...end };
  }
  return { kind: 'unknown' };
}

/** From a failure exit: the first non-success outcome reached (breadth first), and whether a compensation step is reachable. */
function failureEnd(flow: BusinessFlow, start: string): { outcomeId: string; compensated: boolean } | null {
  const seen = new Set<string>();
  const queue = [start];
  let outcomeId: string | null = null;
  let compensated = false;
  while (queue.length) {
    const id = queue.shift() ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    const outcome = outcomeById(flow, id);
    if (outcome && outcome.kind !== 'success' && outcomeId === null) outcomeId = outcome.id;
    if (stepById(flow, id)?.kind === 'compensation') compensated = true;
    for (const t of flow.transitions) if (t.from === id) queue.push(t.to);
  }
  return outcomeId === null ? null : { outcomeId, compensated };
}
