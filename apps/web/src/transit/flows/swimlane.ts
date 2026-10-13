import type { BusinessFlow, FlowOutcomeKind, FlowStepKind } from '../../domain/types';
import { flowRanks } from './flowLayout';

/**
 * Swimlane layout of one business flow (ADR-023, docs/BUSINESS_FLOWS.md Revision 2 §9). Lanes are
 * services in the order the flow first reaches them, plus an outcomes lane; columns are step rank.
 * Edges are routed orthogonally here, so the renderer only draws paths: each vertical segment gets
 * its own track in its channel, and an edge that would cross a node runs along a lane gutter.
 * Pure and deterministic; computed once per flow.
 */

export const SWIMLANE = {
  laneLabelWidth: 148,
  stepWidth: 188,
  stepHeight: 58,
  outcomeWidth: 150,
  outcomeHeight: 40,
  /** Space between two columns, where vertical segments run. */
  channel: 132,
  trackGap: 9,
  stackGap: 18,
  lanePadding: 22,
  /** Band at the bottom of each lane for edges that must go around nodes. */
  gutter: 26,
} as const;

export const OUTCOMES_LANE = '__outcomes__';

export interface SwimlaneLane {
  /** Service definition ID, or OUTCOMES_LANE. */
  id: string;
  label: string;
  y: number;
  height: number;
}

export interface SwimlaneNode {
  /** Step or outcome ID. */
  id: string;
  kind: FlowStepKind | 'outcome';
  outcomeKind?: FlowOutcomeKind;
  lane: string;
  rank: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SwimlaneEdge {
  /** Transition ID. */
  id: string;
  from: string;
  to: string;
  points: Point[];
  path: string;
  /** Where the condition and share label goes. */
  label: Point;
  /** Policy diamonds, in the transition's policy order. */
  policies: Point[];
  /** Goes to the same or an earlier column. */
  back: boolean;
}

export interface SwimlaneLayout {
  width: number;
  height: number;
  lanes: SwimlaneLane[];
  nodes: SwimlaneNode[];
  edges: SwimlaneEdge[];
}

const S = SWIMLANE;
const columnX = (rank: number) => S.laneLabelWidth + S.channel + rank * (S.stepWidth + S.channel);
/** Left edge of the channel after a column (rank -1: the channel before the first column). */
const channelX = (rank: number) => columnX(rank) + S.stepWidth;

export function computeSwimlanes(flow: BusinessFlow, serviceName: (id: string) => string): SwimlaneLayout {
  const ranks = flowRanks(flow);
  const laneIds = laneOrder(flow);
  const cells = new Map<string, SwimlaneNode[]>();
  const place = (node: Omit<SwimlaneNode, 'x' | 'y'>) => {
    const key = `${node.lane}\u0000${node.rank}`;
    const cell = cells.get(key) ?? [];
    cell.push({ ...node, x: 0, y: 0 });
    cells.set(key, cell);
  };
  for (const s of flow.steps) place({ id: s.id, kind: s.kind, lane: s.serviceDefinitionId, rank: ranks.get(s.id) ?? 0, width: S.stepWidth, height: S.stepHeight });
  for (const o of flow.outcomes) place({ id: o.id, kind: 'outcome', outcomeKind: o.kind, lane: OUTCOMES_LANE, rank: ranks.get(o.id) ?? 0, width: S.outcomeWidth, height: S.outcomeHeight });

  // Lane heights fit their tallest cell; cells are centred in their lane.
  const stackHeight = (cell: SwimlaneNode[]) => cell.reduce((sum, n) => sum + n.height, 0) + S.stackGap * (cell.length - 1);
  const lanes: SwimlaneLane[] = [];
  let y = 0;
  for (const id of laneIds) {
    const tallest = Math.max(S.stepHeight, ...[...cells.entries()].filter(([key]) => key.startsWith(`${id}\u0000`)).map(([, cell]) => stackHeight(cell)));
    const height = tallest + 2 * S.lanePadding + S.gutter;
    lanes.push({ id, label: id === OUTCOMES_LANE ? 'Outcomes' : serviceName(id), y, height });
    y += height;
  }
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const nodes: SwimlaneNode[] = [];
  for (const cell of cells.values()) {
    const first = cell[0];
    const lane = first && laneById.get(first.lane);
    if (!first || !lane) continue;
    let top = lane.y + S.lanePadding + (lane.height - S.gutter - 2 * S.lanePadding - stackHeight(cell)) / 2;
    for (const n of cell) {
      const width = n.width;
      nodes.push({ ...n, x: columnX(n.rank) + (S.stepWidth - width) / 2, y: top });
      top += n.height + S.stackGap;
    }
  }
  nodes.sort((a, b) => a.rank - b.rank || a.y - b.y || a.id.localeCompare(b.id));

  const maxRank = Math.max(0, ...nodes.map((n) => n.rank));
  const edges = routeEdges(flow, nodes, laneById);
  return { width: channelX(maxRank) + S.channel, height: y, lanes, nodes, edges };
}

/** Services in the order a breadth-first walk from the start first reaches them; outcomes last. */
function laneOrder(flow: BusinessFlow): string[] {
  const serviceOf = new Map(flow.steps.map((s) => [s.id, s.serviceDefinitionId]));
  const order: string[] = [];
  const add = (service: string | undefined) => {
    if (service !== undefined && !order.includes(service)) order.push(service);
  };
  const seen = new Set<string>();
  const queue = [flow.startStepId];
  while (queue.length) {
    const id = queue.shift() ?? '';
    if (seen.has(id)) continue;
    seen.add(id);
    add(serviceOf.get(id));
    for (const t of flow.transitions) if (t.from === id) queue.push(t.to);
  }
  for (const s of flow.steps) add(s.serviceDefinitionId);
  if (flow.outcomes.length) order.push(OUTCOMES_LANE);
  return order;
}

interface Draft {
  id: string;
  from: SwimlaneNode;
  to: SwimlaneNode;
  back: boolean;
  /** Vertical runs: the channel (by the column it follows) and the edge's y range there. */
  verticals: { channel: number; key: string }[];
  gutterLane?: SwimlaneLane | undefined;
}

/**
 * Routes every transition. A forward edge leaves its source to the right, turns in the channel
 * before its target, and enters the target from the left; if the straight run at the source's
 * height would cross a node, it goes down to the source lane's gutter first. Back edges always use
 * the gutter. Tracks are assigned per channel in transition order, so the result is stable.
 */
function routeEdges(flow: BusinessFlow, nodes: SwimlaneNode[], laneById: Map<string, SwimlaneLane>): SwimlaneEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drafts: Draft[] = [];
  for (const t of flow.transitions) {
    const from = byId.get(t.from);
    const to = byId.get(t.to);
    if (!from || !to) continue;
    const back = to.rank <= from.rank;
    const sy = midY(from);
    const blocked = !back && to.rank > from.rank + 1 && nodes.some((n) => n.rank > from.rank && n.rank < to.rank && n.y - 4 < sy && n.y + n.height + 4 > sy);
    const draft: Draft = { id: t.id, from, to, back, verticals: [] };
    if (back || blocked) {
      draft.gutterLane = laneById.get(from.lane);
      draft.verticals.push({ channel: from.rank, key: `${t.id}:out` }, { channel: to.rank - 1, key: `${t.id}:in` });
    } else {
      draft.verticals.push({ channel: to.rank - 1, key: `${t.id}:in` });
    }
    drafts.push(draft);
  }

  // One track per vertical run in each channel; one gutter track per gutter edge in each lane.
  const tracks = new Map<string, number>();
  const perChannel = new Map<number, string[]>();
  for (const d of drafts) for (const v of d.verticals) perChannel.set(v.channel, [...(perChannel.get(v.channel) ?? []), v.key]);
  for (const [channel, keys] of perChannel) {
    keys.forEach((key, i) => tracks.set(key, channelX(channel) + S.channel / 2 + (i - (keys.length - 1) / 2) * Math.min(S.trackGap, (S.channel - 24) / Math.max(1, keys.length - 1))));
  }
  const gutterTrack = new Map<string, number>();
  const perLane = new Map<string, string[]>();
  for (const d of drafts) if (d.gutterLane) perLane.set(d.gutterLane.id, [...(perLane.get(d.gutterLane.id) ?? []), d.id]);
  for (const [laneId, ids] of perLane) {
    const lane = laneById.get(laneId);
    if (!lane) continue;
    const step = Math.min(6, (S.gutter - 8) / Math.max(1, ids.length - 1));
    ids.forEach((id, i) => gutterTrack.set(id, lane.y + lane.height - 6 - i * step));
  }

  const policiesOf = new Map(flow.transitions.map((t) => [t.id, t.policies.length]));
  return drafts.map((d) => {
    const start = { x: d.from.x + d.from.width, y: midY(d.from) };
    const end = { x: d.to.x, y: midY(d.to) };
    const xIn = tracks.get(`${d.id}:in`) ?? end.x - S.channel / 2;
    let points: Point[];
    if (d.gutterLane) {
      const xOut = tracks.get(`${d.id}:out`) ?? start.x + S.channel / 2;
      const gy = gutterTrack.get(d.id) ?? d.gutterLane.y + d.gutterLane.height - 6;
      points = [start, { x: xOut, y: start.y }, { x: xOut, y: gy }, { x: xIn, y: gy }, { x: xIn, y: end.y }, end];
    } else {
      points = [start, { x: xIn, y: start.y }, { x: xIn, y: end.y }, end];
    }
    points = simplify(points);
    return { id: d.id, from: d.from.id, to: d.to.id, points, path: pathOf(points), label: labelPoint(points), policies: policyPoints(points, policiesOf.get(d.id) ?? 0), back: d.back };
  });
}

const midY = (n: SwimlaneNode) => n.y + n.height / 2;

/** Drops zero-length segments and collinear middle points. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

const round = (v: number) => Math.round(v * 10) / 10;
export function pathOf(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join(' ');
}

interface Segment {
  a: Point;
  b: Point;
  length: number;
}
function segments(points: Point[]): Segment[] {
  return points.slice(1).map((b, i) => {
    const a = points[i] ?? b;
    return { a, b, length: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) };
  });
}

/** The label sits beside the edge's own vertical run (unique to the edge), else on its longest run. */
function labelPoint(points: Point[]): Point {
  const segs = segments(points);
  const vertical = segs.filter((s) => s.a.x === s.b.x && s.length >= 28).pop();
  if (vertical) return { x: vertical.a.x + 6, y: (vertical.a.y + vertical.b.y) / 2 };
  const longest = segs.reduce<Segment | undefined>((best, s) => (!best || s.length > best.length ? s : best), undefined);
  return longest ? { x: (longest.a.x + longest.b.x) / 2, y: longest.a.y - 10 } : (points[0] ?? { x: 0, y: 0 });
}

/**
 * Policy diamonds, 14 px apart, on the edge's vertical run when it has room (only this edge uses
 * that track), else on its longest run, starting near the source end.
 */
function policyPoints(points: Point[], count: number): Point[] {
  if (count === 0) return [];
  const spacing = 14;
  const need = (count + 1) * spacing;
  const segs = segments(points);
  const vertical = segs.find((s) => s.a.x === s.b.x && s.length >= need);
  const seg = vertical ?? segs.reduce<Segment | undefined>((best, s) => (!best || s.length > best.length ? s : best), undefined);
  if (!seg) return [];
  const dx = Math.sign(seg.b.x - seg.a.x);
  const dy = Math.sign(seg.b.y - seg.a.y);
  const gap = Math.min(spacing, seg.length / (count + 1));
  return Array.from({ length: count }, (_, i) => ({ x: round(seg.a.x + dx * gap * (i + 1)), y: round(seg.a.y + dy * gap * (i + 1)) }));
}
