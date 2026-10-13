import type { TopologyIndex } from '../domain/topologyIndex';
import { PATTERN_IDS, type PatternId } from '../domain/patterns';
import { lineStations } from './board';
import { POLICY_TYPES, type Branch, type DataTable, type Line, type LineGroup, type PolicyStop, type PolicyType, type Station, type StationKind, type TransitBoard, type TransitWindow } from './types';

/**
 * Board definitions (ADR-031, docs/TRANSIT_BOARD.md Revision 2): the declared part of a transit
 * board, authored per service and independent of the environment. Observed data (stats, step
 * stats, traces, policy firing states, findings) is never authored; it merges onto a definition by
 * line and station ID (`boardFromDefinition`). Pure.
 */

export interface StationDefinition {
  id: string;
  name: string;
  sub?: string | undefined;
  kind: StationKind;
  /** Dependencies only: the canonical entity (service definition or resource ID, ADR-027). */
  entityId?: string | undefined;
  labelHint?: Station['labelHint'];
}

export interface LineDefinition {
  id: string;
  code: string;
  name: string;
  group: LineGroup;
  signature: string;
  caller: string;
  deadlineMs?: number | undefined;
  route: Branch[];
  patterns: PatternId[];
  repeat?: string | undefined;
  transactions?: { stationId: string; tableIds: string[] }[] | undefined;
}

export interface PolicyDefinition {
  id: string;
  clientId: string;
  order: number;
  type: PolicyType;
  label: string;
  config?: Record<string, string> | undefined;
  source?: string | undefined;
  /** Declared as expected here but absent (drawn as a missing policy). */
  missing?: boolean | undefined;
}

export interface BoardDefinition {
  serviceDefinitionId: string;
  stations: StationDefinition[];
  lines: LineDefinition[];
  policies: PolicyDefinition[];
  tables: DataTable[];
}

export const STATION_KINDS: readonly StationKind[] = ['caller', 'gate', 'module', 'client', 'dependency'];
export const LINE_GROUPS: readonly LineGroup[] = ['grpc', 'http', 'webhook', 'event', 'scheduled', 'background'];

/** The declared part of a board (for editing an existing board, e.g. the example). */
export function definitionOf(board: TransitBoard): BoardDefinition {
  return {
    serviceDefinitionId: board.serviceDefinitionId,
    stations: board.stations.map((s) => clean<StationDefinition>({ id: s.id, name: s.name, sub: s.sub, kind: s.kind, entityId: s.entityId, labelHint: s.labelHint })),
    lines: board.lines.map((l) =>
      clean<LineDefinition>({ id: l.id, code: l.code, name: l.name, group: l.group, signature: l.signature, caller: l.caller, deadlineMs: l.deadlineMs, route: structuredClone(l.route), patterns: [...l.patterns], repeat: l.repeat, transactions: l.transactions && structuredClone(l.transactions) }),
    ),
    policies: board.policies.map((p) => clean<PolicyDefinition>({ id: p.id, clientId: p.clientId, order: p.order, type: p.type, label: p.label, config: p.config && { ...p.config }, source: p.source, missing: p.state === 'missing' ? true : undefined })),
    tables: structuredClone(board.tables ?? []),
  };
}

const AUTHORED = { kind: 'declared', detail: 'authored in the app' } as const;
const NOT_OBSERVED: Line['stats'] = { p50Ms: 0, p95Ms: 0, errorRate: 0, callsPerDay: 0, traces: 0 };

/**
 * A board from a definition, with observed data merged by ID where it exists: observed lines keep
 * their stats, step stats, findings, and provenance; observed policies keep their state and stat
 * (unless the definition declares them missing). Everything else is declared and not observed.
 */
export function boardFromDefinition(def: BoardDefinition, options: { environmentId: string; window: TransitWindow; observed?: TransitBoard | null | undefined }): TransitBoard {
  const observed = options.observed ?? null;
  const stationsSeen = new Map(observed?.stations.map((s) => [s.id, s]));
  const linesSeen = new Map(observed?.lines.map((l) => [l.id, l]));
  const policiesSeen = new Map(observed?.policies.map((p) => [p.id, p]));
  return {
    serviceDefinitionId: def.serviceDefinitionId,
    environmentId: options.environmentId,
    window: options.window,
    isExample: observed?.isExample ?? false,
    sources: observed?.sources ?? [],
    stations: def.stations.map((s): Station => {
      const seen = stationsSeen.get(s.id);
      return clean<Station>({ ...s, provenance: seen?.provenance ?? { ...AUTHORED }, status: seen?.status, stats: seen?.stats });
    }),
    policies: def.policies.map((p): PolicyStop => {
      const seen = policiesSeen.get(p.id);
      const state: PolicyStop['state'] = p.missing ? 'missing' : seen && seen.state !== 'missing' ? seen.state : 'idle';
      return clean<PolicyStop>({ id: p.id, clientId: p.clientId, order: p.order, type: p.type, label: p.label, config: p.config, source: p.source, state, stat: seen?.stat, provenance: seen?.provenance ?? { ...AUTHORED } });
    }),
    lines: def.lines.map((l): Line => {
      const seen = linesSeen.get(l.id);
      return clean<Line>({
        ...l,
        stats: seen?.stats ?? { ...NOT_OBSERVED },
        stepStats: seen?.stepStats,
        findings: seen?.findings ?? [],
        provenance: seen?.provenance ?? { entry: { ...AUTHORED }, route: { ...AUTHORED } },
      });
    }),
    tables: structuredClone(def.tables),
  };
}

// ---------------------------------------------------------------------------------------------
// Validation (codes shared with backend/internal/domain/board.go)
// ---------------------------------------------------------------------------------------------

export type BoardIssueCode = 'board-service-not-found' | 'invalid-board-station' | 'board-entity-not-found' | 'invalid-board-line' | 'invalid-board-policy' | 'invalid-board-table';

export interface BoardIssue {
  code: BoardIssueCode;
  message: string;
  /** Field path in the definition, e.g. 'lines[2].route[0].stations[1]' (focus target in the editor). */
  path: string;
}

/** Topology lookups the rules need; `TopologyIndex` satisfies it. */
export type BoardTopology = Pick<TopologyIndex, 'definitions' | 'resources'>;

export function validateBoardDefinition(def: BoardDefinition, topology: BoardTopology): BoardIssue[] {
  const out: BoardIssue[] = [];
  const add = (code: BoardIssueCode, path: string, message: string) => out.push({ code, path, message });
  if (!topology.definitions.has(def.serviceDefinitionId)) add('board-service-not-found', 'serviceDefinitionId', `No service definition “${def.serviceDefinitionId}”.`);

  const stations = new Map<string, StationDefinition>();
  def.stations.forEach((s, i) => {
    const at = `stations[${i}]`;
    if (!s.id.trim() || stations.has(s.id)) add('invalid-board-station', `${at}.id`, s.id.trim() ? `Station ID “${s.id}” is used twice.` : 'A station needs an ID.');
    if (!s.name.trim()) add('invalid-board-station', `${at}.name`, `Station “${s.id}” needs a name.`);
    if (!STATION_KINDS.includes(s.kind)) add('invalid-board-station', `${at}.kind`, `Station “${s.id}” has an unknown kind “${String(s.kind)}”.`);
    if (s.entityId !== undefined) {
      if (s.kind !== 'dependency') add('invalid-board-station', `${at}.entityId`, `Only dependencies link to topology entities; “${s.id}” is a ${s.kind}.`);
      else if (!topology.definitions.has(s.entityId) && !topology.resources.has(s.entityId)) add('board-entity-not-found', `${at}.entityId`, `“${s.name}” links to “${s.entityId}”, which is not in the topology.`);
    }
    stations.set(s.id, s);
  });

  const lineIds = new Set<string>();
  const codes = new Set<string>();
  def.lines.forEach((l, i) => {
    const at = `lines[${i}]`;
    if (!l.id.trim() || lineIds.has(l.id)) add('invalid-board-line', `${at}.id`, l.id.trim() ? `Line ID “${l.id}” is used twice.` : 'A line needs an ID.');
    if (!l.code.trim() || codes.has(l.code)) add('invalid-board-line', `${at}.code`, l.code.trim() ? `Line code “${l.code}” is used twice.` : `Line “${l.id}” needs a code.`);
    if (!l.name.trim()) add('invalid-board-line', `${at}.name`, `Line “${l.id}” needs a name.`);
    if (!LINE_GROUPS.includes(l.group)) add('invalid-board-line', `${at}.group`, `Line “${l.id}” has an unknown group “${String(l.group)}”.`);
    if (l.deadlineMs !== undefined && !(l.deadlineMs > 0)) add('invalid-board-line', `${at}.deadlineMs`, `Line “${l.id}”: the deadline must be positive.`);
    for (const [k, p] of l.patterns.entries()) if (!PATTERN_IDS.includes(p)) add('invalid-board-line', `${at}.patterns[${k}]`, `Line “${l.id}”: unknown pattern “${String(p)}”.`);
    lineIds.add(l.id);
    codes.add(l.code);
    if (l.route.length === 0 || (l.route[0]?.stations.length ?? 0) < 2) {
      add('invalid-board-line', `${at}.route`, `Line “${l.id}” needs a route of at least two stations.`);
      return;
    }
    const reached = new Set<string>();
    l.route.forEach((b, j) => {
      const bAt = `${at}.route[${j}]`;
      if (b.stations.length < 2) add('invalid-board-line', `${bAt}.stations`, `Line “${l.id}”, branch ${j + 1}: a branch needs at least two stations.`);
      b.stations.forEach((id, k) => {
        if (!stations.has(id)) add('invalid-board-line', `${bAt}.stations[${k}]`, `Line “${l.id}” goes through an unknown station “${id}”.`);
      });
      if (j > 0 && !reached.has(b.stations[0] ?? '')) add('invalid-board-line', `${bAt}.stations[0]`, `Line “${l.id}”, branch ${j + 1} must start at a station of an earlier branch.`);
      if (b.share !== undefined && !(b.share >= 0 && b.share <= 1)) add('invalid-board-line', `${bAt}.share`, `Line “${l.id}”, branch ${j + 1}: the share must be between 0 and 1.`);
      for (const id of b.stations) reached.add(id);
    });
  });

  const policyIds = new Set<string>();
  def.policies.forEach((p, i) => {
    const at = `policies[${i}]`;
    if (!p.id.trim() || policyIds.has(p.id)) add('invalid-board-policy', `${at}.id`, p.id.trim() ? `Policy ID “${p.id}” is used twice.` : 'A policy needs an ID.');
    if (stations.get(p.clientId)?.kind !== 'client') add('invalid-board-policy', `${at}.clientId`, `Policy “${p.id}” must sit on a client station; “${p.clientId}” is not one.`);
    if (!POLICY_TYPES.includes(p.type)) add('invalid-board-policy', `${at}.type`, `Policy “${p.id}” has an unknown type “${String(p.type)}”.`);
    policyIds.add(p.id);
  });

  const linesById = new Map(def.lines.map((l) => [l.id, l]));
  def.tables.forEach((t, i) => {
    const at = `tables[${i}]`;
    if (stations.get(t.stationId)?.kind !== 'dependency') add('invalid-board-table', `${at}.stationId`, `Table “${t.name}” must belong to a dependency station; “${t.stationId}” is not one.`);
    for (const [role, ids] of [['writes', t.writes], ['reads', t.reads]] as const) {
      ids.forEach((lineId, k) => {
        const line = linesById.get(lineId);
        if (!line) add('invalid-board-table', `${at}.${role}[${k}]`, `Table “${t.name}”: unknown line “${lineId}”.`);
        else if (!lineStations(line).includes(t.stationId)) add('invalid-board-table', `${at}.${role}[${k}]`, `Table “${t.name}”: line ${line.code} does not reach “${t.stationId}”.`);
      });
    }
  });
  return out;
}

/** Drops undefined fields, so definitions stay minimal and compare cleanly. */
function clean<T>(value: object): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
