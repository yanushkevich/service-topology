import type { BoardDefinition, LineDefinition, StationDefinition } from '../../../transit/definition';
import type { StationKind } from '../../../transit/types';

/**
 * Pure helpers of the board editor (ADR-031): starting points, generated IDs, and the text forms of
 * structured fields. IDs are generated once and never change, so routes, policies, and tables keep
 * pointing at the same stations and lines while names are edited.
 */

const PREFIX: Record<StationKind, string> = { caller: 'caller', gate: 'gate', module: 'mod', client: 'cli', dependency: 'dep' };

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

/** The first free ID of the form `base`, `base-2`, `base-3`, … */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function stationId(kind: StationKind, name: string, def: BoardDefinition): string {
  return uniqueId(`${PREFIX[kind]}:${slug(name)}`, def.stations.map((s) => s.id));
}

/** The next free line code of a group, e.g. 'H3' for the third HTTP line. */
export function nextLineCode(group: LineDefinition['group'], def: BoardDefinition): string {
  const letter = { grpc: 'A', http: 'H', webhook: 'W', event: 'E', scheduled: 'J', background: 'O' }[group];
  const taken = new Set(def.lines.flatMap((l) => [l.code, l.id]));
  let n = 1;
  while (taken.has(`${letter}${n}`)) n++;
  return `${letter}${n}`;
}

/** A small valid start for a service without a board: a caller, an entry gate, and a module. */
export function newBoard(serviceDefinitionId: string, serviceName: string): BoardDefinition {
  const stations: StationDefinition[] = [
    { id: 'caller:client', name: 'Client', kind: 'caller' },
    { id: 'gate:http', name: 'HTTP ingress', kind: 'gate' },
    { id: `mod:${slug(serviceName)}`, name: serviceName, kind: 'module' },
  ];
  return {
    serviceDefinitionId,
    stations,
    lines: [{ id: 'H1', code: 'H1', name: 'GET /health', group: 'http', signature: 'GET /health', caller: 'Client', route: [{ stations: stations.map((s) => s.id), kind: 'sequential' }], patterns: [] }],
    policies: [],
    tables: [],
  };
}

/** "timeoutMs=2000, maxAttempts=3" ↔ { timeoutMs: '2000', maxAttempts: '3' } */
export function formatConfig(config: Record<string, string> | undefined): string {
  return Object.entries(config ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}
export function parseConfig(text: string): Record<string, string> | undefined {
  const pairs = text
    .split(',')
    .map((part) => part.split('=').map((x) => x.trim()))
    .filter((kv): kv is [string, string] => kv.length === 2 && kv[0] !== '' && kv[1] !== '');
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

/** A line's transactions from the tables it writes together, grouped by database station. */
export function transactionsFrom(tableIds: readonly string[], def: BoardDefinition): LineDefinition['transactions'] {
  const byStation = new Map<string, string[]>();
  for (const id of tableIds) {
    const table = def.tables.find((t) => t.id === id);
    if (table) byStation.set(table.stationId, [...(byStation.get(table.stationId) ?? []), id]);
  }
  const out = [...byStation].map(([stationId, ids]) => ({ stationId, tableIds: ids }));
  return out.length ? out : undefined;
}

/** Renames are cosmetic; deleting a station or line also removes it from every route, policy, and table. */
export function withoutStation(def: BoardDefinition, id: string): BoardDefinition {
  return {
    ...def,
    stations: def.stations.filter((s) => s.id !== id),
    lines: def.lines.map((l) => ({ ...l, route: l.route.map((b) => ({ ...b, stations: b.stations.filter((s) => s !== id) })) })),
    policies: def.policies.filter((p) => p.clientId !== id),
    tables: def.tables.filter((t) => t.stationId !== id),
  };
}

export function withoutLine(def: BoardDefinition, id: string): BoardDefinition {
  return {
    ...def,
    lines: def.lines.filter((l) => l.id !== id),
    tables: def.tables.map((t) => ({ ...t, writes: t.writes.filter((x) => x !== id), reads: t.reads.filter((x) => x !== id) })),
  };
}
