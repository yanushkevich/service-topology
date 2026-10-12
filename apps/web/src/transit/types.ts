/**
 * Transit board read model (docs/TRANSIT_BOARD.md "Data model", ADR-021). It describes the inside
 * of ONE service and is deliberately separate from the canonical topology (src/domain): the only
 * link is the service definition the board belongs to.
 */

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
  status?: 'ok' | 'degraded' | 'down';
  /** Dependencies only. */
  stats?: { p50Ms: number; p95Ms: number; errorRate: number };
  /** Where the map label goes; defaults by kind (dependencies right, others above). */
  labelHint?: 'above' | 'below' | 'right';
}

export type PolicyType = 'bulkhead' | 'timeout' | 'retry' | 'breaker' | 'fallback' | 'cache' | 'idempotency';

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
  patterns: string[];
  findings: Finding[];
  provenance: { entry: Provenance; route: Provenance };
}

export interface SourceStatus {
  id: 'specs' | 'scheduler' | 'traces' | 'resilience' | 'code-scan';
  label: string;
  status: 'ok' | 'failed';
}

export interface TransitBoard {
  serviceDefinitionId: string;
  environmentId: string;
  /** e.g. 'last 7 days' */
  window: string;
  /** True for example data: never presented as observed. */
  isExample: boolean;
  sources: SourceStatus[];
  stations: Station[];
  policies: PolicyStop[];
  lines: Line[];
}

export interface TraceSummary {
  traceId: string;
  businessKey?: string;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'slow' | 'failed';
}

export interface TraceStep {
  /** Station id or policy stop id. */
  at: string;
  label: string;
  startMs: number;
  durationMs: number;
  status: 'ok' | 'warn' | 'fail';
  spanId: string;
}
