import type { BusinessFlow } from '../../domain/types';
import { paymentServiceTraces } from '../mock/paymentServiceTraces';
import type { StepStats, TransitWindow } from '../types';
import { COMPRESSED_MS, type FlowStats, type FlowTransaction, type TxStep } from './observed';

/**
 * Example observed data for the example Checkout and Refund flows (src/data/mock/businessFlows.ts):
 * statistics per window and business transactions. Invented, deterministic, and labelled example
 * data. Steps implemented by Payment Service link to its example traces for drill-down.
 */

const WINDOW_FRACTION: Record<TransitWindow, number> = { '7d': 1, '24h': 1 / 7, '1h': 1 / 168 };
const s = (share: number, p50Ms: number, p99Ms: number, errorRate = 0, retryRate = 0): StepStats => ({ share, p50Ms, p99Ms, errorRate, retryRate });

const STATS: Record<string, Omit<FlowStats, 'window' | 'isExample' | 'transactions'> & { weekly: number }> = {
  'flow-checkout': {
    flowId: 'flow-checkout',
    weekly: 176_000,
    outcomes: { completed: 0.975, 'order-cancelled': 0.025 },
    completion: { p50Ms: 252_000, p95Ms: 548_000 },
    steps: {
      'place-order': s(1, 46, 140, 0.002),
      'reserve-stock': s(1, 38, 410, 0.004, 0.004),
      'authorize-payment': s(1, 120, 1650, 0.011, 0.011),
      'capture-payment': s(0.98, 190, 680, 0.003, 0.031),
      'await-settlement': s(0.98, 240_000, 540_000, 0.003),
      'post-to-ledger': s(0.977, 13, 110, 0.002, 0.001),
      'ship-order': s(0.98, 60, 210, 0.001, 0.009),
      'notify-customer': s(0.98, 9, 45, 0.004, 0.006),
      'send-email': s(0.976, 90, 420, 0.005),
      'cancel-order': s(0.023, 30, 120),
      'release-stock': s(0.023, 14, 90),
      'void-authorization': s(0.003, 150, 190),
    },
    transitions: { placed: 1, authorize: 1, approved: 0.98, declined: 0.02, captured: 0.98, settle: 0.98, settled: 0.977, 'not-settled': 0.003, 'ledger-done': 0.977, shipped: 0.98, notify: 0.98, sent: 0.976, cancelled: 0.023, void: 0.003, released: 0.023, voided: 0.003 },
  },
  'flow-refund': {
    flowId: 'flow-refund',
    weekly: 9_400,
    outcomes: { refunded: 0.97, 'refund-rejected': 0.03 },
    completion: { p50Ms: 1_900, p95Ms: 4_200 },
    steps: {
      'request-refund': s(1, 40, 160, 0.001),
      'refund-payment': s(1, 260, 1200, 0.006, 0.012),
      'post-refund': s(0.97, 13, 110, 0.002, 0.004),
    },
    transitions: { refund: 1, issued: 0.97, rejected: 0.03, posted: 0.97 },
  },
};

/** Example statistics for a flow and window; null for flows without example data. */
export function exampleFlowStats(flowId: string, window: TransitWindow): FlowStats | null {
  const base = STATS[flowId];
  if (!base) return null;
  const { weekly, ...rest } = base;
  return { ...structuredClone(rest), window, isExample: true, transactions: Math.round(weekly * WINDOW_FRACTION[window]) };
}

// ---------------------------------------------------------------------------------------------
// Example transactions
// ---------------------------------------------------------------------------------------------

/** One visit in a scenario: a step, how long it took, and what happened on the way in. */
interface Visit {
  step: string;
  via?: string;
  ms: number;
  label?: string;
  status?: TxStep['status'];
  /** Failed attempts before the visit (retries of the incoming call). */
  attempts?: { label: string; ms: number }[];
  /** Redeliveries of the incoming event before the visit. */
  redeliveries?: number;
  deadLetter?: 'parked' | 'dropped';
  correlated?: false;
  /** Parallel branch: visits of one lane run in sequence; lanes started together run in parallel. */
  lane?: string;
  wait?: boolean;
}

/** Example payment traces by line, for drill-down from the step that line implements. */
function paymentTrace(lineId: string, pick: number): TxStep['trace'] | undefined {
  const traces = [...paymentServiceTraces().values()].filter((t) => t.summary.lineId === lineId);
  const trace = traces[pick % Math.max(1, traces.length)];
  return trace ? { serviceDefinitionId: 'payment-service', lineId, traceId: trace.summary.traceId } : undefined;
}
const LINE_OF_ENTRY: Record<string, string> = { Authorize: 'A1', Capture: 'A2', Refund: 'A3', Void: 'A4', 'POST /webhooks/processor': 'W1' };

function build(flow: BusinessFlow, key: string, ageMin: number, outcomeId: string, visits: Visit[], pick: number): FlowTransaction {
  const steps: TxStep[] = [];
  let t = 0;
  let display = 0;
  let retries = 0;
  // Parallel lanes: each lane has its own clock, all starting at the fork; they join at the next
  // visit without a lane (or at the end).
  let fork: { t: number; display: number } | null = null;
  const lanes = new Map<string, { t: number; display: number }>();
  const join = () => {
    if (lanes.size === 0) return;
    t = Math.max(...[...lanes.values()].map((c) => c.t));
    display = Math.max(...[...lanes.values()].map((c) => c.display));
    lanes.clear();
    fork = null;
  };
  for (const v of visits) {
    const step = flow.steps.find((x) => x.id === v.step);
    if (!step) continue;
    if (v.lane) {
      fork ??= { t, display };
      const clock = lanes.get(v.lane) ?? fork;
      t = clock.t;
      display = clock.display;
    } else join();
    const push = (label: string, ms: number, status: TxStep['status'], extra: Partial<TxStep> = {}) => {
      const displayMs = v.wait || ms > COMPRESSED_MS * 4 ? Math.min(ms, COMPRESSED_MS) : ms;
      steps.push({ stepId: step.id, ...(v.via ? { transitionId: v.via } : {}), label, startMs: t, durationMs: ms, displayStartMs: display, displayDurationMs: displayMs, status, correlated: v.correlated ?? true, ...(v.lane ? { parallel: v.lane } : {}), ...(step.kind === 'compensation' ? { compensation: true } : {}), ...extra });
      t += ms;
      display += displayMs;
    };
    v.attempts?.forEach((a, i) => {
      retries++;
      push(a.label, a.ms, 'warn', { attempt: i + 1 });
    });
    for (let r = 1; r <= (v.redeliveries ?? 0); r++) {
      retries++;
      push(`Redelivery ${r}: the consumer failed`, 400 * r, 'warn', { redelivery: r });
    }
    const entryLine = step.entryPoint ? LINE_OF_ENTRY[step.entryPoint] : undefined;
    const trace = step.serviceDefinitionId === 'payment-service' && entryLine ? paymentTrace(entryLine, pick) : undefined;
    push(v.label ?? `${step.name}${v.wait ? ' (waiting)' : ''}`, v.ms, v.status ?? 'ok', {
      ...(v.attempts?.length ? { attempt: v.attempts.length + 1 } : {}),
      ...(v.deadLetter ? { deadLetter: v.deadLetter } : {}),
      ...(trace ? { trace } : {}),
    });
    if (v.lane) lanes.set(v.lane, { t, display });
  }
  join();
  steps.sort((a, b) => a.displayStartMs - b.displayStartMs);
  const durationMs = Math.max(0, ...steps.map((x) => x.startMs + x.durationMs));
  const outcome = flow.outcomes.find((o) => o.id === outcomeId);
  return {
    key,
    flowId: flow.id,
    startedAt: new Date(Date.parse('2026-10-12T08:45:00Z') - ageMin * 60_000).toISOString(),
    outcomeId,
    outcomeKind: outcome?.kind ?? 'success',
    durationMs,
    retries,
    compensated: steps.some((x) => x.compensation),
    steps,
  };
}

const TYPICAL_CHECKOUT = (opts: { authorize?: Visit['attempts']; reserve?: Partial<Visit>; notify?: Partial<Visit>; ledger?: Partial<Visit>; settleMs?: number } = {}): Visit[] => [
  { step: 'place-order', ms: 46 },
  { step: 'reserve-stock', via: 'placed', ms: 38, ...opts.reserve },
  { step: 'authorize-payment', via: 'authorize', ms: 130, ...(opts.authorize ? { attempts: opts.authorize } : {}) },
  { step: 'capture-payment', via: 'approved', ms: 190 },
  { step: 'ship-order', via: 'captured', ms: 60, lane: 'ship' },
  { step: 'notify-customer', via: 'shipped', ms: 9, lane: 'ship', ...opts.notify },
  ...(opts.notify?.deadLetter ? [] : [{ step: 'send-email', via: 'notify', ms: 90, lane: 'ship' } satisfies Visit]),
  { step: 'await-settlement', via: 'settle', ms: opts.settleMs ?? 240_000, wait: true, label: 'Waiting for the processor’s settlement webhook', lane: 'settle' },
  { step: 'post-to-ledger', via: 'settled', ms: 13, lane: 'settle', ...opts.ledger },
];

const cache = new Map<string, FlowTransaction[]>();

/** Example business transactions of a flow, newest first (generated once per flow). Empty for flows without examples. */
export function exampleTransactions(flow: BusinessFlow): FlowTransaction[] {
  const cached = cache.get(flow.id);
  if (cached) return cached;
  const list = generateTransactions(flow);
  cache.set(flow.id, list);
  return list;
}

function generateTransactions(flow: BusinessFlow): FlowTransaction[] {
  if (flow.id === 'flow-checkout') {
    const checkout = flow;
    const timeout = (ms: number) => ({ label: `Attempt timed out after ${ms / 1000} s`, ms });
    return [
      build(checkout, 'order 4486', 2, 'completed', TYPICAL_CHECKOUT(), 0),
      build(checkout, 'order 4479', 9, 'completed', TYPICAL_CHECKOUT({ authorize: [timeout(3000), { label: 'Attempt failed: card processor refused the connection', ms: 40 }] }), 1),
      build(
        checkout,
        'order 4471',
        16,
        'order-cancelled',
        [
          { step: 'place-order', ms: 51 },
          { step: 'reserve-stock', via: 'placed', ms: 40 },
          { step: 'authorize-payment', via: 'authorize', ms: 210, label: 'Authorize payment: declined by the card processor', status: 'warn' },
          { step: 'cancel-order', via: 'declined', ms: 31 },
          { step: 'release-stock', via: 'cancelled', ms: 14 },
        ],
        2,
      ),
      build(
        checkout,
        'order 4466',
        23,
        'order-cancelled',
        [
          { step: 'place-order', ms: 44 },
          { step: 'reserve-stock', via: 'placed', ms: 37 },
          { step: 'authorize-payment', via: 'authorize', ms: 118 },
          { step: 'capture-payment', via: 'approved', ms: 205 },
          { step: 'await-settlement', via: 'settle', ms: 600_000, wait: true, status: 'fail', label: 'No settlement webhook within 10 min' },
          { step: 'cancel-order', via: 'not-settled', ms: 35 },
          { step: 'release-stock', via: 'cancelled', ms: 15, lane: 'release' },
          { step: 'void-authorization', via: 'void', ms: 160, lane: 'void', label: 'Void authorization (the capture itself is not undone)', status: 'warn' },
        ],
        3,
      ),
      build(checkout, 'order 4458', 30, 'completed', TYPICAL_CHECKOUT({ notify: { redeliveries: 5, status: 'fail', deadLetter: 'dropped', label: 'Dropped after 5 deliveries: no dead-letter queue, the customer is not notified' } }), 4),
      build(checkout, 'order 4450', 37, 'completed', TYPICAL_CHECKOUT({ ledger: { correlated: false, label: 'Post to ledger (not correlated: no trace carries the order key here)' } }), 5),
      build(checkout, 'order 4443', 44, 'completed', TYPICAL_CHECKOUT({ reserve: { redeliveries: 2, ms: 52 }, settleMs: 532_000 }), 0),
      build(checkout, 'order 4437', 51, 'completed', TYPICAL_CHECKOUT({ settleMs: 251_000 }), 1),
    ];
  }
  if (flow.id === 'flow-refund') {
    const refund = flow;
    return [
      build(refund, 'refund 1203', 4, 'refunded', [{ step: 'request-refund', ms: 41 }, { step: 'refund-payment', via: 'refund', ms: 270 }, { step: 'post-refund', via: 'issued', ms: 13 }], 0),
      build(refund, 'refund 1199', 12, 'refund-rejected', [{ step: 'request-refund', ms: 38 }, { step: 'refund-payment', via: 'refund', ms: 240, status: 'warn', label: 'Refund payment: processor declined' }], 1),
      build(
        refund,
        'refund 1195',
        20,
        'refunded',
        [
          { step: 'request-refund', ms: 40 },
          { step: 'refund-payment', via: 'refund', ms: 290, attempts: [{ label: 'Attempt timed out after 5 s', ms: 5000 }] },
          { step: 'post-refund', via: 'issued', ms: 14, redeliveries: 1 },
        ],
        2,
      ),
    ];
  }
  return [];
}
