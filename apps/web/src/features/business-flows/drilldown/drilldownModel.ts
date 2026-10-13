import type { BusinessFlow, FlowOutcomeKind, FlowStepKind } from '../../../domain/types';
import type { BoardIndex } from '../../../transit/board';
import { lineForStep } from '../../../transit/flows/flowModel';
import { OUTCOMES_LANE, type SwimlaneLayout } from '../../../transit/flows/swimlane';
import { buildTrackGraph, bundledPolyline, placeStations, type PlanePoint } from '../../../transit/layout';
import type { StationKind } from '../../../transit/types';

/**
 * The 3D drill-down's scene model (ADR-026, docs/BUSINESS_FLOWS.md §13): the flow's swimlane plane
 * on top, each service's transit plane hanging under its lane, and a shaft from each step down to
 * the entry station of the line it enters. Pure and deterministic: it reuses the swimlane layout
 * and the transit layout's plane coordinates (u, v) and adds no layout of its own. World units,
 * y up; the flow plane is at y = 0.
 */

export type Vec3 = readonly [number, number, number];

/** How far the service planes hang below the flow plane. */
export const BOARD_DROP = 420;
/** Width of every service plane: the transit plane's u range scaled to this. */
export const BOARD_WIDTH = 640;
/** Depth of a service without a board, and the gap between service planes. */
export const EMPTY_BOARD_DEPTH = 160;
export const BOARD_GAP = 90;
/** The transit plane's frame (layout.ts column bands) and the margin around its rows. */
const PLANE_U: readonly [number, number] = [-720, 640];
const PLANE_V_MARGIN = 60;
/** Depth of the outcomes band on the flow plane. */
const OUTCOMES_DEPTH = 140;

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
  /** The band's extent along z on the flow plane. */
  z0: number;
  z1: number;
}

export interface DrilldownStation {
  id: string;
  name: string;
  kind: StationKind;
  position: Vec3;
}

export interface DrilldownLine {
  lineId: string;
  code: string;
  /** Position in the board's global line order: picks the line colour (`--transit-line-N`). */
  colorIndex: number;
  branches: Vec3[][];
}

export interface DrilldownBoard {
  serviceDefinitionId: string;
  name: string;
  /** False: the service has no transit board yet (drawn as an empty plane). */
  hasBoard: boolean;
  center: Vec3;
  /** Plane size along x and z. */
  width: number;
  depth: number;
  stations: DrilldownStation[];
  lines: DrilldownLine[];
}

export interface DrilldownShaft {
  stepId: string;
  serviceDefinitionId: string;
  lineId: string;
  from: Vec3;
  to: Vec3;
}

export interface DrilldownModel {
  flowId: string;
  /** The flow plane's extent: x0..x1 across, z0..z1 deep, at y = 0. */
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

/** The scene model, in stages: service planes, the lane bands over them, the flow plane, then the shafts. */
export function buildDrilldown(input: DrilldownInput): DrilldownModel {
  const { flow, layout } = input;
  const serviceLanes = layout.lanes.filter((l) => l.id !== OUTCOMES_LANE);
  const planes = placeBoardPlanes(input, serviceLanes.map((l) => l.id));
  const bands = laneBands(layout, planes);
  const toWorld = flowPlaneMapping(layout, bands);
  const steps = flow.steps.flatMap((step): DrilldownStep[] => {
    const node = layout.nodes.find((n) => n.id === step.id);
    if (!node) return [];
    const board = input.boards.get(step.serviceDefinitionId);
    const line = board ? lineForStep(board.lines, step) : null;
    return [{ id: step.id, name: step.name, kind: step.kind, serviceDefinitionId: step.serviceDefinitionId, position: toWorld(node.x + node.width / 2, node.y + node.height / 2), lineId: line?.id ?? null }];
  });
  const outcomes = flow.outcomes.flatMap((outcome): DrilldownOutcome[] => {
    const node = layout.nodes.find((n) => n.id === outcome.id);
    return node ? [{ id: outcome.id, name: outcome.name, kind: outcome.kind, position: toWorld(node.x + node.width / 2, node.y + node.height / 2) }] : [];
  });
  const transitions = layout.edges.map((e) => ({ id: e.id, points: e.points.map((p) => toWorld(p.x, p.y)) }));
  const lanes = serviceLanes.map((l) => {
    const band = bands.get(l.id) ?? { z0: 0, z1: 0 };
    return { serviceDefinitionId: l.id, label: l.label, z0: band.z0, z1: band.z1 };
  });
  const outcomesBand = bands.get(OUTCOMES_LANE);
  const flowPlane = { x0: -layout.width / 2, x1: layout.width / 2, z0: lanes[0]?.z0 ?? 0, z1: outcomesBand?.z1 ?? lanes.at(-1)?.z1 ?? 0 };
  const boards = planes.map((p) => p.board);
  const shafts = steps.flatMap((step): DrilldownShaft[] => {
    const entry = step.lineId ? planes.find((p) => p.board.serviceDefinitionId === step.serviceDefinitionId)?.entries.get(step.lineId) : undefined;
    return step.lineId && entry ? [{ stepId: step.id, serviceDefinitionId: step.serviceDefinitionId, lineId: step.lineId, from: step.position, to: entry }] : [];
  });
  return { flowId: flow.id, flowPlane, lanes, steps, outcomes, transitions, boards, shafts, bounds: boundsOf(flowPlane, boards) };
}

// ---------------------------------------------------------------------------------------------
// Service planes
// ---------------------------------------------------------------------------------------------

interface PlacedPlane {
  board: DrilldownBoard;
  /** Line → world position of its entry station. */
  entries: Map<string, Vec3>;
}

/** One plane per service lane, in lane order along z, each centred under the lane's steps along x. */
function placeBoardPlanes(input: DrilldownInput, serviceIds: readonly string[]): PlacedPlane[] {
  const out: PlacedPlane[] = [];
  let z = 0;
  for (const serviceId of serviceIds) {
    const index = input.boards.get(serviceId) ?? null;
    const plane = index ? planeOf(index) : null;
    const depth = plane ? plane.depth : EMPTY_BOARD_DEPTH;
    const center: Vec3 = [laneCenterX(input, serviceId), -BOARD_DROP, z + depth / 2];
    out.push(plane ? placedBoard(input, serviceId, index as BoardIndex, plane, center) : { board: { serviceDefinitionId: serviceId, name: input.serviceName(serviceId), hasBoard: false, center, width: BOARD_WIDTH, depth, stations: [], lines: [] }, entries: new Map() });
    z += depth + BOARD_GAP;
  }
  return out;
}

/** A board's plane geometry in its own (u, v) frame, before placement. */
function planeOf(index: BoardIndex): { positions: Map<string, PlanePoint>; uc: number; vc: number; k: number; depth: number } {
  const positions = placeStations(index);
  const vs = [...positions.values()].map((p) => p.v);
  const v0 = Math.min(0, ...vs) - PLANE_V_MARGIN;
  const v1 = Math.max(0, ...vs) + PLANE_V_MARGIN;
  const k = BOARD_WIDTH / (PLANE_U[1] - PLANE_U[0]);
  return { positions, uc: (PLANE_U[0] + PLANE_U[1]) / 2, vc: (v0 + v1) / 2, k, depth: (v1 - v0) * k };
}

function placedBoard(input: DrilldownInput, serviceId: string, index: BoardIndex, plane: ReturnType<typeof planeOf>, center: Vec3): PlacedPlane {
  const at = (p: PlanePoint): Vec3 => [round(center[0] + (p.u - plane.uc) * plane.k), center[1], round(center[2] + (p.v - plane.vc) * plane.k)];
  const graph = buildTrackGraph(index, plane.positions);
  const stations = index.board.stations.map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: at(plane.positions.get(s.id) ?? { u: 0, v: 0 }) }));
  const lines = index.lines.map((line, i) => ({
    lineId: line.id,
    code: line.code,
    colorIndex: i,
    branches: (graph.paths.get(line.id) ?? []).map((path) => bundledPolyline(graph, path, line.id).map(at)),
  }));
  const entries = new Map<string, Vec3>();
  for (const line of index.lines) {
    const route = line.route[0]?.stations ?? [];
    // The entry station: the first one the service owns (a gate, else the first after the caller).
    const entryId = route.find((id) => index.stations.get(id)?.kind === 'gate') ?? route.find((id) => index.stations.get(id)?.kind !== 'caller') ?? route[0];
    const point = entryId ? plane.positions.get(entryId) : undefined;
    if (point) entries.set(line.id, at(point));
  }
  return { board: { serviceDefinitionId: serviceId, name: input.serviceName(serviceId), hasBoard: true, center, width: BOARD_WIDTH, depth: plane.depth, stations, lines }, entries };
}

/** Mean x of the lane's steps on the (centred) flow plane, so a board hangs under its steps. */
function laneCenterX(input: DrilldownInput, serviceId: string): number {
  const xs = input.layout.nodes.filter((n) => n.lane === serviceId).map((n) => n.x + n.width / 2 - input.layout.width / 2);
  return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
}

// ---------------------------------------------------------------------------------------------
// The flow plane over the service planes
// ---------------------------------------------------------------------------------------------

/** Each service lane's band spans its plane's depth along z; the outcomes band follows the last. */
function laneBands(layout: SwimlaneLayout, planes: readonly PlacedPlane[]): Map<string, { z0: number; z1: number }> {
  const bands = new Map<string, { z0: number; z1: number }>();
  for (const { board } of planes) bands.set(board.serviceDefinitionId, { z0: board.center[2] - board.depth / 2, z1: board.center[2] + board.depth / 2 });
  const last = planes.at(-1)?.board;
  const start = last ? last.center[2] + last.depth / 2 + BOARD_GAP : 0;
  if (layout.lanes.some((l) => l.id === OUTCOMES_LANE)) bands.set(OUTCOMES_LANE, { z0: start, z1: start + OUTCOMES_DEPTH });
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

function boundsOf(flowPlane: DrilldownModel['flowPlane'], boards: readonly DrilldownBoard[]): DrilldownModel['bounds'] {
  const xs = [flowPlane.x0, flowPlane.x1, ...boards.flatMap((b) => [b.center[0] - b.width / 2, b.center[0] + b.width / 2])];
  const zs = [flowPlane.z0, flowPlane.z1, ...boards.flatMap((b) => [b.center[2] - b.depth / 2, b.center[2] + b.depth / 2])];
  return { min: [Math.min(...xs), boards.length ? -BOARD_DROP : 0, Math.min(...zs)], max: [Math.max(...xs), 0, Math.max(...zs)] };
}

/** The part of the scene a scope looks at: the whole flow, or one service's plane. */
export function scopeBounds(model: DrilldownModel, serviceDefinitionId: string | null): DrilldownModel['bounds'] {
  const board = serviceDefinitionId ? model.boards.find((b) => b.serviceDefinitionId === serviceDefinitionId) : undefined;
  if (!board) return model.bounds;
  const [x, y, z] = board.center;
  return { min: [x - board.width / 2, y, z - board.depth / 2], max: [x + board.width / 2, y, z + board.depth / 2] };
}

const round = (n: number) => Math.round(n * 10) / 10;
