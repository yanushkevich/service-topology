/**
 * Transit board read model (docs/TRANSIT_BOARD.md "Data model", ADR-021). It describes the inside
 * of ONE service and is deliberately separate from the canonical topology (src/domain): the only
 * link is the service definition the board belongs to.
 */

import type { PatternId } from '../domain/patterns';

export type ProvenanceKind = 'declared' | 'observed' | 'inferred';

export interface Provenance {
  kind: ProvenanceKind;
  /** e.g. 'payments.proto', '41,208 traces', 'code scan' */
  detail: string;
  /** 0..1 share of requests */
  coverage?: number;
}

export type StationKind = 'caller' | 'gate' | 'module' | 'client' | 'dependency';

export interface Station {
  /** Stable, e.g. 'mod:Capture', 'cli:card', 'dep:card-processor'. */
  id: string;
  name: string;
  sub?: string;
  kind: StationKind;
  provenance: Provenance;
  /** Dependencies: the canonical topology entity (service definition or resource ID), ADR-027. */
  entityId?: string;
  status?: 'ok' | 'degraded' | 'down';
  /** Dependencies only. */
  stats?: { p50Ms: number; p95Ms: number; errorRate: number };
  /** Where the map label goes; defaults by kind (dependencies right, others above). */
  labelHint?: 'above' | 'below' | 'right';
}

/** Policies on the service board's client lanes: a subset of the pattern catalog (ADR-024). */
export const POLICY_TYPES = ['bulkhead', 'timeout', 'retry', 'breaker', 'fallback', 'cache', 'idempotency'] as const satisfies readonly PatternId[];
export type PolicyType = (typeof POLICY_TYPES)[number];

/**
 * How a policy renders (spec "Policies on the line" and the missing/unknown rule):
 * exercised = declared and observed (solid), idle = declared, never exercised (outline),
 * missing = config read and the expected policy is absent (dashed amber),
 * unknown = the config source could not be read (grey question mark).
 * The spec's `type: 'missing'` is expressed as `state: 'missing'` so the absent policy keeps its type.
 */
export type PolicyState = 'exercised' | 'idle' | 'missing' | 'unknown';

export interface PolicyStop {
  id: string;
  /** The client lane it sits on. */
  clientId: string;
  /** Position along the lane, 0 = first. */
  order: number;
  type: PolicyType;
  state: PolicyState;
  /** 'retry ×3', '2 s', 'no breaker' */
  label: string;
  /** Known keys: timeoutMs, maxAttempts, backoffMs, limit. */
  config?: Record<string, string>;
  /** 'fires on 3.1%', 'peak 14 / 20' */
  stat?: string;
  /** Config file or key the policy was read from. */
  source?: string;
  provenance: Provenance;
}

export type LineGroup = 'grpc' | 'http' | 'webhook' | 'event' | 'scheduled' | 'background';

export interface Branch {
  /** Ordered station ids. A branch after the first starts at the module it forks from. */
  stations: string[];
  /** alternative = only on some requests */
  kind: 'sequential' | 'alternative';
  /** 0.06 = 6% of requests take it */
  share?: number;
}

export interface Finding {
  severity: 'warn' | 'ok' | 'info';
  text: string;
  stationIds: string[];
  ruleId?: string;
  fix?: string;
}

/** Typical-mode stats of one step (station) on a line (spec "Per-step stats"). */
export interface StepStats {
  /** Share of the line's traces that visit the step, 0..1. */
  share: number;
  p50Ms: number;
  p99Ms: number;
  errorRate: number;
  retryRate: number;
}

export interface Line {
  id: string;
  /** 'A2' */
  code: string;
  name: string;
  group: LineGroup;
  /** 'rpc Capture(CaptureRequest) returns (Payment)' */
  signature: string;
  caller: string;
  deadlineMs?: number;
  stats: { p50Ms: number; p95Ms: number; errorRate: number; callsPerDay: number; traces: number };
  /** First = main path; others fork from a module. */
  route: Branch[];
  /** Pattern catalog IDs shown on the line card. */
  patterns: PatternId[];
  findings: Finding[];
  provenance: { entry: Provenance; route: Provenance };
  /** Per-step stats keyed by station id (typical mode). */
  stepStats?: Record<string, StepStats>;
}

export interface SourceStatus {
  id: 'specs' | 'scheduler' | 'traces' | 'resilience' | 'code-scan';
  label: string;
  status: 'ok' | 'failed';
}

/** Aggregation window of typical mode (spec: default 24h, selectable 1h, 24h, 7d). */
export type TransitWindow = '1h' | '24h' | '7d';

/**
 * A table of a database dependency (ADR-027): where a line's conversation with the database
 * happens, and which pattern it serves. Writers and readers must reach the table's station.
 */
export interface DataTable {
  id: string;
  /** The database dependency station that holds it. */
  stationId: string;
  name: string;
  /** The pattern the table serves; absent for plain state. */
  pattern?: Extract<PatternId, 'outbox' | 'inbox'>;
  /** Line IDs. */
  writes: string[];
  reads: string[];
}

export interface TransitBoard {
  serviceDefinitionId: string;
  environmentId: string;
  window: TransitWindow;
  /** True for example data: never presented as observed. */
  isExample: boolean;
  sources: SourceStatus[];
  stations: Station[];
  policies: PolicyStop[];
  lines: Line[];
  /** Tables of the database dependencies; absent when none are known. */
  tables?: DataTable[];
}

export interface TraceSummary {
  traceId: string;
  businessKey?: string;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'slow' | 'failed';
  /** The line (root operation) the trace belongs to. */
  lineId: string;
  /** Number of retried calls in the trace (for "one with retries"). */
  retries: number;
}

export interface TraceStep {
  /** Station id or policy stop id; an off-map step names the span instead. */
  at: string;
  label: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'warn' | 'fail';
  spanId: string;
  /** Retry attempt number on the same station. */
  attempt?: number;
  /** A span that maps to no known station (spec "From spans to steps"). */
  offMap?: boolean;
  /** Trace context was lost here (spec "Limits shown honestly"): drawn as a gap. */
  contextLost?: boolean;
  /** Steps with the same value ran in parallel (fan-out). */
  parallel?: string;
  /** Key span attributes shown for the active step. */
  attributes?: Record<string, string>;
}

/** A trace already mapped to station ids (spec `GET /traces/{traceId}/steps`). */
export interface TraceDetail {
  summary: TraceSummary;
  steps: TraceStep[];
}
