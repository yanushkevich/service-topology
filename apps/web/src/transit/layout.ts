import { lineStations, type BoardIndex } from './board';
import type { StationKind } from './types';

/**
 * Transit map layout (docs/TRANSIT_BOARD.md "Map rendering"): pure functions from the board to
 * projected SVG geometry. Computed once per data load; selection and search never call these.
 *
 * 1. Columns and rows: stations on a plane grid (u across, v down), columns fixed by kind.
 * 2. Track graph: trunk, module exits, bus, client approaches, so shared code shares track.
 * 3. Bundling: per track edge, lines in global order (by code), offset (i − (n − 1)/2) × GAP, mitred.
 * 4. Projection: the plane tilted by t about the x axis with perspective (or flat, below 760px).
 */

export const COLUMN_U: Record<StationKind, number> = { caller: -660, gate: -480, module: -280, client: 0, dependency: 540 };
export const TRUNK_U = -400;
export const EXIT_U = -215;
export const BUS_U = -160;
export const APPROACH_U = -90;
/** Bundle spacing in plane units. */
export const GAP = 7;
const LANE_ROW = 130;
const MIN_GAP: Record<StationKind, number> = { caller: 120, gate: 190, module: 100, client: LANE_ROW, dependency: LANE_ROW };

export interface PlanePoint {
  u: number;
  v: number;
}

// ---------------------------------------------------------------------------------------------
// 1. Rows
// ---------------------------------------------------------------------------------------------

/** Consecutive pairs of a list: [a, b], [b, c], … */
export function pairs<T>(items: readonly T[]): [T, T][] {
  return items.flatMap((a, i) => (i + 1 < items.length ? [[a, items[i + 1] as T] as [T, T]] : []));
}

/** Spread desired rows apart by at least `gap`, keeping their order and their mean. */
function spread(desired: { id: string; v: number }[], gap: number): Map<string, number> {
  const sorted = [...desired].sort((a, b) => a.v - b.v || a.id.localeCompare(b.id));
  const placed: { id: string; v: number }[] = [];
  for (const item of sorted) {
    const last = placed.at(-1);
    placed.push({ id: item.id, v: last ? Math.max(item.v, last.v + gap) : item.v });
  }
  const shift = sorted.length ? (sorted.reduce((s, d) => s + d.v, 0) - placed.reduce((s, p) => s + p.v, 0)) / sorted.length : 0;
  return new Map(placed.map((p) => [p.id, p.v + shift]));
}

const mean = (values: number[], fallback: number) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : fallback);

/**
 * Plane position of every station. Clients get one lane each (in order of first use by the lines
 * in code order); a dependency shares its client's lane; modules sit near their clients, gates
 * near their modules, callers near their gates.
 */
export function placeStations(index: BoardIndex): Map<string, PlanePoint> {
  const { board, lines, stations } = index;
  const next = new Map<string, Set<string>>(); // station → stations it leads to
  const prev = new Map<string, Set<string>>();
  const link = (map: Map<string, Set<string>>, from: string, to: string) => {
    const set = map.get(from) ?? new Set<string>();
    map.set(from, set.add(to));
  };
  for (const line of lines) {
    for (const branch of line.route) {
      for (const [a, b] of pairs(branch.stations)) {
        link(next, a, b);
        link(prev, b, a);
      }
    }
  }
  const ofKind = (kind: StationKind) => board.stations.filter((s) => s.kind === kind).map((s) => s.id);
  const firstUse = new Map<string, number>();
  lines.flatMap(lineStations).forEach((id, i) => firstUse.has(id) || firstUse.set(id, i));
  const v = new Map<string, number>();

  const clients = ofKind('client').sort((a, b) => (firstUse.get(a) ?? Infinity) - (firstUse.get(b) ?? Infinity) || a.localeCompare(b));
  clients.forEach((id, i) => v.set(id, i * LANE_ROW));
  const neighbours = (id: string, map: Map<string, Set<string>>, kind: StationKind) =>
    [...(map.get(id) ?? [])].flatMap((n) => {
      const row = v.get(n);
      return stations.get(n)?.kind === kind && row !== undefined ? [row] : [];
    });

  const place = (kind: StationKind, desired: (id: string) => number) => {
    const rows = spread(ofKind(kind).map((id) => ({ id, v: desired(id) })), MIN_GAP[kind]);
    for (const [id, row] of rows) v.set(id, row);
  };
  const middle = mean(clients.map((_, i) => i * LANE_ROW), 0);
  // Dependencies: the lane of the first client that calls them.
  place('dependency', (id) => mean(neighbours(id, prev, 'client').slice(0, 1), middle));
  place('module', (id) => mean(neighbours(id, next, 'client'), middle));
  place('gate', (id) => mean(neighbours(id, next, 'module'), middle));
  place('caller', (id) => mean(neighbours(id, next, 'gate').concat(neighbours(id, next, 'module')), middle));

  return new Map(board.stations.map((s) => [s.id, { u: COLUMN_U[s.kind], v: v.get(s.id) ?? middle }]));
}

// ---------------------------------------------------------------------------------------------
// 2. Track graph
// ---------------------------------------------------------------------------------------------

export interface TrackGraph {
  nodes: Map<string, PlanePoint>;
  /** Per line, per branch: the node path through the track graph. */
  paths: Map<string, string[][]>;
  /** Undirected edge key → line ids using it, in global order. */
  edgeLines: Map<string, string[]>;
}

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildTrackGraph(index: BoardIndex, positions: Map<string, PlanePoint>): TrackGraph {
  const kindOf = (id: string) => index.stations.get(id)?.kind;
  const nodes = new Map(positions);
  const vOf = (id: string) => positions.get(id)?.v ?? 0;

  // Trunk rows: every gate row and every module row a gate reaches. Bus rows: every module and client row
  // joined by a module → client hop.
  const trunkRows = new Set<number>();
  const busRows = new Set<number>();
  for (const line of index.lines) {
    for (const branch of line.route) {
      for (const [a, b] of pairs(branch.stations)) {
        if (kindOf(a) === 'gate' && kindOf(b) === 'module') trunkRows.add(vOf(a)).add(vOf(b));
        if (kindOf(a) === 'module' && kindOf(b) === 'client') busRows.add(vOf(a)).add(vOf(b));
      }
    }
  }
  const node = (id: string, u: number, v: number) => {
    if (!nodes.has(id)) nodes.set(id, { u, v });
    return id;
  };
  const between = (rows: Set<number>, from: number, to: number) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const list = [...rows].filter((r) => r >= lo && r <= hi).sort((x, y) => x - y);
    return from <= to ? list : list.reverse();
  };

  const hop = (a: string, b: string): string[] => {
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka === 'gate' && kb === 'module') {
      return [a, ...between(trunkRows, vOf(a), vOf(b)).map((r) => node(`trunk:${r}`, TRUNK_U, r)), b];
    }
    if (ka === 'module' && kb === 'client') {
      return [
        a,
        node(`exit:${a}`, EXIT_U, vOf(a)),
        ...between(busRows, vOf(a), vOf(b)).map((r) => node(`bus:${r}`, BUS_U, r)),
        node(`approach:${b}`, APPROACH_U, vOf(b)),
        b,
      ];
    }
    return [a, b];
  };

  const paths = new Map<string, string[][]>();
  const edgeLines = new Map<string, string[]>();
  for (const line of index.lines) {
    const branches = line.route.map((branch) => {
      const path: string[] = branch.stations.length === 1 ? [...branch.stations] : [];
      for (const [a, b] of pairs(branch.stations)) {
        for (const id of hop(a, b)) if (path.at(-1) !== id) path.push(id);
      }
      return path;
    });
    paths.set(line.id, branches);
    for (const path of branches) {
      for (const [a, b] of pairs(path)) {
        const key = edgeKey(a, b);
        const users = edgeLines.get(key) ?? [];
        if (!users.includes(line.id)) edgeLines.set(key, [...users, line.id]);
      }
    }
  }
  // index.lines is already in global order, so every edge's list is too.
  return { nodes, paths, edgeLines };
}

// ---------------------------------------------------------------------------------------------
// 3. Bundling
// ---------------------------------------------------------------------------------------------

/** Unit normal of an edge in its canonical direction (left to right, then top to bottom). */
function canonicalNormal(p: PlanePoint, q: PlanePoint): PlanePoint {
  const [a, b] = p.u < q.u || (p.u === q.u && p.v <= q.v) ? [p, q] : [q, p];
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const len = Math.hypot(du, dv) || 1;
  return { u: -dv / len, v: du / len };
}

/** Offset of `lineId` on the edge a–b, in plane units along the edge's canonical normal. */
export function bundleOffset(graph: TrackGraph, a: string, b: string, lineId: string): number {
  const users = graph.edgeLines.get(edgeKey(a, b)) ?? [lineId];
  return (users.indexOf(lineId) - (users.length - 1) / 2) * GAP;
}

function intersect(p1: PlanePoint, p2: PlanePoint, p3: PlanePoint, p4: PlanePoint): PlanePoint | null {
  const d = (p1.u - p2.u) * (p3.v - p4.v) - (p1.v - p2.v) * (p3.u - p4.u);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p1.u - p3.u) * (p3.v - p4.v) - (p1.v - p3.v) * (p3.u - p4.u)) / d;
  return { u: p1.u + t * (p2.u - p1.u), v: p1.v + t * (p2.v - p1.v) };
}

/** The offset polyline of one line along a node path, with mitred corners and jogs between bundles. */
export function bundledPolyline(graph: TrackGraph, path: string[], lineId: string): PlanePoint[] {
  const segments: [PlanePoint, PlanePoint][] = [];
  for (const [a, b] of pairs(path)) {
    const p = graph.nodes.get(a);
    const q = graph.nodes.get(b);
    if (!p || !q) continue;
    const n = canonicalNormal(p, q);
    const o = bundleOffset(graph, a, b, lineId);
    segments.push([
      { u: p.u + n.u * o, v: p.v + n.v * o },
      { u: q.u + n.u * o, v: q.v + n.v * o },
    ]);
  }
  const first = segments[0];
  const last = segments.at(-1);
  if (!first || !last) {
    const only = path[0] === undefined ? undefined : graph.nodes.get(path[0]);
    return only ? [only] : [];
  }
  const points: PlanePoint[] = [first[0]];
  for (const [[a1, a2], [b1, b2]] of pairs(segments)) {
    const corner = intersect(a1, a2, b1, b2);
    const near = corner && Math.hypot(corner.u - a2.u, corner.v - a2.v) < GAP * 12;
    if (corner && near) points.push(corner);
    else if (Math.hypot(a2.u - b1.u, a2.v - b1.v) < 1e-6) points.push(a2);
    else points.push(a2, b1); // parallel edges with different offsets: a jog
  }
  points.push(last[1]);
  return points;
}

// ---------------------------------------------------------------------------------------------
// 4. Projection
// ---------------------------------------------------------------------------------------------

export interface Projection {
  /** Screen point of a plane point at height h, and k = screen pixels per plane unit there. */
  at(u: number, v: number, h?: number): { x: number; y: number; k: number };
  width: number;
  height: number;
}

export const TILT = 1.02;
/** Horizontal squeeze of the flat projection. */
export const FLAT_SQUEEZE = 0.55;
export const DISTANCE = 2000;

/**
 * Perspective (spec: y1 = h·cos t − v·sin t, z1 = h·sin t + v·cos t, k = F / (D − z1),
 * screen = (cx + u·k, cy − y1·k)) with F and the centre fitted to the viewBox; or a flat top-down
 * projection for narrow screens. Plane coordinates are centred on the content first.
 */
export function fitProjection(points: PlanePoint[], options: { width: number; height: number; flat: boolean; padX?: number; padY?: number }): Projection {
  const { width, flat } = options;
  const padX = options.padX ?? 150;
  const padY = options.padY ?? 46;
  const us = points.map((p) => p.u);
  const vs = points.map((p) => p.v);
  const uc = (Math.min(...us) + Math.max(...us)) / 2;
  const vc = (Math.min(...vs) + Math.max(...vs)) / 2;
  const unit = (u: number, v: number, h: number) => {
    // Flat (phone) mode squeezes the columns so the map is taller and its labels larger.
    if (flat) return { x: (u - uc) * FLAT_SQUEEZE, y: v - vc - h, k: 1 };
    const y1 = h * Math.cos(TILT) - (v - vc) * Math.sin(TILT);
    const z1 = h * Math.sin(TILT) + (v - vc) * Math.cos(TILT);
    const k = 1 / (DISTANCE - z1);
    return { x: (u - uc) * k, y: -y1 * k, k };
  };
  const projected = points.map((p) => unit(p.u, p.v, 0));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs) || 1;
  const bh = Math.max(...ys) - Math.min(...ys) || 1;
  // Flat mode keeps the plane's aspect: the height follows the content.
  const height = flat ? Math.round((bh / bw) * (width - 2 * padX) + 2 * padY) : options.height;
  const f = Math.min((width - 2 * padX) / bw, (height - 2 * padY) / bh);
  const cx = width / 2 - (f * (Math.min(...xs) + Math.max(...xs))) / 2;
  const cy = height / 2 - (f * (Math.min(...ys) + Math.max(...ys))) / 2;
  return {
    width,
    height,
    at(u, v, h = 0) {
      const p = unit(u, v, h);
      return { x: cx + f * p.x, y: cy + f * p.y, k: f * p.k };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry for the renderer
// ---------------------------------------------------------------------------------------------

export interface StationGeometry {
  id: string;
  x: number;
  y: number;
  /** Capsule height when the station is a gate or is used by three or more lines; null = dot. */
  capsule: number | null;
  radius: number;
  label: { x: number; y: number; anchor: 'start' | 'middle'; withSub: boolean; box: Box; hidden: boolean };
}

/** Axis-aligned screen box. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Rough rendered width of text: Geist averages a little over half its size per character. */
const textWidth = (text: string, size: number) => text.length * size * 0.56;
/** Label font sizes in viewBox units (TransitMap renders with these). */
export const LABEL_SIZE = { name: 15, flatName: 13, sub: 11.5, subLine: 14 } as const;
const LABEL_PRIORITY: Record<StationKind, number> = { dependency: 0, gate: 1, client: 2, caller: 3, module: 4 };

export interface LineGeometry {
  lineId: string;
  /** Per branch: the raised top path (h = 9), the five ribbon copies (h = 0..8), and the shadow. */
  branches: { top: string; ribbons: string[]; shadow: string }[];
}

export interface StopGeometry {
  id: string;
  x: number;
  y: number;
}

export interface MapGeometry {
  width: number;
  height: number;
  flat: boolean;
  lines: LineGeometry[];
  stations: StationGeometry[];
  stops: StopGeometry[];
  /** Column bands with their caption (CALLERS, ENTRY, …). */
  bands: { d: string; label: string; x: number; y: number }[];
  grid: string[];
}

const round = (n: number) => Math.round(n * 10) / 10;
const pathOf = (points: { x: number; y: number }[]) => points.map((p, i) => `${i ? 'L' : 'M'}${round(p.x)} ${round(p.y)}`).join('');

/** Plane position of a policy stop: spread along its lane between client and dependency. */
export function stopPosition(index: BoardIndex, positions: Map<string, PlanePoint>, stopId: string): PlanePoint | null {
  const stop = index.board.policies.find((p) => p.id === stopId);
  const client = stop && positions.get(stop.clientId);
  if (!stop || !client) return null;
  const count = index.policiesByClient.get(stop.clientId)?.length ?? 1;
  const start = COLUMN_U.client + 80;
  const end = COLUMN_U.dependency - 80;
  const rank = index.policiesByClient.get(stop.clientId)?.indexOf(stop) ?? 0;
  return { u: start + ((rank + 1) * (end - start)) / (count + 1), v: client.v };
}

export function computeMapGeometry(index: BoardIndex, options: { flat: boolean; width?: number; height?: number }): MapGeometry {
  const positions = placeStations(index);
  const graph = buildTrackGraph(index, positions);
  const vs = [...graph.nodes.values()].map((n) => n.v);
  const top = Math.min(...vs) - 60;
  const bottom = Math.max(...vs) + 60;
  // Fit the column bands (which frame every node), not just the nodes.
  const frame = [-720, 640].flatMap((u) => [top, bottom].map((v) => ({ u, v })));
  const projection = fitProjection(frame, { width: options.width ?? (options.flat ? 520 : 1100), height: options.height ?? 660, flat: options.flat, padX: options.flat ? 84 : 70, padY: 24 });
  const ribbonHeights = [0, 2, 4, 6, 8];
  const flatten = (points: PlanePoint[], h: number) => pathOf(points.map((p) => projection.at(p.u, p.v, options.flat ? 0 : h)));

  const lines: LineGeometry[] = index.lines.map((line) => ({
    lineId: line.id,
    branches: (graph.paths.get(line.id) ?? []).map((path) => {
      const points = bundledPolyline(graph, path, line.id);
      return {
        top: flatten(points, 9),
        ribbons: options.flat ? [] : ribbonHeights.map((h) => flatten(points, h)),
        shadow: flatten(points, 0),
      };
    }),
  }));

  const nameSize = options.flat ? LABEL_SIZE.flatName : LABEL_SIZE.name;
  const markers = index.board.stations.map((s) => {
    const pos = positions.get(s.id) ?? { u: COLUMN_U[s.kind], v: 0 };
    const p = projection.at(pos.u, pos.v, options.flat ? 0 : 9);
    const users = index.linesByStation.get(s.id)?.length ?? 0;
    const capsule = s.kind === 'gate' || users >= 3 ? Math.max(16, Math.min(52, users * GAP * p.k + 10)) : null;
    const radius = s.kind === 'dependency' || s.kind === 'caller' ? 8.5 : 6.5;
    const half = capsule ? capsule / 2 : radius;
    return { s, p, capsule, radius, box: { x0: p.x - (capsule ? 9 : radius), x1: p.x + (capsule ? 9 : radius), y0: p.y - half, y1: p.y + half } };
  });

  // Label placement with collision avoidance: in priority order, each label takes its hinted
  // position, else the other side, else the right; a label that fits nowhere is hidden (it shows
  // when its line is selected, and the station's tooltip and the strip always name it).
  type Candidate = Omit<StationGeometry['label'], 'hidden'>;
  const candidates = (m: (typeof markers)[number]): Candidate[] => {
    const { s, p } = m;
    const reach = (m.capsule ? m.capsule / 2 : m.radius) + 6;
    const name = textWidth(s.name, nameSize);
    const sub = s.sub ? textWidth(s.sub, LABEL_SIZE.sub) : 0;
    const subHeight = s.sub ? LABEL_SIZE.subLine : 0;
    const above: Candidate = { x: p.x, y: p.y - reach - 5, anchor: 'middle', withSub: false, box: { x0: p.x - name / 2, x1: p.x + name / 2, y0: p.y - reach - 5 - nameSize, y1: p.y - reach - 2 } };
    const belowY = p.y + reach + nameSize;
    const below: Candidate = { x: p.x, y: belowY, anchor: 'middle', withSub: true, box: { x0: p.x - Math.max(name, sub) / 2, x1: p.x + Math.max(name, sub) / 2, y0: belowY - nameSize, y1: belowY + subHeight + 3 } };
    const right: Candidate = { x: p.x + 18, y: p.y + 5, anchor: 'start', withSub: true, box: { x0: p.x + 18, x1: p.x + 18 + Math.max(name, sub), y0: p.y + 5 - nameSize, y1: p.y + 5 + subHeight + 3 } };
    const hint = s.labelHint ?? (s.kind === 'dependency' ? 'right' : 'above');
    return hint === 'right' ? [right, below, above] : hint === 'below' ? [below, above, right] : [above, below, right];
  };
  const placed: Box[] = [];
  const labels = new Map<string, StationGeometry['label']>();
  for (const m of [...markers].sort((a, b) => LABEL_PRIORITY[a.s.kind] - LABEL_PRIORITY[b.s.kind] || a.p.y - b.p.y)) {
    const choices = candidates(m);
    const others = markers.filter((o) => o !== m).map((o) => o.box);
    const fit = choices.find((c) => !placed.some((b) => overlaps(b, c.box)) && !others.some((b) => overlaps(b, c.box)));
    const chosen = fit ?? choices[0];
    if (!chosen) continue;
    if (fit) placed.push(fit.box);
    labels.set(m.s.id, { ...chosen, hidden: !fit });
  }

  const stations: StationGeometry[] = markers.map(({ s, p, capsule, radius }) => {
    const label = labels.get(s.id) ?? { x: p.x, y: p.y, anchor: 'middle' as const, withSub: false, box: { x0: p.x, x1: p.x, y0: p.y, y1: p.y }, hidden: true };
    return { id: s.id, x: round(p.x), y: round(p.y), capsule: capsule && round(capsule), radius, label };
  });

  const stops: StopGeometry[] = index.board.policies.flatMap((stop) => {
    const pos = stopPosition(index, positions, stop.id);
    if (!pos) return [];
    const p = projection.at(pos.u, pos.v, options.flat ? 0 : 10);
    return [{ id: stop.id, x: round(p.x), y: round(p.y) }];
  });

  const columns: [number, number, string][] = [
    [-720, -560, 'CALLERS'],
    [-560, -340, 'ENTRY'],
    [-340, -130, 'DOMAIN'],
    [-130, 450, 'CLIENTS · POLICIES'],
    [450, 640, 'DEPENDENCIES'],
  ];
  const bands = columns.map(([u0, u1, label]) => {
    const corners = [projection.at(u0, top), projection.at(u1, top), projection.at(u1, bottom), projection.at(u0, bottom)];
    const caption = projection.at(u0 + 12, bottom - 10);
    return { d: `${pathOf(corners)}Z`, label, x: round(caption.x), y: round(caption.y - 6) };
  });
  const grid: string[] = [];
  for (let u = -720; u <= 640; u += 80) grid.push(pathOf([projection.at(u, top), projection.at(u, bottom)]));
  for (let v = top; v <= bottom; v += 80) grid.push(pathOf([projection.at(-720, v), projection.at(640, v)]));

  return { width: projection.width, height: projection.height, flat: options.flat, lines, stations, stops, bands, grid };
}
