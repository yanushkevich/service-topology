import type { DataTable, Line, PolicyStop, Station, TransitBoard, TransitWindow } from '../types';

/**
 * Example data from the Payment Service Transit Board prototype
 * (docs/design-references/payment-transit-board), converted to the spec's types.
 * Invented data: every board built from it has `isExample: true` and is labelled so in the UI.
 */

const obs = (detail = 'traces') => ({ kind: 'observed', detail }) as const;
const decl = (detail: string) => ({ kind: 'declared', detail }) as const;
const inf = (detail = 'code scan') => ({ kind: 'inferred', detail }) as const;

const stations: Station[] = [
  { id: 'caller:order-service', name: 'Order Service', sub: 'caller', kind: 'caller', provenance: obs() },
  { id: 'caller:admin-console', name: 'Admin Console', sub: 'caller', kind: 'caller', provenance: obs() },
  { id: 'caller:orders-events', name: 'orders.events', sub: 'topic', kind: 'caller', provenance: decl('asyncapi.yaml') },
  { id: 'caller:card-processor', name: 'Card Processor', sub: 'webhooks', kind: 'caller', provenance: obs(), labelHint: 'below' },
  { id: 'gate:grpc', name: 'gRPC ingress', sub: 'mTLS · rate · idem', kind: 'gate', provenance: decl('payments.proto') },
  { id: 'gate:consumer', name: 'Consumer', sub: 'orders-cg', kind: 'gate', provenance: decl('asyncapi.yaml'), labelHint: 'below' },
  { id: 'gate:webhook', name: 'Webhook gate', sub: 'HMAC', kind: 'gate', provenance: decl('openapi.yaml'), labelHint: 'below' },
  { id: 'gate:scheduler', name: 'Scheduler', sub: 'in-process', kind: 'gate', provenance: decl('scheduler.go'), labelHint: 'below' },
  { id: 'mod:authorize', name: 'Authorize', kind: 'module', provenance: obs() },
  { id: 'mod:capture', name: 'Capture', sub: 'tx', kind: 'module', provenance: obs() },
  { id: 'mod:refund', name: 'Refund', kind: 'module', provenance: obs() },
  { id: 'mod:query', name: 'Query', sub: 'read model', kind: 'module', provenance: inf() },
  { id: 'mod:void', name: 'Void', kind: 'module', provenance: obs() },
  { id: 'mod:saga', name: 'PaymentSaga', kind: 'module', provenance: inf() },
  { id: 'mod:expire', name: 'Expire auths', sub: '*/15', kind: 'module', provenance: obs() },
  { id: 'mod:reconcile', name: 'Reconcile', sub: '02:15', kind: 'module', provenance: obs(), labelHint: 'below' },
  { id: 'mod:outbox', name: 'OutboxRelay', sub: 'worker', kind: 'module', provenance: inf(), labelHint: 'below' },
  { id: 'cli:fraud', name: 'fraud client', sub: 'gRPC', kind: 'client', provenance: obs() },
  { id: 'cli:card', name: 'card client', sub: 'HTTPS', kind: 'client', provenance: obs() },
  { id: 'cli:ledger', name: 'ledger client', sub: 'gRPC', kind: 'client', provenance: obs() },
  { id: 'cli:pg', name: 'pg pool', sub: 'SQL', kind: 'client', provenance: obs() },
  { id: 'cli:cache', name: 'cache client', sub: 'RESP', kind: 'client', provenance: obs() },
  { id: 'cli:replica', name: 'replica pool', sub: 'SQL', kind: 'client', provenance: obs() },
  { id: 'cli:producer', name: 'producer', sub: 'Kafka', kind: 'client', provenance: obs() },
  { id: 'dep:fraud', name: 'Fraud Scoring', sub: 'degraded', kind: 'dependency', entityId: 'fraud-scoring', provenance: obs(), status: 'degraded', stats: { p50Ms: 41, p95Ms: 310, errorRate: 0.011 } },
  { id: 'dep:card', name: 'Card Processor', sub: 'external', kind: 'dependency', entityId: 'ext-card-processor', provenance: obs(), status: 'ok', stats: { p50Ms: 180, p95Ms: 420, errorRate: 0.004 } },
  { id: 'dep:ledger', name: 'Ledger', sub: 'service', kind: 'dependency', entityId: 'ledger-service', provenance: obs(), status: 'ok', stats: { p50Ms: 28, p95Ms: 60, errorRate: 0.002 } },
  { id: 'dep:pg', name: 'payments-pg', sub: 'primary', kind: 'dependency', entityId: 'pg-payments-prod', provenance: obs(), status: 'ok', stats: { p50Ms: 4, p95Ms: 9, errorRate: 0 } },
  { id: 'dep:redis', name: 'Redis', sub: 'cache', kind: 'dependency', provenance: obs(), status: 'ok', stats: { p50Ms: 1, p95Ms: 2, errorRate: 0 } },
  { id: 'dep:replica', name: 'payments-pg', sub: 'replica', kind: 'dependency', entityId: 'pg-payments-prod', provenance: obs(), status: 'ok', stats: { p50Ms: 7, p95Ms: 18, errorRate: 0 } },
  { id: 'dep:kafka', name: 'payments.events', sub: 'topic', kind: 'dependency', entityId: 'topic-payments-events-prod', provenance: obs(), status: 'ok', stats: { p50Ms: 9, p95Ms: 25, errorRate: 0 } },
];

const RES = 'resilience.yaml';
const policy = (
  clientId: string,
  order: number,
  type: PolicyStop['type'],
  state: PolicyStop['state'],
  label: string,
  stat: string,
  config?: Record<string, string>,
): PolicyStop => ({
  id: `pol:${clientId.slice(4)}:${order}`,
  clientId,
  order,
  type,
  state,
  label,
  stat,
  ...(config ? { config } : {}),
  source: state === 'missing' ? `${RES} (expected-policy rule)` : `${RES} · ${clientId.slice(4)}`,
  provenance: state === 'missing' ? decl('expected-policy rule') : decl(RES),
});

const policies: PolicyStop[] = [
  policy('cli:fraud', 0, 'timeout', 'exercised', '300 ms', 'hit by 31%', { timeoutMs: '300' }),
  policy('cli:fraud', 1, 'retry', 'exercised', 'retry ×1', 'fires on 29%', { maxAttempts: '2', backoffMs: '50' }),
  policy('cli:fraud', 2, 'breaker', 'missing', 'no breaker', 'expected here'),
  policy('cli:card', 0, 'bulkhead', 'exercised', 'bulkhead 20', 'peak 14 / 20', { limit: '20' }),
  policy('cli:card', 1, 'timeout', 'exercised', '2 s', 'hit by 0.8%', { timeoutMs: '2000' }),
  policy('cli:card', 2, 'retry', 'exercised', 'retry ×3', 'fires on 3.1%', { maxAttempts: '4', backoffMs: '200' }),
  policy('cli:card', 3, 'breaker', 'idle', 'breaker', '0 trips · 24 h'),
  policy('cli:ledger', 0, 'timeout', 'exercised', '800 ms', 'hit by 1.4%', { timeoutMs: '800' }),
  policy('cli:ledger', 1, 'retry', 'exercised', 'retry ×2', 'fires on 1.2%', { maxAttempts: '3', backoffMs: '100' }),
  policy('cli:ledger', 2, 'idempotency', 'missing', 'no idem key', 'expected here'),
  policy('cli:pg', 0, 'bulkhead', 'exercised', 'pool 40', 'peak 31 / 40', { limit: '40' }),
  policy('cli:pg', 1, 'timeout', 'exercised', '5 s', 'hit by 0.01%', { timeoutMs: '5000' }),
  policy('cli:cache', 0, 'timeout', 'exercised', '50 ms', 'hit by 0.2%', { timeoutMs: '50' }),
  policy('cli:cache', 1, 'fallback', 'exercised', 'miss → replica', '6% of reads'),
  policy('cli:replica', 0, 'bulkhead', 'exercised', 'pool 20', 'peak 9 / 20', { limit: '20' }),
  policy('cli:replica', 1, 'timeout', 'idle', '2 s', 'hit by 0%', { timeoutMs: '2000' }),
  policy('cli:producer', 0, 'retry', 'exercised', 'retry ∞', 'fires on 0.02%'),
  policy('cli:producer', 1, 'timeout', 'idle', '120 s', 'never hit', { timeoutMs: '120000' }),
];

const stats = (p50Ms: number, p95Ms: number, errorRate: number, callsPerDay: number, traces: number) => ({ p50Ms, p95Ms, errorRate, callsPerDay, traces });
const seq = (...stationIds: string[]) => ({ stations: stationIds, kind: 'sequential' }) as const;
const entry = (file: string) => ({ entry: decl(file), route: obs() });

const lines: Line[] = [
  {
    id: 'A1', code: 'A1', name: 'Authorize', group: 'grpc', signature: 'rpc Authorize(AuthorizeRequest) returns (Authorization)', caller: 'Order Service', deadlineMs: 3000,
    stats: stats(120, 310, 0.004, 182_000, 38_410),
    route: [seq('caller:order-service', 'gate:grpc', 'mod:authorize', 'cli:fraud', 'dep:fraud'), seq('mod:authorize', 'cli:card', 'dep:card')],
    patterns: ['mtls', 'rate-limit', 'idempotency', 'timeout', 'retry', 'fallback', 'bulkhead', 'breaker'],
    findings: [
      { severity: 'warn', text: 'Fraud Scoring is degraded and the fraud client has no breaker', stationIds: ['cli:fraud', 'dep:fraud'], ruleId: 'breaker-on-degraded-dependency', fix: 'Add a circuit breaker on the fraud client.' },
      { severity: 'warn', text: 'Card retries can run past the 3 s deadline', stationIds: ['cli:card'], ruleId: 'timeout-budget', fix: 'Lower the card timeout or the retry count.' },
    ],
    provenance: entry('payments.proto'),
  },
  {
    id: 'A2', code: 'A2', name: 'Capture', group: 'grpc', signature: 'rpc Capture(CaptureRequest) returns (Payment)', caller: 'Order Service', deadlineMs: 3000,
    stats: stats(190, 240, 0.003, 176_000, 41_208),
    route: [seq('caller:order-service', 'gate:grpc', 'mod:capture', 'cli:card', 'dep:card'), seq('mod:capture', 'cli:pg', 'dep:pg')],
    patterns: ['mtls', 'idempotency', 'transaction', 'outbox', 'bulkhead', 'timeout', 'retry', 'breaker'],
    findings: [
      { severity: 'warn', text: 'Card retries can run past the 3 s deadline', stationIds: ['cli:card'], ruleId: 'timeout-budget' },
      { severity: 'warn', text: 'Order Service also retries Capture: up to 12 processor calls per checkout', stationIds: ['caller:order-service', 'cli:card'], ruleId: 'retry-amplification' },
      { severity: 'ok', text: 'PaymentCaptured is written through the outbox', stationIds: ['mod:capture'] },
    ],
    provenance: entry('payments.proto'),
  },
  {
    id: 'A3', code: 'A3', name: 'Refund', group: 'grpc', signature: 'rpc Refund(RefundRequest) returns (Refund)', caller: 'Order Service', deadlineMs: 5000,
    stats: stats(260, 420, 0.006, 9_400, 2_190),
    route: [seq('caller:order-service', 'gate:grpc', 'mod:refund', 'cli:card', 'dep:card'), seq('mod:refund', 'cli:ledger', 'dep:ledger')],
    patterns: ['idempotency', 'timeout', 'retry'],
    findings: [{ severity: 'warn', text: 'Ledger calls are retried without an idempotency key', stationIds: ['cli:ledger'], ruleId: 'retry-without-idempotency' }],
    provenance: entry('payments.proto'),
  },
  {
    id: 'A4', code: 'A4', name: 'Void', group: 'grpc', signature: 'rpc Void(VoidRequest) returns (Payment)', caller: 'Order Service', deadlineMs: 3000,
    stats: stats(150, 190, 0.002, 21_000, 4_870),
    route: [seq('caller:order-service', 'gate:grpc', 'mod:void', 'cli:card', 'dep:card')],
    patterns: ['idempotency', 'retry', 'breaker'],
    findings: [],
    provenance: entry('payments.proto'),
  },
  {
    id: 'A5', code: 'A5', name: 'GetPayment', group: 'grpc', signature: 'rpc GetPayment(GetPaymentRequest) returns (Payment)', caller: 'Order Service', deadlineMs: 500,
    stats: stats(2, 9, 0.0001, 2_300_000, 503_100),
    route: [seq('caller:order-service', 'gate:grpc', 'mod:query', 'cli:cache', 'dep:redis'), { stations: ['mod:query', 'cli:replica', 'dep:replica'], kind: 'alternative', share: 0.06 }],
    patterns: ['cache', 'read-replica', 'timeout'],
    findings: [
      { severity: 'ok', text: '94% of reads come from the cache; misses go to the replica', stationIds: ['cli:cache'] },
      { severity: 'info', text: 'Query module is inferred from a code scan, not from spans', stationIds: ['mod:query'] },
    ],
    provenance: entry('payments.proto'),
  },
  {
    id: 'A6', code: 'A6', name: 'ListPayments', group: 'grpc', signature: 'rpc ListPayments(ListRequest) returns (PaymentPage)', caller: 'Admin Console', deadlineMs: 2000,
    stats: stats(35, 80, 0, 4_100, 960),
    route: [seq('caller:admin-console', 'gate:grpc', 'mod:query', 'cli:replica', 'dep:replica')],
    patterns: ['read-replica', 'pagination'],
    findings: [],
    provenance: entry('payments.proto'),
  },
  {
    id: 'W1', code: 'W1', name: 'POST /webhooks/processor', group: 'webhook', signature: 'POST /webhooks/processor', caller: 'Card Processor', deadlineMs: 10_000,
    stats: stats(38, 60, 0.001, 190_000, 44_020),
    route: [seq('caller:card-processor', 'gate:webhook', 'mod:saga', 'cli:ledger', 'dep:ledger'), seq('mod:saga', 'cli:pg', 'dep:pg')],
    patterns: ['hmac-signature', 'inbox', 'saga', 'outbox', 'retry'],
    findings: [
      { severity: 'warn', text: 'Ledger calls are retried without an idempotency key', stationIds: ['cli:ledger'], ruleId: 'retry-without-idempotency' },
      { severity: 'info', text: 'PaymentSaga is inferred from a code scan, not from spans', stationIds: ['mod:saga'] },
    ],
    provenance: entry('openapi.yaml'),
  },
  {
    id: 'E1', code: 'E1', name: 'OrderCancelled', group: 'event', signature: 'consume orders.events · OrderCancelled', caller: 'orders.events',
    stats: stats(170, 210, 0.002, 18_000, 4_110),
    route: [seq('caller:orders-events', 'gate:consumer', 'mod:void', 'cli:card', 'dep:card')],
    patterns: ['idempotent-consumer', 'retry', 'dead-letter'],
    findings: [],
    provenance: entry('asyncapi.yaml'),
  },
  {
    id: 'J1', code: 'J1', name: 'ExpireAuthorizations', group: 'scheduled', signature: 'cron */15 * * * *', caller: 'Scheduler',
    stats: stats(1_900, 2_100, 0, 96, 384),
    route: [seq('gate:scheduler', 'mod:expire', 'cli:pg', 'dep:pg'), seq('mod:expire', 'cli:card', 'dep:card')],
    patterns: ['scheduled-job'],
    findings: [{ severity: 'warn', text: 'Runs on all 4 replicas at once: there is no lock', stationIds: ['mod:expire'], ruleId: 'scheduled-job-lock' }],
    provenance: entry('scheduler.go'),
  },
  {
    id: 'J2', code: 'J2', name: 'ReconcileSettlements', group: 'scheduled', signature: 'cron 15 2 * * *', caller: 'Scheduler',
    stats: stats(360_000, 360_000, 0, 1, 7),
    route: [seq('gate:scheduler', 'mod:reconcile', 'cli:card', 'dep:card'), seq('mod:reconcile', 'cli:ledger', 'dep:ledger')],
    patterns: ['scheduled-job', 'leader-lock'],
    findings: [],
    provenance: entry('scheduler.go'),
  },
  {
    id: 'O1', code: 'O1', name: 'OutboxRelay', group: 'background', signature: 'poll payment_outbox every 200 ms', caller: 'itself',
    stats: stats(11, 15, 0, 0, 0),
    route: [seq('mod:outbox', 'cli:pg', 'dep:pg'), seq('mod:outbox', 'cli:producer', 'dep:kafka')],
    patterns: ['outbox', 'polling-publisher', 'idempotent-producer'],
    findings: [{ severity: 'info', text: 'Not observed in traces: the relay does not carry trace context, so this route comes from a code scan', stationIds: ['mod:outbox'] }],
    provenance: { entry: decl('relay.go'), route: inf() },
  },
];

/** Example p99 per dependency (the prototype gives p50/p95); Fraud Scoring is degraded. */
const DEP_P99: Record<string, number> = { 'dep:fraud': 1650, 'dep:card': 680, 'dep:ledger': 110, 'dep:pg': 16, 'dep:redis': 4, 'dep:replica': 30, 'dep:kafka': 45 };
/** Example share of calls retried per client (from the retry policies' fire rates). */
const RETRY_RATE: Record<string, number> = { 'cli:fraud': 0.29, 'cli:card': 0.031, 'cli:ledger': 0.012, 'cli:producer': 0.0002 };

function stepStats(line: Line): NonNullable<Line['stepStats']> {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const out: NonNullable<Line['stepStats']> = {};
  line.route.forEach((branch, b) => {
    const share = branch.kind === 'alternative' ? (branch.share ?? 0) : 1;
    branch.stations.forEach((id, i) => {
      if (b > 0 && i === 0) return; // the fork module belongs to the main branch
      const station = byId.get(id);
      if (!station) return;
      const lane = branch.stations.find((s) => s.startsWith('dep:')) ?? '';
      const dep = byId.get(station.kind === 'client' ? lane : id)?.stats;
      const depP99 = DEP_P99[station.kind === 'client' ? lane : id] ?? 0;
      switch (station.kind) {
        case 'caller':
          out[id] = { share, p50Ms: line.stats.p50Ms, p99Ms: Math.round(line.stats.p95Ms * 1.4), errorRate: line.stats.errorRate, retryRate: 0 };
          break;
        case 'gate':
          out[id] = { share, p50Ms: 1, p99Ms: 3, errorRate: 0, retryRate: 0 };
          break;
        case 'module':
          out[id] = { share, p50Ms: 3, p99Ms: 9, errorRate: 0, retryRate: 0 };
          break;
        case 'client':
          out[id] = { share, p50Ms: (dep?.p50Ms ?? 0) + 1, p99Ms: depP99 + 2, errorRate: dep?.errorRate ?? 0, retryRate: RETRY_RATE[id] ?? 0 };
          break;
        case 'dependency':
          out[id] = { share, p50Ms: dep?.p50Ms ?? 0, p99Ms: depP99, errorRate: dep?.errorRate ?? 0, retryRate: 0 };
          break;
      }
    });
  });
  return out;
}

/**
 * Tables of the example's databases (ADR-027): where Capture and the processor webhook write the
 * outbox in their transaction, OutboxRelay polls it, and the webhook keeps an inbox because the
 * processor redelivers callbacks. Writers and readers reach the table's station (tested).
 */
const tables: DataTable[] = [
  { id: 'payments', stationId: 'dep:pg', name: 'payments', writes: ['A2', 'W1', 'J1'], reads: ['W1', 'J1'] },
  { id: 'payment_outbox', stationId: 'dep:pg', name: 'payment_outbox', pattern: 'outbox', writes: ['A2', 'W1'], reads: ['O1'] },
  { id: 'processed_webhooks', stationId: 'dep:pg', name: 'processed_webhooks', pattern: 'inbox', writes: ['W1'], reads: ['W1'] },
  { id: 'payments-replica', stationId: 'dep:replica', name: 'payments (read replica)', writes: [], reads: ['A5', 'A6'] },
];

/** Trace counts in the example are for 7 days; shorter windows see proportionally fewer. */
const WINDOW_FRACTION: Record<TransitWindow, number> = { '7d': 1, '24h': 1 / 7, '1h': 1 / 168 };

/** The example board for Payment Service in `environmentId` over `window` (only Payment Service has one). */
export function paymentServiceBoard(environmentId: string, window: TransitWindow = '24h'): TransitBoard {
  return {
    serviceDefinitionId: 'payment-service',
    environmentId,
    window,
    isExample: true,
    sources: [
      { id: 'specs', label: 'API specs', status: 'ok' },
      { id: 'scheduler', label: 'Scheduler config', status: 'ok' },
      { id: 'traces', label: 'Traces', status: 'ok' },
      { id: 'resilience', label: 'Resilience config', status: 'ok' },
      { id: 'code-scan', label: 'Code scan', status: 'ok' },
    ],
    stations: structuredClone(stations),
    policies: structuredClone(policies),
    lines: lines.map((line) => ({
      ...structuredClone(line),
      stats: { ...line.stats, traces: Math.round(line.stats.traces * WINDOW_FRACTION[window]) },
      stepStats: stepStats(line),
    })),
    tables: structuredClone(tables),
  };
}
