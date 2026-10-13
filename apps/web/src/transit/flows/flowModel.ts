import { reachableFrom, stepById, typicalPath } from '../../domain/businessFlow';
import type { BusinessFlow, FlowPolicyType, FlowStep, FlowTransition } from '../../domain/types';
import { flowRanks } from './flowIndex';
import { patternLabel } from '../../domain/patterns';
import { lineNamed } from '../board';

/**
 * Flow-level reading of a business flow (docs/BUSINESS_FLOWS.md §3, §5): the typical path, the
 * end-to-end budget, and the findings that only show at flow level. Pure.
 */

/** Columns of the strip: steps and outcomes at each rank, in rank order. */
export function stages(flow: BusinessFlow): { rank: number; steps: FlowStep[]; outcomes: BusinessFlow['outcomes'] }[] {
  const ranks = flowRanks(flow);
  const max = Math.max(0, ...ranks.values());
  return Array.from({ length: max + 1 }, (_, rank) => ({
    rank,
    steps: flow.steps.filter((s) => ranks.get(s.id) === rank),
    outcomes: flow.outcomes.filter((o) => ranks.get(o.id) === rank),
  })).filter((s) => s.steps.length + s.outcomes.length > 0);
}

const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);
const attemptsOf = (t: FlowTransition) => num(t.policies.find((p) => p.type === 'retry' && p.state !== 'missing')?.config?.maxAttempts) ?? 1;
const timeoutOf = (t: FlowTransition) => num(t.policies.find((p) => p.type === 'timeout' && p.state !== 'missing')?.config?.timeoutMs);

export interface FlowBudgetSegment {
  stepId: string;
  name: string;
  ms: number;
  /** How the segment was counted. */
  basis: string;
}

/**
 * The flow budget (spec §3): the end-to-end target against what the typical path may take. Each
 * synchronous step counts its incoming call timeout × retry attempts, else its own deadline; waits
 * and asynchronous hand-offs are not part of the response-time budget. Null without a p95 target.
 */
export function flowBudget(flow: BusinessFlow, shares?: ReadonlyMap<string, number>): { targetMs: number; segments: FlowBudgetSegment[]; totalMs: number; overflowMs: number } | null {
  const targetMs = flow.target?.p95Ms;
  if (!targetMs) return null;
  const { steps, transitions } = typicalPath(flow, shares);
  const segments: FlowBudgetSegment[] = [];
  for (const id of steps) {
    const step = stepById(flow, id);
    if (!step || step.kind === 'wait') continue;
    const incoming = flow.transitions.find((t) => t.to === id && transitions.includes(t.id) && t.via.kind === 'call');
    const timeout = incoming ? timeoutOf(incoming) : undefined;
    if (incoming && timeout !== undefined) {
      const attempts = attemptsOf(incoming);
      segments.push({ stepId: id, name: step.name, ms: timeout * attempts, basis: attempts > 1 ? `${timeout / 1000} s timeout × ${attempts} attempts` : `${timeout / 1000} s timeout` });
    } else if (step.deadlineMs !== undefined) {
      segments.push({ stepId: id, name: step.name, ms: step.deadlineMs, basis: 'step deadline' });
    }
  }
  const totalMs = segments.reduce((n, s) => n + s.ms, 0);
  return { targetMs, segments, totalMs, overflowMs: Math.max(0, totalMs - targetMs) };
}

export interface FlowFinding {
  ruleId:
    | 'retry-amplification'
    | 'missing-compensation'
    | 'event-without-dead-letter'
    | 'deadline-over-target'
    | 'missing-policy'
    | 'outbox-without-relay'
    | 'at-least-once-without-dedup'
    | 'polling-without-deadline'
    | 'store-pattern-without-store';
  severity: 'warn' | 'info';
  text: string;
  stepIds: string[];
  transitionIds: string[];
}

/** A policy is declared unless it is recorded as missing. */
const declared = (t: FlowTransition, type: FlowPolicyType) => t.policies.some((p) => p.type === type && p.state !== 'missing');
/** An outbox or broker redelivery means a message can arrive more than once. */
const atLeastOnce = (t: FlowTransition) => declared(t, 'outbox') || declared(t, 'redelivery');
const deduplicated = (t: FlowTransition) => declared(t, 'inbox') || declared(t, 'idempotent-consumer');

const fmt = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : ms >= 1000 ? `${Number((ms / 1000).toFixed(1))} s` : `${ms} ms`);

/**
 * Findings that need the flow level (spec §3). `innerAttempts` reports retries inside a step (e.g.
 * from the service's transit board: the card client's attempts behind "Authorize"), so retries can
 * be multiplied across levels.
 */
export function flowFindings(
  flow: BusinessFlow,
  options: {
    eventName?: (eventTypeId: string) => string;
    serviceName?: (id: string) => string;
    innerAttempts?: (step: FlowStep) => { attempts: number; what: string } | null;
    shares?: ReadonlyMap<string, number>;
    /** Database names of a service in the environment (ADR-027); without it, store rules are skipped. */
    databasesOf?: (serviceDefinitionId: string) => string[];
  } = {},
): FlowFinding[] {
  const out: FlowFinding[] = [];
  const name = (id: string) => stepById(flow, id)?.name ?? flow.outcomes.find((o) => o.id === id)?.name ?? id;
  const service = (id: string) => options.serviceName?.(id) ?? id;

  // Retries multiplied across levels: a retried call into a step that retries inside.
  for (const t of flow.transitions) {
    const to = stepById(flow, t.to);
    if (!to || t.via.kind !== 'call') continue;
    const outer = attemptsOf(t);
    const inner = options.innerAttempts?.(to);
    if (outer > 1 && inner && outer * inner.attempts >= 6) {
      const caller = t.via.callerServiceId ?? stepById(flow, t.from)?.serviceDefinitionId ?? '';
      out.push({
        ruleId: 'retry-amplification',
        severity: 'warn',
        text: `${to.name}: ${service(caller)} retries ${outer}× and ${inner.what} retries ${inner.attempts}× inside: up to ${outer * inner.attempts} calls per ${flow.name.toLowerCase()}.`,
        stepIds: [to.id],
        transitionIds: [t.id],
      });
    }
  }

  // Side effects that are not undone when the flow fails: steps that can still reach both a success
  // and a non-success outcome, are not the start, a decision, a wait, or a compensation, and have no
  // compensation step.
  const success = new Set(flow.outcomes.filter((o) => o.kind === 'success').map((o) => o.id));
  const failure = flow.outcomes.filter((o) => o.kind !== 'success');
  for (const step of flow.steps) {
    if (step.id === flow.startStepId || step.compensatedBy || ['decision', 'wait', 'compensation'].includes(step.kind)) continue;
    const reach = reachableFrom(flow, step.id);
    const failsTo = failure.filter((o) => reach.has(o.id));
    if (failsTo.length && [...success].some((id) => reach.has(id))) {
      out.push({
        ruleId: 'missing-compensation',
        severity: 'warn',
        text: `${step.name} is not undone when the flow ends ${failsTo.map((o) => o.name).join(' or ')}: it has no compensation step.`,
        stepIds: [step.id],
        transitionIds: [],
      });
    }
  }

  // Asynchronous hand-offs without a dead-letter queue.
  for (const t of flow.transitions) {
    if (t.via.kind !== 'event') continue;
    const dlq = t.policies.find((p) => p.type === 'dead-letter');
    if (!dlq || dlq.state === 'missing') {
      out.push({
        ruleId: 'event-without-dead-letter',
        severity: 'warn',
        text: `${options.eventName?.(t.via.eventTypeId) ?? t.via.eventTypeId} (${name(t.from)} → ${name(t.to)}) has no dead-letter queue: a message that keeps failing is lost or blocks the consumer.`,
        stepIds: [t.from, t.to],
        transitionIds: [t.id],
      });
    }
  }

  // Messaging reliability and polling (ADR-024).
  const at = (t: FlowTransition) => `${name(t.from)} → ${name(t.to)}`;
  for (const t of flow.transitions) {
    if (t.via.kind === 'event') {
      const event = options.eventName?.(t.via.eventTypeId) ?? t.via.eventTypeId;
      if (declared(t, 'outbox') && !declared(t, 'polling-publisher')) {
        out.push({ ruleId: 'outbox-without-relay', severity: 'info', text: `${event} (${at(t)}) is written to an outbox, but no relay is declared to publish it: messages may stay in the outbox.`, stepIds: [t.from], transitionIds: [t.id] });
      }
      if (atLeastOnce(t) && !deduplicated(t)) {
        out.push({
          ruleId: 'at-least-once-without-dedup',
          severity: 'warn',
          text: `${event} (${at(t)}) can be delivered more than once, and ${name(t.to)} has neither an inbox nor an idempotent consumer: duplicates reach the step.`,
          stepIds: [t.to],
          transitionIds: [t.id],
        });
      }
    }
    // Store patterns live in a database: the outbox and its relay on the producer's side, the inbox on the consumer's (ADR-027).
    if (options.databasesOf) {
      for (const [type, side] of [['outbox', t.from], ['polling-publisher', t.from], ['inbox', t.to]] as const) {
        const step = stepById(flow, side);
        if (!declared(t, type) || !step || options.databasesOf(step.serviceDefinitionId).length > 0) continue;
        out.push({
          ruleId: 'store-pattern-without-store',
          severity: 'warn',
          text: `${at(t)} declares the ${patternLabel(type).toLowerCase()}, but ${service(step.serviceDefinitionId)} has no database in the topology to keep it in.`,
          stepIds: [step.id],
          transitionIds: [t.id],
        });
      }
    }
    if (t.via.kind === 'call' && declared(t, 'async-request-reply')) {
      const polling = t.policies.find((p) => p.type === 'async-request-reply');
      if (!num(polling?.config?.timeoutMs) && stepById(flow, t.to)?.deadlineMs === undefined) {
        out.push({ ruleId: 'polling-without-deadline', severity: 'warn', text: `${at(t)} polls for the result with no timeout and no step deadline: a lost job keeps the caller polling forever.`, stepIds: [t.from, t.to], transitionIds: [t.id] });
      }
    }
  }

  // The typical path's timeouts and deadlines against the target.
  const budget = flowBudget(flow, options.shares);
  if (budget && budget.overflowMs > 0) {
    out.push({
      ruleId: 'deadline-over-target',
      severity: 'warn',
      text: `Timeouts and deadlines on the typical path add up to ${fmt(budget.totalMs)}, above the ${fmt(budget.targetMs)} response-time target (p95).`,
      stepIds: budget.segments.map((s) => s.stepId),
      transitionIds: [],
    });
  }
  const completion = flow.target?.completionMs;
  for (const step of flow.steps) {
    if (completion !== undefined && step.deadlineMs !== undefined && step.deadlineMs > completion) {
      out.push({ ruleId: 'deadline-over-target', severity: 'warn', text: `${step.name} may take ${fmt(step.deadlineMs)}, longer than the flow's ${fmt(completion)} completion target.`, stepIds: [step.id], transitionIds: [] });
    }
  }

  // Expected policies that are absent (declared as missing by the rule list).
  for (const t of flow.transitions) {
    for (const p of t.policies) {
      // Dead-letter queues and deduplication have their own findings above.
      if (p.state !== 'missing' || p.type === 'dead-letter' || ((p.type === 'idempotent-consumer' || p.type === 'inbox') && t.via.kind === 'event' && atLeastOnce(t))) continue;
      out.push({ ruleId: 'missing-policy', severity: 'info', text: `No ${patternLabel(p.type).toLowerCase()} on ${name(t.from)} → ${name(t.to)} (“${p.label}”).`, stepIds: [t.from, t.to], transitionIds: [t.id] });
    }
  }
  return out;
}

/** Lowercase search text: flow name, owner, services, step names, and event names. */
export function flowSearchText(flow: BusinessFlow, serviceName: (id: string) => string, eventName: (id: string) => string): string {
  const parts = [flow.name, flow.description ?? '', flow.owner ?? '', flow.team ?? ''];
  for (const s of flow.steps) parts.push(s.name, serviceName(s.serviceDefinitionId), s.entryPoint ?? '');
  for (const t of flow.transitions) if (t.via.kind === 'event') parts.push(eventName(t.via.eventTypeId));
  return parts.join(' ').toLowerCase();
}

/** The service-board line a flow step enters: its entry point names the line (ADR-023 §10). */
export function lineForStep<T extends { id: string; name: string; signature: string }>(lines: readonly T[], step: FlowStep): T | null {
  return step.entryPoint ? lineNamed(lines, step.entryPoint) : null;
}

export interface FlowOnService {
  flow: BusinessFlow;
  /** The flow's steps on this service, with the line each enters (null: not mapped to a line). */
  steps: { step: FlowStep; lineId: string | null }[];
}

/** Flows with at least one step on the service, in the given order, each with its steps there. */
export function flowsOnService(flows: readonly BusinessFlow[], serviceDefinitionId: string, lines: readonly { id: string; name: string; signature: string }[]): FlowOnService[] {
  return flows.flatMap((flow) => {
    const steps = flow.steps.filter((s) => s.serviceDefinitionId === serviceDefinitionId).map((step) => ({ step, lineId: lineForStep(lines, step)?.id ?? null }));
    return steps.length ? [{ flow, steps }] : [];
  });
}
