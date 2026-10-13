import type { BusinessFlow, FlowOutcomeKind, FlowStepKind } from '../../../domain/types';
import type { BoardIndex } from '../../../transit/board';
import { lineForStep } from '../../../transit/flows/flowModel';
import { OUTCOMES_LANE, type SwimlaneLayout } from '../../../transit/flows/swimlane';
import { buildTrackGraph, bundledPolyline, placeStations, stopPosition, type PlanePoint } from '../../../transit/layout';
import type { PolicyState, PolicyType, StationKind } from '../../../transit/types';

/**
 * The 3D drill-down's scene model (ADR-026, Milestone 13.1), in two tiers: the flow's swimlane
 * plane on top, and below and in front of it a row of service planes, each showing what the flow
 * does inside that service — the lines its steps enter, their stations and policies — fitted to
 * them and placed under those steps along x (pushed apart only where planes would overlap). Steps of
 * services without a board end in short stubs. Pure and deterministic: positions come from the
 * swimlane layout and the transit layout's plane coordinates (u, v). World units, y up; the flow
 * plane is at y = 0, and +z points toward the viewer.
 */

export type Vec3 = readonly [number, number, number];

/** Plane units → world units: one scale for every service, so planes compare. */
export const BOARD_SCALE = 0.47;
/** How far planes hang below the flow plane: at least this, more for a big flow (DROP_RATIO of its extent). */
export const BOARD_DROP = 300;
const DROP_RATIO = 0.12;
/** The row of service planes starts this far in front of the flow plane's front edge. */
export const ROW_GAP = 160;
/** Least space between two planes in the row. */
export const PLANE_GAP = 80;
/** A step of a service without a board drops a short stub this deep, ending in an empty ring. */
export const STUB_DEPTH = 110;
/** Margin around what a plane shows, in plane units. */
const PLANE_MARGIN = 70;
/** Lanes are this deep, and this far apart, on the flow plane. */
export const MIN_BAND = 130;
export const BAND_GAP = 40;
/** Room on the left of the flow plane for the lane captions. */
export const CAPTION_GUTTER = 260;
const OUTCOMES_DEPTH = 120;

export interface DrilldownStep {
  id: string;
  name: string;
  kind: FlowStepKind;
  serviceDefinitionId: string;
  position: Vec3;
  /** The line the step enters on its service's board, or null when it maps to none. */
  lineId: string | null;
}

export interface DrilldownOutcome {
  id: string;
  name: string;
  kind: FlowOutcomeKind;
  position: Vec3;
}

export interface DrilldownLane {
  serviceDefinitionId: string;
  label: string;
  /** The service has a transit board (a plane hangs under the lane). */
  hasBoard: boolean;
  /** The band's extent along z on the flow plane. */
  z0: number;
  z1: number;
}

export interface DrilldownStation {
  id: string;
  name: string;
  kind: StationKind;
  position: Vec3;
  /** On a line this flow enters. */
  inFlow: boolean;
}

export interface DrilldownLine {
  lineId: string;
  code: string;
  name: string;
  /** Position in the board's global line order: picks the line colour (`--transit-line-N`). */
  colorIndex: number;
  /** A line this flow's steps enter (shown by default). */
  inFlow: boolean;
  branches: Vec3[][];
}

export interface DrilldownPolicy {
  id: string;
  type: PolicyType;
  state: PolicyState;
  label: string;
  position: Vec3;
}

/** A plane's footprint: centre and size along x and z. */
export interface Footprint {
  center: Vec3;
  width: number;
  depth: number;
}

export interface DrilldownBoard extends Footprint {
  serviceDefinitionId: string;
  name: string;
  /**
   * 'board': the service's transit board (fitted to the flow's lines). 'pad': it has no board yet;
   * nothing is drawn, and the footprint is the area under its steps (where the camera goes).
   */
  kind: 'board' | 'pad';
  /** The whole board, for "Show all lines". Equals the footprint for a pad. */
  full: Footprint;
  stations: DrilldownStation[];
  lines: DrilldownLine[];
  /** Policy stops on the flow's lines. */
  policies: DrilldownPolicy[];
}

/** A step's drop to its service: to the entry station of its line, or (no line) to the plane or pad. */
export interface DrilldownShaft {
  stepId: string;
  serviceDefinitionId: string;
  /** Null: the step maps to no line here (a stub to the pad or plane). */
  lineId: string | null;
  from: Vec3;
  to: Vec3;
}

export interface DrilldownModel {
  flowId: string;
  /** How far below the flow plane the service planes hang. */
  drop: number;
  /** The flow plane's extent: x0..x1 across (x0 includes the caption gutter), z0..z1 deep, at y = 0. */
  flowPlane: { x0: number; x1: number; z0: number; z1: number };
  lanes: DrilldownLane[];
  steps: DrilldownStep[];
  outcomes: DrilldownOutcome[];
  /** Transitions on the flow plane, from the swimlane routes. */
  transitions: { id: string; points: Vec3[] }[];
  boards: DrilldownBoard[];
  shafts: DrilldownShaft[];
  bounds: { min: Vec3; max: Vec3 };
}

export interface DrilldownInput {
  flow: BusinessFlow;
  layout: SwimlaneLayout;
  /** Each service's board in the environment; null or missing: no board yet. */
  boards: ReadonlyMap<string, BoardIndex | null>;
  serviceName: (id: string) => string;
}

/** The scene model, in stages: what each service shows, the lane bands, the flow plane, the planes, the shafts. */
export function buildDrilldown(input: DrilldownInput): DrilldownModel {
  const { flow, layout } = input;
  const serviceLanes = layout.lanes.filter((l) => l.id !== OUTCOMES_LANE);
  const centeredX = (n: { x: number; width: number }) => n.x + n.width / 2 - layout.width / 2;
  const stepLines = new Map(flow.steps.map((s) => [s.id, lineOfStep(input, s.id)]));
  const contents = serviceLanes.map((lane) => serviceContent(input, lane.id, stepLines));
  const bands = laneBands(layout, contents.map((c) => c.serviceId));
  const toFlowPlane = flowPlaneMapping(layout, bands);
  const steps = flow.steps.flatMap((step): DrilldownStep[] => {
    const node = layout.nodes.find((n) => n.id === step.id);
    return node ? [{ id: step.id, name: step.name, kind: step.kind, serviceDefinitionId: step.serviceDefinitionId, position: toFlowPlane(node.x + node.width / 2, node.y + node.height / 2), lineId: stepLines.get(step.id) ?? null }] : [];
  });
  const outcomes = flow.outcomes.flatMap((outcome): DrilldownOutcome[] => {
    const node = layout.nodes.find((n) => n.id === outcome.id);
    return node ? [{ id: outcome.id, name: outcome.name, kind: outcome.kind, position: toFlowPlane(node.x + node.width / 2, node.y + node.height / 2) }] : [];
  });
  const transitions = layout.edges.map((e) => ({ id: e.id, points: e.points.map((p) => toFlowPlane(p.x, p.y)) }));
  const lanes = serviceLanes.map((l) => {
    const band = bands.get(l.id) ?? { z0: 0, z1: 0 };
    return { serviceDefinitionId: l.id, label: l.label, hasBoard: input.boards.get(l.id) != null, z0: band.z0, z1: band.z1 };
  });
  const flowPlane = { x0: -layout.width / 2 - CAPTION_GUTTER, x1: layout.width / 2, z0: lanes[0]?.z0 ?? 0, z1: bands.get(OUTCOMES_LANE)?.z1 ?? lanes.at(-1)?.z1 ?? 0 };
  const drop = Math.max(BOARD_DROP, round(DROP_RATIO * Math.max(flowPlane.x1 - flowPlane.x0, flowPlane.z1 - flowPlane.z0)));
  const row = { y: -drop, z0: flowPlane.z1 + ROW_GAP };
  const anchors = packRow(contents.map((c) => rowAnchor(c, steps)));
  const placed = contents.map((c) => placeService(input, c, bands.get(c.serviceId) ?? { z0: 0, z1: 0 }, row, anchors.get(c.serviceId), steps, centeredX));
  const boards = placed.map((p) => p.board);
  const shafts = steps.flatMap((step): DrilldownShaft[] => {
    const service = placed.find((p) => p.board.serviceDefinitionId === step.serviceDefinitionId);
    if (!service) return [];
    const entry = step.lineId ? service.entries.get(step.lineId) : undefined;
    const onPlane: Vec3 = [step.position[0], service.board.center[1], clamp(step.position[2], service.board.center[2] - service.board.depth / 2, service.board.center[2] + service.board.depth / 2)];
    const stub: Vec3 = [step.position[0], -STUB_DEPTH, step.position[2]];
    const to = entry ?? (service.board.kind === 'pad' ? stub : onPlane);
    return [{ stepId: step.id, serviceDefinitionId: step.serviceDefinitionId, lineId: entry ? step.lineId : null, from: step.position, to }];
  });
  return { flowId: flow.id, drop, flowPlane, lanes, steps, outcomes, transitions, boards, shafts, bounds: boundsOf(flowPlane, boards, drop) };
}

/** The line a step enters on its service's board, if any. */
function lineOfStep(input: DrilldownInput, stepId: string): string | null {
  const step = input.flow.steps.find((s) => s.id === stepId);
  const board = step ? input.boards.get(step.serviceDefinitionId) : null;
  return step && board ? (lineForStep(board.lines, step)?.id ?? null) : null;
}

// ---------------------------------------------------------------------------------------------
// What each service shows (in its own plane units)
// ---------------------------------------------------------------------------------------------

interface ServiceContent {
  serviceId: string;
  index: BoardIndex | null;
  positions: Map<string, PlanePoint>;
  /** Plane polylines per line (all branches). */
  polylines: Map<string, PlanePoint[][]>;
  flowLineIds: Set<string>;
  /** The fitted extent (flow lines, else the whole board) and the whole board's, in plane units. */
  fitted: PlaneBox;
  full: PlaneBox;
}

interface PlaneBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function serviceContent(input: DrilldownInput, serviceId: string, stepLines: Map<string, string | null>): ServiceContent {
  const index = input.boards.get(serviceId) ?? null;
  const flowLineIds = new Set(input.flow.steps.filter((s) => s.serviceDefinitionId === serviceId).flatMap((s) => stepLines.get(s.id) ?? []));
  if (!index) return { serviceId, index, positions: new Map(), polylines: new Map(), flowLineIds, fitted: EMPTY_BOX, full: EMPTY_BOX };
  const positions = placeStations(index);
  const graph = buildTrackGraph(index, positions);
  const polylines = new Map(index.lines.map((line) => [line.id, (graph.paths.get(line.id) ?? []).map((path) => bundledPolyline(graph, path, line.id))]));
  const full = boxOf([...positions.values(), ...[...polylines.values()].flat(2)]);
  const fitted = flowLineIds.size ? boxOf([...flowLineIds].flatMap((id) => (polylines.get(id) ?? []).flat())) : full;
  return { serviceId, index, positions, polylines, flowLineIds, fitted, full };
}

const EMPTY_BOX: PlaneBox = { u0: 0, u1: 0, v0: 0, v1: 0 };

function boxOf(points: readonly PlanePoint[]): PlaneBox {
  if (points.length === 0) return EMPTY_BOX;
  const us = points.map((p) => p.u);
  const vs = points.map((p) => p.v);
  return { u0: Math.min(...us) - PLANE_MARGIN, u1: Math.max(...us) + PLANE_MARGIN, v0: Math.min(...vs) - PLANE_MARGIN, v1: Math.max(...vs) + PLANE_MARGIN };
}

// ---------------------------------------------------------------------------------------------
// Lane bands on the flow plane
// ---------------------------------------------------------------------------------------------

/** One band per service lane, MIN_BAND deep, in lane order; outcomes follow. */
function laneBands(layout: SwimlaneLayout, serviceIds: readonly string[]): Map<string, { z0: number; z1: number }> {
  const bands = new Map<string, { z0: number; z1: number }>();
  let z = 0;
  for (const id of serviceIds) {
    bands.set(id, { z0: z, z1: z + MIN_BAND });
    z += MIN_BAND + BAND_GAP;
  }
  if (layout.lanes.some((l) => l.id === OUTCOMES_LANE)) bands.set(OUTCOMES_LANE, { z0: z, z1: z + OUTCOMES_DEPTH });
  return bands;
}

/** Swimlane (x, y) → the flow plane: x centred, y mapped from the lane's height onto its band's depth. */
function flowPlaneMapping(layout: SwimlaneLayout, bands: Map<string, { z0: number; z1: number }>): (x: number, y: number) => Vec3 {
  return (x, y) => {
    const lane = layout.lanes.find((l) => y >= l.y && y <= l.y + l.height) ?? (y < (layout.lanes[0]?.y ?? 0) ? layout.lanes[0] : layout.lanes.at(-1));
    const band = lane ? bands.get(lane.id) : undefined;
    if (!lane || !band || lane.height <= 0) return [round(x - layout.width / 2), 0, 0];
    const f = (y - lane.y) / lane.height;
    return [round(x - layout.width / 2), 0, round(band.z0 + f * (band.z1 - band.z0))];
  };
}

// ---------------------------------------------------------------------------------------------
// Placing each service's plane (or pad) under its steps
// ---------------------------------------------------------------------------------------------

interface PlacedService {
  board: DrilldownBoard;
  /** Line → world position of its entry station. */
  entries: Map<string, Vec3>;
}

/** Where a plane goes in the row: its anchor (plane u ↔ world x), as wanted (under the steps) and after packing. */
interface RowAnchor {
  serviceId: string;
  /** Plane u that sits at world x `x`. */
  u: number;
  x: number;
  /** The fitted plane's extent along x around the anchor: [x - left, x + right]. */
  left: number;
  right: number;
}

/**
 * Under-step placement: the flow lines' entry stations sit under the steps that enter them (their
 * mean x); without mapped steps, the fitted plane is centred under the lane's steps.
 */
function rowAnchor(c: ServiceContent, steps: readonly DrilldownStep[]): RowAnchor | null {
  const index = c.index;
  if (!index) return null;
  const laneSteps = steps.filter((s) => s.serviceDefinitionId === c.serviceId);
  const mapped = laneSteps.filter((s) => s.lineId !== null);
  const entryUs = mapped.flatMap((s) => {
    const id = s.lineId ? entryStationOf(index, s.lineId) : undefined;
    const p = id ? c.positions.get(id) : undefined;
    return p ? [p.u] : [];
  });
  const u = mean(entryUs) ?? (c.fitted.u0 + c.fitted.u1) / 2;
  const x = mean(mapped.map((s) => s.position[0])) ?? mean(laneSteps.map((s) => s.position[0])) ?? 0;
  return { serviceId: c.serviceId, u, x, left: (u - c.fitted.u0) * BOARD_SCALE, right: (c.fitted.u1 - u) * BOARD_SCALE };
}

/** Packs the row left to right: a plane that would overlap the one before it moves right just enough. */
function packRow(anchors: readonly (RowAnchor | null)[]): Map<string, RowAnchor> {
  const out = new Map<string, RowAnchor>();
  let edge = -Infinity;
  for (const a of anchors.filter((x): x is RowAnchor => x !== null).sort((p, q) => p.x - p.left - (q.x - q.left) || (p.serviceId < q.serviceId ? -1 : 1))) {
    const x = Math.max(a.x, edge + PLANE_GAP + a.left);
    out.set(a.serviceId, { ...a, x });
    edge = x + a.right;
  }
  return out;
}

/** The entry station of a line: the first one the service owns (a gate, else the first after the caller). */
function entryStationOf(index: BoardIndex, lineId: string): string | undefined {
  const route = index.lines.find((l) => l.id === lineId)?.route[0]?.stations ?? [];
  return route.find((id) => index.stations.get(id)?.kind === 'gate') ?? route.find((id) => index.stations.get(id)?.kind !== 'caller') ?? route[0];
}

function placeService(input: DrilldownInput, c: ServiceContent, band: { z0: number; z1: number }, row: { y: number; z0: number }, anchor: RowAnchor | undefined, steps: readonly DrilldownStep[], centeredX: (n: { x: number; width: number }) => number): PlacedService {
  const name = input.serviceName(c.serviceId);
  const laneSteps = steps.filter((s) => s.serviceDefinitionId === c.serviceId);
  const laneX = mean(input.layout.nodes.filter((n) => n.lane === c.serviceId).map(centeredX)) ?? 0;
  const bandZ = (band.z0 + band.z1) / 2;
  if (!c.index || !anchor) {
    const xs = laneSteps.map((s) => s.position[0]);
    const x0 = Math.min(laneX, ...xs) - 120;
    const x1 = Math.max(laneX, ...xs) + 120;
    const pad: Footprint = { center: [round((x0 + x1) / 2), -STUB_DEPTH, round(bandZ)], width: round(x1 - x0), depth: round(band.z1 - band.z0) };
    return { board: { serviceDefinitionId: c.serviceId, name, kind: 'pad', ...pad, full: pad, stations: [], lines: [], policies: [] }, entries: new Map() };
  }
  const index = c.index;
  // The fitted plane's back edge (v0) lines up with the row's back edge, in front of the flow plane.
  const at = (p: PlanePoint): Vec3 => [round(anchor.x + (p.u - anchor.u) * BOARD_SCALE), row.y, round(row.z0 + (p.v - c.fitted.v0) * BOARD_SCALE)];
  const footprint = (box: PlaneBox): Footprint => {
    const center = at({ u: (box.u0 + box.u1) / 2, v: (box.v0 + box.v1) / 2 });
    return { center, width: round((box.u1 - box.u0) * BOARD_SCALE), depth: round((box.v1 - box.v0) * BOARD_SCALE) };
  };
  const flowStations = new Set([...c.flowLineIds].flatMap((id) => index.lines.find((l) => l.id === id)?.route.flatMap((b) => b.stations) ?? []));
  const stations = index.board.stations.map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: at(c.positions.get(s.id) ?? { u: 0, v: 0 }), inFlow: flowStations.has(s.id) }));
  const lines = index.lines.map((line, i) => ({ lineId: line.id, code: line.code, name: line.name, colorIndex: i, inFlow: c.flowLineIds.has(line.id), branches: (c.polylines.get(line.id) ?? []).map((poly) => poly.map(at)) }));
  const policies = index.board.policies.flatMap((stop): DrilldownPolicy[] => {
    if (!flowStations.has(stop.clientId)) return [];
    const p = stopPosition(index, c.positions, stop.id);
    return p ? [{ id: stop.id, type: stop.type, state: stop.state, label: stop.label, position: at(p) }] : [];
  });
  const entries = new Map<string, Vec3>();
  for (const line of index.lines) {
    const id = entryStationOf(index, line.id);
    const p = id ? c.positions.get(id) : undefined;
    if (p) entries.set(line.id, at(p));
  }
  return { board: { serviceDefinitionId: c.serviceId, name, kind: 'board', ...footprint(c.fitted), full: footprint(c.full), stations, lines, policies }, entries };
}

function boundsOf(flowPlane: DrilldownModel['flowPlane'], boards: readonly DrilldownBoard[], drop: number): DrilldownModel['bounds'] {
  const real = boards.filter((b) => b.kind === 'board');
  const xs = [flowPlane.x0, flowPlane.x1, ...real.flatMap((b) => [b.center[0] - b.width / 2, b.center[0] + b.width / 2])];
  const zs = [flowPlane.z0, flowPlane.z1, ...real.flatMap((b) => [b.center[2] - b.depth / 2, b.center[2] + b.depth / 2])];
  const low = real.length ? -drop : boards.length ? -STUB_DEPTH : 0;
  return { min: [Math.min(...xs), low, Math.min(...zs)], max: [Math.max(...xs), 0, Math.max(...zs)] };
}

/** The part of the scene a scope looks at: the whole flow, or one service's plane (its whole board when all lines show). */
export function scopeBounds(model: DrilldownModel, serviceDefinitionId: string | null, allLines = false): DrilldownModel['bounds'] {
  const board = serviceDefinitionId ? model.boards.find((b) => b.serviceDefinitionId === serviceDefinitionId) : undefined;
  if (!board) return model.bounds;
  const f = allLines ? board.full : board;
  const [x, y, z] = f.center;
  return { min: [x - f.width / 2, y, z - f.depth / 2], max: [x + f.width / 2, y, z + f.depth / 2] };
}

const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
