import type { BusinessFlow, EntityId, FlowOutcomeKind, FlowStepKind } from '../../domain/types';
import { bundledPolyline, edgeKey, fitProjection, GAP, LABEL_SIZE, pathOf, placeLabels, round, type Box, type PlanePoint, type StationGeometry, type TrackGraph } from '../layout';

/**
 * Flow board layout (ADR-022, docs/BUSINESS_FLOWS.md §7): the transit layout pipeline with a
 * different placement strategy. Columns are step rank (longest path from the start), rows are
 * service bands (plus an outcomes band); steps of several flows with the same service and entry
 * point merge into one interchange station. Bundling, projection, and labels are shared with the
 * service board. Pure: computed once per data load.
 */

export const FLOW_COLUMN = 230;
const SLOT = 150;
const BAND_GAP = 56;

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

/** Plane positions: u by rank, v by service band and a slot within it. */
export function placeFlowStations(fx: FlowBoardIndex): { positions: Map<string, PlanePoint>; bandRanges: { id: string; label: string; v0: number; v1: number }[] } {
  const positions = new Map<string, PlanePoint>();
  const bandRanges: { id: string; label: string; v0: number; v1: number }[] = [];
  let top = 0;
  const groups: { id: string; label: string; stations: FlowStation[] }[] = [
    ...fx.bands.map((id) => {
      const stations = [...fx.stations.values()].filter((s) => s.serviceDefinitionId === id);
      return { id, label: stations[0]?.sub ?? id, stations };
    }),
    { id: 'outcomes', label: 'Outcomes', stations: [...fx.stations.values()].filter((s) => s.kind === 'outcome') },
  ];
  for (const group of groups) {
    if (group.stations.length === 0) continue;
    const slots = new Map<number, number>();
    for (const s of [...group.stations].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))) {
      const slot = slots.get(s.rank) ?? 0;
      slots.set(s.rank, slot + 1);
      positions.set(s.key, { u: s.rank * FLOW_COLUMN, v: top + slot * SLOT });
    }
    const depth = Math.max(...slots.values());
    bandRanges.push({ id: group.id, label: group.label, v0: top - SLOT / 2 + 10, v1: top + (depth - 1) * SLOT + SLOT / 2 - 10 });
    top += depth * SLOT + BAND_GAP;
  }
  return { positions, bandRanges };
}

/** Track graph: one path per transition (elbow routing), shared junctions so flows bundle. */
export function buildFlowGraph(fx: FlowBoardIndex, positions: Map<string, PlanePoint>): TrackGraph & { transitionPaths: Map<string, string[]> } {
  const nodes = new Map(positions);
  const paths = new Map<string, string[][]>();
  const transitionPaths = new Map<string, string[]>();
  const edgeLines = new Map<string, string[]>();
  for (const flow of fx.flows) {
    const branches: string[][] = [];
    for (const t of flow.transitions) {
      const a = fx.stationOf(flow.id, t.from);
      const b = fx.stationOf(flow.id, t.to);
      const pa = nodes.get(a);
      const pb = nodes.get(b);
      if (!pa || !pb || a === b) continue;
      let path: string[];
      if (pa.v === pb.v && pb.u > pa.u) path = [a, b];
      else {
        const forward = pb.u > pa.u;
        const turnU = forward ? pa.u + Math.min(FLOW_COLUMN / 2, (pb.u - pa.u) / 2) : pa.u + 46;
        const j1 = `turn:${a}>${b}:1`;
        const j2 = `turn:${a}>${b}:2`;
        nodes.set(j1, { u: turnU, v: pa.v });
        nodes.set(j2, { u: turnU, v: pb.v });
        path = [a, j1, j2, b];
      }
      branches.push(path);
      transitionPaths.set(`${flow.id}\u0000${t.id}`, path);
      for (let i = 0; i < path.length - 1; i++) {
        const key = edgeKey(path[i] ?? '', path[i + 1] ?? '');
        const users = edgeLines.get(key) ?? [];
        if (!users.includes(flow.id)) edgeLines.set(key, [...users, flow.id]);
      }
    }
    paths.set(flow.id, branches);
  }
  return { nodes, paths, edgeLines, transitionPaths };
}

export interface FlowStationGeometry extends StationGeometry {
  kind: FlowStation['kind'];
}

export interface FlowGeometry {
  width: number;
  height: number;
  flat: boolean;
  lines: { flowId: EntityId; transitions: { transitionId: string; top: string; ribbons: string[]; shadow: string }[] }[];
  stations: FlowStationGeometry[];
  /** Policy diamonds along the start of each transition. */
  stops: { id: string; flowId: EntityId; transitionId: string; policy: number; x: number; y: number }[];
  bands: { d: string; label: string; x: number; y: number }[];
  grid: string[];
}

export function computeFlowGeometry(fx: FlowBoardIndex, options: { flat: boolean; width?: number; height?: number }): FlowGeometry {
  const { positions, bandRanges } = placeFlowStations(fx);
  const graph = buildFlowGraph(fx, positions);
  const us = [...graph.nodes.values()].map((n) => n.u);
  const left = Math.min(0, ...us) - 300; // room for the service band captions
  const right = Math.max(0, ...us) + 120;
  const top = Math.min(...bandRanges.map((b) => b.v0), 0) - 20;
  const bottom = Math.max(...bandRanges.map((b) => b.v1), 0) + 20;
  const frame = [left, right].flatMap((u) => [top, bottom].map((v) => ({ u, v })));
  const projection = fitProjection(frame, { width: options.width ?? (options.flat ? 520 : 1100), height: options.height ?? 660, flat: options.flat, padX: options.flat ? 60 : 70, padY: 24 });
  const h = (value: number) => (options.flat ? 0 : value);
  const flatten = (points: PlanePoint[], height: number) => pathOf(points.map((p) => projection.at(p.u, p.v, h(height))));

  const lines = fx.flows.map((flow) => ({
    flowId: flow.id,
    transitions: flow.transitions.flatMap((t) => {
      const path = graph.transitionPaths.get(`${flow.id}\u0000${t.id}`);
      if (!path) return [];
      const points = bundledPolyline(graph, path, flow.id);
      return [{ transitionId: t.id, top: flatten(points, 9), ribbons: options.flat ? [] : [0, 2, 4, 6, 8].map((height) => flatten(points, height)), shadow: flatten(points, 0) }];
    }),
  }));

  const nameSize = options.flat ? LABEL_SIZE.flatName : LABEL_SIZE.name;
  const markers = [...fx.stations.values()].map((s) => {
    const pos = positions.get(s.key) ?? { u: 0, v: 0 };
    const p = projection.at(pos.u, pos.v, h(9));
    const users = fx.flowsByStation.get(s.key)?.length ?? 1;
    const capsule = s.kind === 'outcome' ? 22 : users >= 2 ? Math.max(18, Math.min(52, users * GAP * p.k + 12)) : null;
    const radius = s.kind === 'decision' ? 8.5 : 7;
    const half = capsule ? capsule / 2 : radius;
    const box: Box = { x0: p.x - (capsule ? 9 : radius), x1: p.x + (capsule ? 9 : radius), y0: p.y - half, y1: p.y + half };
    return { s, p, capsule, radius, box };
  });
  const labels = placeLabels(
    markers.map((m) => ({ id: m.s.key, name: m.s.name, sub: m.s.sub, hint: m.s.kind === 'outcome' ? 'right' : 'above', priority: m.s.kind === 'outcome' ? 0 : 1, x: m.p.x, y: m.p.y, reach: (m.capsule ? m.capsule / 2 : m.radius) + 6, box: m.box })),
    nameSize,
  );
  const stations: FlowStationGeometry[] = markers.map(({ s, p, capsule, radius }) => ({
    id: s.key,
    kind: s.kind,
    x: round(p.x),
    y: round(p.y),
    capsule: capsule && round(capsule),
    radius,
    label: labels.get(s.key) ?? { x: p.x, y: p.y, anchor: 'middle', withSub: false, box: { x0: p.x, x1: p.x, y0: p.y, y1: p.y }, hidden: true },
  }));

  const stops: FlowGeometry['stops'] = fx.flows.flatMap((flow) =>
    flow.transitions.flatMap((t) => {
      const path = graph.transitionPaths.get(`${flow.id}\u0000${t.id}`);
      const a = path && graph.nodes.get(path[0] ?? '');
      const b = path && graph.nodes.get(path[1] ?? '');
      if (!a || !b || t.policies.length === 0) return [];
      const length = Math.hypot(b.u - a.u, b.v - a.v);
      const spacing = Math.min(28, Math.max(10, (length - 36) / t.policies.length));
      return t.policies.map((_, i) => {
        const f = Math.min(0.92, (26 + i * spacing) / (length || 1));
        const p = projection.at(a.u + (b.u - a.u) * f, a.v + (b.v - a.v) * f, h(10));
        return { id: `${flow.id}:${t.id}:${i}`, flowId: flow.id, transitionId: t.id, policy: i, x: round(p.x), y: round(p.y) };
      });
    }),
  );

  const bands = bandRanges.map((band) => {
    const corners = [projection.at(left, band.v0), projection.at(right, band.v0), projection.at(right, band.v1), projection.at(left, band.v1)];
    const caption = projection.at(left + 10, band.v0 + 16);
    return { d: `${pathOf(corners)}Z`, label: band.label.toUpperCase(), x: round(caption.x), y: round(caption.y) };
  });
  const grid: string[] = [];
  for (let u = left; u <= right; u += FLOW_COLUMN / 2) grid.push(pathOf([projection.at(u, top), projection.at(u, bottom)]));

  return { width: projection.width, height: projection.height, flat: options.flat, lines, stations, stops, bands, grid };
}
