import type { Line, LineGroup, PolicyStop, Station, StepStats, TransitBoard, TransitWindow } from './types';

/** Lookups derived once per board load. */
export interface BoardIndex {
  board: TransitBoard;
  stations: Map<string, Station>;
  /** Policy stops per client lane, in lane order. */
  policiesByClient: Map<string, PolicyStop[]>;
  /** Lines in the fixed global order (by line code): drawing order and bundle order. */
  lines: Line[];
  lineById: Map<string, Line>;
  /** Line ids passing through each station. */
  linesByStation: Map<string, string[]>;
  /** Precomputed lowercase search text per line (spec "Search"). */
  searchText: Map<string, string>;
}

export const GROUP_ORDER: readonly LineGroup[] = ['grpc', 'http', 'webhook', 'event', 'scheduled', 'background'];

export const GROUP_LABELS: Record<LineGroup, string> = {
  grpc: 'gRPC',
  http: 'HTTP',
  webhook: 'Webhooks',
  event: 'Events consumed',
  scheduled: 'Scheduled',
  background: 'Background',
};

/** Transport words the search matches (spec: grpc, https, kafka, cron). */
const TRANSPORT: Record<LineGroup, string> = {
  grpc: 'grpc',
  http: 'https http',
  webhook: 'https http webhook',
  event: 'kafka event',
  scheduled: 'cron scheduled',
  background: 'background',
};

export const byCode = (a: Line, b: Line) => a.code.localeCompare(b.code, 'en', { numeric: true });

/** Every station a line passes through, in route order, without repeats. */
export function lineStations(line: Line): string[] {
  const out: string[] = [];
  for (const branch of line.route) for (const id of branch.stations) if (!out.includes(id)) out.push(id);
  return out;
}

export function indexBoard(board: TransitBoard): BoardIndex {
  const stations = new Map(board.stations.map((s) => [s.id, s]));
  const policiesByClient = new Map<string, PolicyStop[]>();
  for (const p of board.policies) policiesByClient.set(p.clientId, [...(policiesByClient.get(p.clientId) ?? []), p]);
  for (const list of policiesByClient.values()) list.sort((a, b) => a.order - b.order);
  const lines = [...board.lines].sort(byCode);
  const linesByStation = new Map<string, string[]>();
  const searchText = new Map<string, string>();
  for (const line of lines) {
    const ids = lineStations(line);
    for (const id of ids) linesByStation.set(id, [...(linesByStation.get(id) ?? []), line.id]);
    const names = ids.map((id) => stations.get(id)?.name ?? id).join(' ');
    searchText.set(line.id, `${line.code} ${line.name} ${line.signature} ${line.caller} ${TRANSPORT[line.group]} ${names}`.toLowerCase());
  }
  return { board, stations, policiesByClient, lines, lineById: new Map(lines.map((l) => [l.id, l])), linesByStation, searchText };
}

/** Lines matching a search query (case-insensitive substring; empty query matches all). */
export function matchingLines(index: BoardIndex, query: string): Set<string> {
  const q = query.trim().toLowerCase();
  return new Set(index.lines.filter((l) => !q || (index.searchText.get(l.id) ?? '').includes(q)).map((l) => l.id));
}

export function dependenciesOf(index: BoardIndex, line: Line): Station[] {
  return lineStations(line)
    .map((id) => index.stations.get(id))
    .filter((s): s is Station => s?.kind === 'dependency');
}

/** A line with no traces in the window is drawn dashed and cannot be replayed. */
export const isUnobserved = (line: Line) => line.stats.traces === 0;

export const hasWarnings = (line: Line) => line.findings.some((f) => f.severity === 'warn');

// ---------------------------------------------------------------------------------------------
// Budget bar (spec "Budget bar")
// ---------------------------------------------------------------------------------------------

export interface BudgetSegment {
  clientId: string;
  name: string;
  timeoutMs: number;
  attempts: number;
  /** Worst case on this client: timeout × attempts. */
  ms: number;
}

export interface Budget {
  deadlineMs: number;
  segments: BudgetSegment[];
  totalMs: number;
  overflowMs: number;
}

const num = (value: string | undefined) => (value !== undefined && Number.isFinite(Number(value)) ? Number(value) : undefined);

/**
 * The endpoint's deadline with the downstream timeouts stacked in route order. Each client on the
 * line's sequential branches contributes its timeout × the retry policy's maxAttempts (1 without
 * a retry). Policies whose config is unknown or missing contribute nothing: unknown is not zero,
 * so the card says how many clients could not be counted. Null when the line has no deadline.
 */
export function budgetFor(index: BoardIndex, line: Line): (Budget & { uncounted: number }) | null {
  if (!line.deadlineMs) return null;
  const segments: BudgetSegment[] = [];
  let uncounted = 0;
  const seen = new Set<string>();
  for (const branch of line.route) {
    if (branch.kind !== 'sequential') continue;
    for (const id of branch.stations) {
      const station = index.stations.get(id);
      if (station?.kind !== 'client' || seen.has(id)) continue;
      seen.add(id);
      const stops = index.policiesByClient.get(id) ?? [];
      const known = stops.filter((p) => p.state !== 'unknown' && p.state !== 'missing');
      const timeoutMs = num(known.find((p) => p.type === 'timeout')?.config?.timeoutMs);
      if (timeoutMs === undefined) {
        if (stops.some((p) => p.state === 'unknown')) uncounted++;
        continue;
      }
      const attempts = num(known.find((p) => p.type === 'retry')?.config?.maxAttempts) ?? 1;
      segments.push({ clientId: id, name: station.name, timeoutMs, attempts, ms: timeoutMs * attempts });
    }
  }
  const totalMs = segments.reduce((sum, s) => sum + s.ms, 0);
  return { deadlineMs: line.deadlineMs, segments, totalMs, overflowMs: Math.max(0, totalMs - line.deadlineMs), uncounted };
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

export function formatMs(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms >= 1000) return `${Number((ms / 1000).toFixed(2))} s`;
  return `${Math.round(ms)} ms`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

export function formatRate(rate: number): string {
  const pct = rate * 100;
  return `${pct === 0 ? 0 : pct < 0.1 ? pct.toFixed(2) : Number(pct.toFixed(1))}%`;
}

// ---------------------------------------------------------------------------------------------
// Windows and per-step thresholds (spec "Typical route mode")
// ---------------------------------------------------------------------------------------------

export const WINDOWS: readonly TransitWindow[] = ['1h', '24h', '7d'];
export const DEFAULT_WINDOW: TransitWindow = '24h';
const WINDOW_LABELS: Record<TransitWindow, string> = { '1h': 'last hour', '24h': 'last 24 hours', '7d': 'last 7 days' };
export const windowLabel = (window: TransitWindow) => WINDOW_LABELS[window];
export const isWindow = (value: string | null): value is TransitWindow => value !== null && (WINDOWS as readonly string[]).includes(value);

/**
 * Tint thresholds for per-step stats. Config, not hard-coded rules: a step is "slow" when its p99
 * exceeds its share of the deadline (the deadline split evenly over the dependencies on the
 * typical route), and "failing" when its error rate is above `errorRate`.
 */
export const STEP_THRESHOLDS = { errorRate: 0.01 } as const;

export type StepTint = 'errors' | 'slow' | null;

export function stepTint(index: BoardIndex, line: Line, stationId: string, stats: StepStats, thresholds = STEP_THRESHOLDS): StepTint {
  if (stats.errorRate > thresholds.errorRate) return 'errors';
  if (!line.deadlineMs) return null;
  const deps = dependenciesOf(index, line).length || 1;
  return index.stations.get(stationId)?.kind === 'dependency' && stats.p99Ms > line.deadlineMs / deps ? 'slow' : null;
}

type Named = { id: string; name: string; signature: string };

/** A line by ID, or by name or signature (case-insensitive): flow steps link here by entry point. */
export function findLine<T extends Named>(lines: readonly T[], idOrName: string | null): T | null {
  if (!idOrName) return null;
  return lines.find((l) => l.id === idOrName) ?? lineNamed(lines, idOrName);
}

/** The line whose name or signature equals `name`, ignoring case (the step ↔ line rule, ADR-023). */
export function lineNamed<T extends Named>(lines: readonly T[], name: string): T | null {
  const wanted = name.toLowerCase();
  return lines.find((l) => l.name.toLowerCase() === wanted || l.signature.toLowerCase() === wanted) ?? null;
}
