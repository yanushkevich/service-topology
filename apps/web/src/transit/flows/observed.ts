import type { BusinessFlow, FlowOutcomeKind } from '../../domain/types';
import type { StepStats, TransitWindow } from '../types';

/**
 * Observed side of business flows (docs/BUSINESS_FLOWS.md §5): statistics per flow and window, and
 * business transactions joined across traces by business key. Until trace ingestion exists these
 * come from example data (`isExample`), never presented as observed.
 */

export interface FlowStats {
  flowId: string;
  window: TransitWindow;
  isExample: boolean;
  /** Business transactions started in the window. */
  transactions: number;
  /** Share of transactions per outcome ID. */
  outcomes: Record<string, number>;
  completion: { p50Ms: number; p95Ms: number };
  /** Typical-mode stats per step ID. */
  steps: Record<string, StepStats>;
  /** Share of transactions taking each transition ID. */
  transitions: Record<string, number>;
}

export type TxStepStatus = 'ok' | 'warn' | 'fail';

/** One event of a business transaction, at a step (station) of the flow. */
export interface TxStep {
  /** Step ID the event happened at. */
  stepId: string;
  /** Transition that brought the transaction here, if any. */
  transitionId?: string;
  label: string;
  /** Real start (ms since the transaction started) and duration. */
  startMs: number;
  durationMs: number;
  /** Replay timeline (waits compressed): where the step sits on the replay clock. */
  displayStartMs: number;
  displayDurationMs: number;
  status: TxStepStatus;
  attempt?: number;
  /** Redelivery number of an asynchronous hand-off. */
  redelivery?: number;
  /** The message was parked on a dead-letter queue, or dropped without one. */
  deadLetter?: 'parked' | 'dropped';
  /** False when no trace connects this step to the previous one (shown as a gap, never bridged). */
  correlated: boolean;
  /** Steps with the same value ran in parallel. */
  parallel?: string;
  /** A compensation step (undo track). */
  compensation?: boolean;
  /** The service trace for drill-down (`/services/:id/transit?mode=trace&trace=…`). */
  trace?: { serviceDefinitionId: string; lineId: string; traceId: string };
}

export interface FlowTransaction {
  /** Business key, e.g. 'order 4486'. */
  key: string;
  flowId: string;
  startedAt: string;
  outcomeId: string;
  outcomeKind: FlowOutcomeKind;
  durationMs: number;
  /** Retries and redeliveries in the transaction. */
  retries: number;
  compensated: boolean;
  steps: TxStep[];
}

/** Replay timeline: waits and long gaps longer than this are compressed to it. */
export const COMPRESSED_MS = 1500;

export const isCompressed = (step: Pick<TxStep, 'durationMs' | 'displayDurationMs'>) => step.displayDurationMs < step.durationMs;


export type TxSampleReason = 'slowest' | 'failed' | 'compensated' | 'with retries' | 'typical';

/** Sample transactions (spec §5): slowest, failed, compensated, with retries, typical. */
export function sampleTransactions(transactions: readonly FlowTransaction[], stats: FlowStats | null): { tx: FlowTransaction; reasons: TxSampleReason[] }[] {
  const newest = [...transactions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const p50 = stats?.completion.p50Ms ?? 0;
  const picks: [TxSampleReason, FlowTransaction | undefined][] = [
    ['slowest', [...transactions].sort((a, b) => b.durationMs - a.durationMs)[0]],
    ['failed', newest.find((t) => t.outcomeKind === 'failed' || t.steps.some((s) => s.deadLetter))],
    ['compensated', newest.find((t) => t.compensated)],
    ['with retries', newest.find((t) => t.retries > 0 && !t.compensated)],
    ['typical', [...transactions].filter((t) => t.outcomeKind === 'success').sort((a, b) => Math.abs(a.durationMs - p50) - Math.abs(b.durationMs - p50))[0]],
  ];
  const out: { tx: FlowTransaction; reasons: TxSampleReason[] }[] = [];
  for (const [reason, tx] of picks) {
    if (!tx) continue;
    const existing = out.find((o) => o.tx.key === tx.key);
    if (existing) existing.reasons.push(reason);
    else out.push({ tx, reasons: [reason] });
  }
  return out;
}

/**
 * Where a transaction departs from the flow's typical path: the first step off it, else the first
 * failed or warning step. Uncorrelated gaps are limits of the data, not divergence.
 */
export function txDivergence(flow: BusinessFlow, tx: FlowTransaction, typicalSteps: readonly string[]): { stepIndex: number; text: string } | null {
  const name = (id: string) => flow.steps.find((s) => s.id === id)?.name ?? id;
  const typical = new Set(typicalSteps);
  const off = tx.steps.findIndex((s) => !typical.has(s.stepId));
  if (off >= 0) {
    const step = tx.steps[off];
    const before = tx.steps.slice(0, off).reverse().find((s) => s.status !== 'ok');
    return { stepIndex: off, text: `Left the typical path to ${name(step?.stepId ?? '')}${before ? ` after “${before.label}”` : ''}; typical transactions do not go there.` };
  }
  const failed = tx.steps.findIndex((s) => s.status === 'fail');
  if (failed >= 0) return { stepIndex: failed, text: `${tx.steps[failed]?.label ?? ''} at ${name(tx.steps[failed]?.stepId ?? '')}; typical transactions pass here.` };
  const warn = tx.steps.findIndex((s) => s.status === 'warn' && s.correlated);
  if (warn >= 0) return { stepIndex: warn, text: `${tx.steps[warn]?.label ?? ''} at ${name(tx.steps[warn]?.stepId ?? '')}; typical transactions pass here without retries.` };
  return null;
}

/** Steps running at the replay time: the current step (cursor) and parallel steps still in flight. */
export function activeTxSteps(steps: readonly TxStep[], t: number, cursor: number): TxStep[] {
  const current = steps[cursor];
  const running = steps.filter((s) => s.parallel && s !== current && s.displayStartMs <= t && t < s.displayStartMs + Math.max(1, s.displayDurationMs));
  return current ? [current, ...running.filter((s) => s.parallel !== current.parallel)] : running;
}
