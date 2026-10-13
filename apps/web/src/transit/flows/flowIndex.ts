import type { BusinessFlow, EntityId, FlowOutcomeKind, FlowStepKind } from '../../domain/types';

/**
 * Index of the business flows in view (ADR-022): short codes, step ranks, and shared steps. Steps
 * of several flows with the same service and entry point share one key, so a step can say which
 * other flows run it ("also in"). The swimlane layout (swimlane.ts, ADR-023) draws one flow. Pure.
 */

export interface FlowStation {
  key: string;
  name: string;
  /** Service name, or 'outcome'. */
  sub: string;
  kind: FlowStepKind | 'outcome';
  outcomeKind?: FlowOutcomeKind;
  serviceDefinitionId?: EntityId;
  /** Every flow step (or outcome) drawn at this station. */
  refs: { flowId: EntityId; id: string }[];
  rank: number;
}

export interface FlowBoardIndex {
  /** Flows in the global order (by name): drawing and bundle order. */
  flows: BusinessFlow[];
  flowById: Map<EntityId, BusinessFlow>;
  /** Short line code per flow, e.g. 'CH' for Checkout. */
  codes: Map<EntityId, string>;
  stations: Map<string, FlowStation>;
  /** Station key of a flow's step or outcome. */
  stationOf: (flowId: EntityId, id: string) => string;
  flowsByStation: Map<string, EntityId[]>;
  /** Service band order (service definition IDs); outcomes come last. */
  bands: EntityId[];
}

const stepKey = (serviceDefinitionId: string, entry: string) => `step:${serviceDefinitionId}:${entry}`;
const outcomeKey = (flowId: string, outcomeId: string) => `outcome:${flowId}:${outcomeId}`;

/** Longest-path rank of each step and outcome from the flow's start (cycles are cut). */
export function flowRanks(flow: BusinessFlow): Map<string, number> {
  const rank = new Map<string, number>([[flow.startStepId, 0]]);
  const limit = flow.steps.length + flow.outcomes.length;
  for (let pass = 0; pass < limit; pass++) {
    let changed = false;
    for (const t of flow.transitions) {
      const from = rank.get(t.from);
      if (from === undefined) continue;
      if ((rank.get(t.to) ?? -1) < from + 1 && from + 1 <= limit) {
        rank.set(t.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const s of flow.steps) if (!rank.has(s.id)) rank.set(s.id, 0);
  for (const o of flow.outcomes) if (!rank.has(o.id)) rank.set(o.id, 1);
  return rank;
}

function codeFor(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const candidates = [words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0] ?? 'FL').slice(0, 2), (words[0] ?? 'FL').slice(0, 3)];
  for (const c of candidates) if (c && !taken.has(c)) return c;
  let n = 1;
  while (taken.has(`F${n}`)) n++;
  return `F${n}`;
}

export function indexFlows(flows: readonly BusinessFlow[], serviceName: (id: EntityId) => string): FlowBoardIndex {
  const sorted = [...flows].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  const codes = new Map<EntityId, string>();
  const taken = new Set<string>();
  for (const f of sorted) {
    const code = codeFor(f.name, taken);
    taken.add(code);
    codes.set(f.id, code);
  }
  const stations = new Map<string, FlowStation>();
  const keyOf = new Map<string, string>();
  const flowsByStation = new Map<string, EntityId[]>();
  for (const flow of sorted) {
    const ranks = flowRanks(flow);
    const add = (key: string, station: Omit<FlowStation, 'refs' | 'rank'>, id: string) => {
      const existing = stations.get(key);
      const rank = ranks.get(id) ?? 0;
      if (existing) {
        existing.refs.push({ flowId: flow.id, id });
        existing.rank = Math.max(existing.rank, rank);
      } else stations.set(key, { ...station, refs: [{ flowId: flow.id, id }], rank });
      keyOf.set(`${flow.id}\u0000${id}`, key);
      const users = flowsByStation.get(key) ?? [];
      if (!users.includes(flow.id)) flowsByStation.set(key, [...users, flow.id]);
    };
    for (const step of flow.steps) {
      add(stepKey(step.serviceDefinitionId, step.entryPoint ?? `${flow.id}:${step.id}`), { key: '', name: step.name, sub: serviceName(step.serviceDefinitionId), kind: step.kind, serviceDefinitionId: step.serviceDefinitionId }, step.id);
    }
    for (const outcome of flow.outcomes) {
      add(outcomeKey(flow.id, outcome.id), { key: '', name: outcome.name, sub: 'outcome', kind: 'outcome', outcomeKind: outcome.kind }, outcome.id);
    }
  }
  for (const [key, station] of stations) station.key = key;
  // Service bands in order of their earliest step, then by name.
  const firstRank = new Map<EntityId, number>();
  for (const s of stations.values()) {
    if (!s.serviceDefinitionId) continue;
    firstRank.set(s.serviceDefinitionId, Math.min(firstRank.get(s.serviceDefinitionId) ?? Infinity, s.rank));
  }
  const bands = [...firstRank.keys()].sort((a, b) => (firstRank.get(a) ?? 0) - (firstRank.get(b) ?? 0) || serviceName(a).localeCompare(serviceName(b), 'en'));
  return {
    flows: sorted,
    flowById: new Map(sorted.map((f) => [f.id, f])),
    codes,
    stations,
    stationOf: (flowId, id) => keyOf.get(`${flowId}\u0000${id}`) ?? '',
    flowsByStation,
    bands,
  };
}
