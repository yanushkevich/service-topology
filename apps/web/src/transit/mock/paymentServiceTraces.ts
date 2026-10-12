import { indexBoard, type BoardIndex } from '../board';
import type { Line, PolicyStop, TraceDetail, TraceStep, TraceSummary } from '../types';
import { paymentServiceBoard } from './paymentServiceBoard';

/**
 * Example traces for the Payment Service board, ported from the prototype's trace generator
 * (docs/design-references/payment-transit-board): deterministic, invented, labelled example data.
 * Each trace is already mapped to station and policy-stop ids, as `GET /traces/{id}/steps` would
 * return it. Beyond the prototype, the examples include an off-map span (W1), lost trace context
 * (E1), and a parallel fan-out (J2), so the replay's honest-limits rendering can be exercised.
 */

type Kind = 'ok' | 'slow' | 'fail' | 'fallback' | 'miss' | 'offmap' | 'gap';

/** Sample kinds per line, newest first (from the prototype, plus the three extra cases). */
const KINDS: Record<string, Kind[]> = {
  A1: ['fallback', 'fallback', 'ok', 'slow', 'fallback', 'fail'],
  A2: ['ok', 'ok', 'slow', 'ok', 'fail', 'ok'],
  A3: ['ok', 'slow', 'ok', 'fail', 'ok', 'ok'],
  A4: ['ok', 'ok', 'ok', 'slow', 'ok', 'fail'],
  A5: ['ok', 'ok', 'miss', 'ok', 'ok', 'miss'],
  A6: ['ok', 'ok', 'ok', 'ok', 'slow', 'ok'],
  W1: ['offmap', 'ok', 'slow', 'ok', 'ok', 'ok'],
  E1: ['ok', 'ok', 'ok', 'slow', 'ok', 'gap'],
  J1: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  J2: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  O1: [],
};

/** Example "now" the sample ages are counted from. */
const NOW = Date.parse('2026-10-12T08:45:00Z');

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function generate(index: BoardIndex, line: Line, kind: Kind, ix: number): TraceDetail {
  const rnd = random(7 + ix * 31 + line.code.charCodeAt(0) * 7 + line.code.charCodeAt(1));
  const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');
  const jitter = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const steps: TraceStep[] = [];
  let t = 0;
  let failed = false;
  let gaveUp = false;
  let retries = 0;
  const entry = line.route[0]?.stations[0] ?? '';
  const name = (id: string) => index.stations.get(id)?.name ?? id;
  /** ReconcileSettlements calls the card processor and the ledger at the same time. */
  const fanOut = line.id === 'J2' && line.route.length > 1;

  const add = (at: string, label: string, durationMs: number, status: TraceStep['status'] = 'ok', extra: Partial<TraceStep> = {}) => {
    steps.push({ at, label, startMs: t, durationMs, status, spanId: hex(16), ...extra });
    t += durationMs;
    if (line.deadlineMs && !gaveUp && !failed && t > line.deadlineMs) {
      gaveUp = true;
      steps.push({ at: entry, label: `${line.caller} stops waiting at the ${line.deadlineMs / 1000} s deadline`, startMs: t, durationMs: 0, status: 'fail', spanId: hex(16) });
    }
  };
  const stop = (clientId: string, type: PolicyStop['type']) => index.policiesByClient.get(clientId)?.find((p) => p.type === type);

  /** One client lane: its policies, then the dependency (with this kind's retries, fallbacks, failures). */
  const lane = (clientId: string, depId: string, extra: Partial<TraceStep> = {}) => {
    add(clientId, `${name(clientId)} takes the call`, 1, 'ok', extra);
    const retry = stop(clientId, 'retry');
    const peer = { 'peer.service': name(depId) };
    if (clientId === 'cli:card' && (kind === 'slow' || kind === 'fail') && retry) {
      const attempts = kind === 'slow' ? 2 : 4;
      for (let a = 1; a <= attempts; a++) {
        retries += a > 1 ? 1 : 0;
        add(depId, `Attempt ${a}: ${kind === 'slow' ? 'no reply, timed out after 2 s' : 'connection refused'}`, kind === 'slow' ? 2000 : 40, 'warn', { ...extra, attempt: a, attributes: { ...peer, 'error.type': kind === 'slow' ? 'timeout' : 'ECONNREFUSED' } });
        if (a < attempts || kind === 'slow') add(retry.id, `Backoff ${[200, 400, 800][a - 1] ?? 800} ms`, [200, 400, 800][a - 1] ?? 800, 'warn', extra);
      }
      if (kind === 'fail') {
        add(stop(clientId, 'breaker')?.id ?? clientId, 'Gave up after 4 attempts; the breaker counts a failure', 0, 'fail', extra);
        failed = true;
        return;
      }
      retries += 1;
      add(depId, 'Attempt 3 succeeds', jitter(170, 220), 'ok', { ...extra, attempt: 3, attributes: peer });
      return;
    }
    if (clientId === 'cli:fraud' && kind === 'fallback' && retry) {
      retries += 1;
      add(depId, 'Attempt 1: timed out after 300 ms', 300, 'warn', { attempt: 1, attributes: { ...peer, 'error.type': 'timeout' } });
      add(retry.id, 'Backoff 50 ms', 50, 'warn');
      add(depId, 'Attempt 2: timed out after 300 ms', 300, 'warn', { attempt: 2, attributes: { ...peer, 'error.type': 'timeout' } });
      add(stop(clientId, 'breaker')?.id ?? clientId, 'No breaker, so both timeouts were paid in full', 0, 'warn');
      add(depId, 'Fallback: approve and flag for review', 1, 'warn', { attributes: { 'fallback.reason': 'timeout' } });
      return;
    }
    if (clientId === 'cli:ledger' && kind === 'slow' && retry) {
      retries += 1;
      add(depId, 'Attempt 1: no reply within 800 ms', 800, 'warn', { attempt: 1, attributes: { ...peer, 'error.type': 'timeout' } });
      add(retry.id, 'Backoff 100 ms', 100, 'warn');
      add(stop(clientId, 'idempotency')?.id ?? clientId, 'Attempt 2 sent without an idempotency key', 1, 'warn');
      add(depId, `${name(depId)} answers`, jitter(30, 60), 'ok', { attempt: 2, attributes: peer });
      return;
    }
    if (clientId === 'cli:cache') {
      const fallback = stop(clientId, 'fallback');
      if (fallback) add(fallback.id, kind === 'miss' ? 'Cache miss: read the replica' : 'Cache hit', 0, kind === 'miss' ? 'warn' : 'ok');
      if (kind !== 'miss') add(depId, `${name(depId)} answers`, jitter(1, 2), 'ok', { attributes: peer });
      return;
    }
    const dep = index.stations.get(depId)?.stats;
    add(depId, `${name(depId)} answers`, jitter(dep?.p50Ms ?? 2, dep?.p95Ms ?? 10), 'ok', { ...extra, attributes: peer });
  };

  const runBranch = (branch: number, extra: Partial<TraceStep> = {}) => {
    const ids = line.route[branch]?.stations ?? [];
    for (let i = branch === 0 ? 0 : 1; i < ids.length && !failed; i++) {
      const id = ids[i] ?? '';
      const kindOf = index.stations.get(id)?.kind;
      if (kindOf === 'caller') add(id, `${name(id)} ${line.group === 'scheduled' ? 'fires' : 'calls'} ${line.name}`, 0);
      else if (kindOf === 'gate') {
        const label = id === 'gate:grpc' ? 'mTLS ok · rate ok · new idempotency key' : id === 'gate:webhook' ? 'HMAC signature ok' : id === 'gate:consumer' ? 'Consumer picks up the event' : 'Job starts';
        add(id, label, jitter(1, 3), 'ok', extra);
        if (kind === 'gap' && id === 'gate:consumer') {
          add(id, 'Context lost: the consumer did not continue the trace', 0, 'warn', { contextLost: true });
        }
      } else if (kindOf === 'module') {
        add(id, `${name(id)} module runs`, jitter(2, 5), 'ok', extra);
        if (kind === 'offmap') add('span:audit.write', 'Span "audit.write" is on no station of the map', 3, 'ok', { offMap: true, attributes: { 'span.name': 'audit.write' } });
      } else if (kindOf === 'client') {
        const dep = ids[i + 1] ?? '';
        if (fanOut && branch === 0) {
          // The module calls this lane and the second branch's lane in parallel: both start together.
          const fork = t;
          lane(id, dep, { parallel: 'fan-out' });
          const mainEnd = t;
          t = fork;
          runBranch(1, { parallel: 'fan-out' });
          t = Math.max(mainEnd, t);
        } else lane(id, dep, extra);
        i++; // the dependency was handled by the lane
      }
    }
  };

  runBranch(0);
  for (let b = fanOut ? 2 : 1; b < line.route.length && !failed; b++) {
    if (line.route[b]?.kind === 'alternative' && kind !== 'miss') continue;
    runBranch(b);
  }
  steps.sort((a, b) => a.startMs - b.startMs);
  add(entry, failed || gaveUp ? 'Error returned to the caller' : 'Response returned to the caller', 0, failed || gaveUp ? 'fail' : 'ok');

  const status: TraceSummary['status'] = failed || gaveUp ? 'failed' : kind === 'slow' || kind === 'fallback' ? 'slow' : 'ok';
  const summary: TraceSummary = {
    traceId: `${line.code.toLowerCase()}${hex(14)}`,
    businessKey: line.group === 'scheduled' ? `run ${14 - ix}:${ix % 2 ? '30' : '45'}` : line.group === 'event' ? `event ${7700 + ix * 13}` : `order ${4400 + Math.floor(rnd() * 99)}`,
    startedAt: new Date(NOW - (2 + ix * 7) * 60_000).toISOString(),
    durationMs: t,
    status,
    lineId: line.id,
    retries,
  };
  return { summary, steps };
}

let cache: Map<string, TraceDetail> | null = null;

/** All example traces, by trace id (generated once). */
export function paymentServiceTraces(): Map<string, TraceDetail> {
  if (cache) return cache;
  const index = indexBoard(paymentServiceBoard('production'));
  cache = new Map();
  for (const line of index.lines) {
    (KINDS[line.id] ?? []).forEach((kind, ix) => {
      const trace = generate(index, line, kind, ix);
      cache?.set(trace.summary.traceId, trace);
    });
  }
  return cache;
}
