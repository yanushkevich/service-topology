/**
 * The pattern catalog (ADR-024, docs/BUSINESS_FLOWS.md Revision 2 §11): the one source of pattern
 * IDs, labels, and descriptions for the service board (policies on client lanes, line patterns) and
 * business flows (policies on transitions). Policy types on both boards are subsets of these IDs.
 */

export type PatternCategory = 'call' | 'messaging' | 'process' | 'platform';

/** Where a pattern can be declared. */
export type PatternTarget = 'call-transition' | 'event-transition' | 'step' | 'line' | 'client';

export interface PatternInfo {
  label: string;
  category: PatternCategory;
  appliesTo: readonly PatternTarget[];
  /** One sentence: what the pattern guarantees. */
  description: string;
}

export const PATTERNS = {
  timeout: { label: 'Timeout', category: 'call', appliesTo: ['call-transition', 'client', 'line'], description: 'Stops waiting for a reply after a fixed time, so a slow dependency cannot hold the caller.' },
  retry: { label: 'Retry', category: 'call', appliesTo: ['call-transition', 'client', 'line'], description: 'Repeats a failed call a bounded number of times, with backoff between attempts.' },
  breaker: { label: 'Circuit breaker', category: 'call', appliesTo: ['call-transition', 'client', 'line'], description: 'Stops calling a failing dependency for a while, so failures fail fast instead of piling up.' },
  bulkhead: { label: 'Bulkhead', category: 'call', appliesTo: ['call-transition', 'client', 'line'], description: 'Caps concurrent calls to one dependency, so it cannot exhaust the threads or connections others need.' },
  fallback: { label: 'Fallback', category: 'call', appliesTo: ['client', 'line'], description: 'Answers with a degraded result when the dependency fails.' },
  cache: { label: 'Cache-aside', category: 'call', appliesTo: ['client', 'line'], description: 'Serves repeated reads from a cache filled on a miss, instead of calling the dependency every time.' },
  idempotency: { label: 'Idempotent receiver', category: 'call', appliesTo: ['call-transition', 'client', 'line'], description: 'The receiver keeps the result per caller-supplied key, so a repeated request returns the first result (idempotent receiver).' },
  'async-request-reply': {
    label: 'Async request-reply',
    category: 'call',
    appliesTo: ['call-transition'],
    description: 'The callee answers 202 Accepted with a status location, and the caller polls it until the work is done or its deadline passes.',
  },
  redelivery: { label: 'Redelivery', category: 'messaging', appliesTo: ['event-transition'], description: 'The broker delivers a message again when the consumer fails to acknowledge it.' },
  'dead-letter': { label: 'Dead-letter queue', category: 'messaging', appliesTo: ['event-transition'], description: 'Messages that keep failing are parked for inspection instead of being lost or blocking the queue.' },
  'idempotent-consumer': { label: 'Idempotent consumer', category: 'messaging', appliesTo: ['event-transition'], description: 'The consumer ignores a message it has already handled, by any deduplication means.' },
  inbox: {
    label: 'Inbox',
    category: 'messaging',
    appliesTo: ['event-transition'],
    description: 'The consumer records each received message in its own database in the same transaction as handling it, and drops duplicates.',
  },
  outbox: { label: 'Transactional outbox', category: 'messaging', appliesTo: ['event-transition', 'line'], description: 'The producer writes the message to an outbox table in the same transaction as its state change, so neither happens without the other.' },
  'polling-publisher': { label: 'Polling publisher', category: 'messaging', appliesTo: ['event-transition', 'line'], description: 'A relay polls the outbox table and publishes the messages it finds.' },
  'step-deadline': { label: 'Step deadline', category: 'process', appliesTo: ['step', 'call-transition', 'event-transition'], description: 'The step must finish within a set time, or the flow takes its timeout path.' },
  compensation: { label: 'Compensation', category: 'process', appliesTo: ['step', 'call-transition', 'event-transition'], description: 'A later step undoes this step’s effect when the flow cannot complete.' },
  'manual-intervention': { label: 'Manual intervention', category: 'process', appliesTo: ['step', 'call-transition', 'event-transition'], description: 'A person resolves the case when automation cannot.' },
  transaction: { label: 'Local transaction', category: 'platform', appliesTo: ['line'], description: 'The work commits or rolls back as one database transaction.' },
  mtls: { label: 'mTLS', category: 'platform', appliesTo: ['line'], description: 'Both sides authenticate with certificates and the connection is encrypted.' },
  'rate-limit': { label: 'Rate limit', category: 'platform', appliesTo: ['line'], description: 'Requests above an agreed rate are rejected before they reach the service.' },
  'hmac-signature': { label: 'HMAC signature', category: 'platform', appliesTo: ['line'], description: 'The sender signs each request with a shared secret, and the receiver rejects unsigned or altered ones.' },
  'idempotent-producer': { label: 'Idempotent producer', category: 'messaging', appliesTo: ['line'], description: 'The broker drops a message the producer sends twice, so a retried publish is not duplicated.' },
  'read-replica': { label: 'Read replica', category: 'platform', appliesTo: ['line'], description: 'Reads go to a copy of the database, which may lag slightly behind the primary.' },
  pagination: { label: 'Pagination', category: 'platform', appliesTo: ['line'], description: 'Large results are returned in bounded pages.' },
  saga: { label: 'Saga', category: 'process', appliesTo: ['line'], description: 'A multi-step change is kept consistent by local steps with compensations instead of one distributed transaction.' },
  'scheduled-job': { label: 'Scheduled job', category: 'process', appliesTo: ['line'], description: 'The work runs on a schedule rather than on a request.' },
  'leader-lock': { label: 'Leader lock', category: 'platform', appliesTo: ['line'], description: 'Only the instance holding a lock runs the job, so it never runs twice at once.' },
} as const satisfies Record<string, PatternInfo>;

export type PatternId = keyof typeof PATTERNS;

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

export function isPatternId(value: string): value is PatternId {
  return Object.hasOwn(PATTERNS, value);
}

/** The catalog label, or the raw value for an ID the catalog does not know (e.g. newer data). */
export function patternLabel(id: string): string {
  return isPatternId(id) ? PATTERNS[id].label : id.replace(/-/g, ' ');
}

export function patternDescription(id: string): string | undefined {
  return isPatternId(id) ? PATTERNS[id].description : undefined;
}
