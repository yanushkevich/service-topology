import type { BusinessFlow, FlowOutcomeKind, FlowStepKind } from '../../../domain/types';
import type { BoardIndex } from '../../../transit/board';
import { lineForStep } from '../../../transit/flows/flowModel';
import { OUTCOMES_LANE, type SwimlaneLayout } from '../../../transit/flows/swimlane';
import { buildTrackGraph, bundledPolyline, placeStations, stopPosition, type PlanePoint } from '../../../transit/layout';
import type { PolicyState, PolicyType, StationKind } from '../../../transit/types';

/**
 * The 3D drill-down's scene model (ADR-026, Milestone 13.1): the flow's swimlane plane on top and,
 * under each service lane, what the flow does inside that service — the lines its steps enter,
 * their stations and policies — on a plane fitted to them and placed under those steps. Services
 * without a board are compact pads. Pure and deterministic: positions come from the swimlane layout
 * and the transit layout's plane coordinates (u, v). World units, y up; the flow plane is at y = 0.
 */

export type Vec3 = readonly [number, number, number];

/** Plane units → world units: one scale for every service, so planes compare. */
export const BOARD_SCALE = 0.47;
/** How far planes hang below the flow plane: at least this, more for a big flow (DROP_RATIO of its extent). */
export const BOARD_DROP = 420;
const DROP_RATIO = 0.3;
/** Margin around what a plane shows, in plane units. */
const PLANE_MARGIN = 70;
/** A service without a board: a pad of this size. */
export const PAD_WIDTH = 240;
export const PAD_DEPTH = 70;
/** Lanes are at least this deep, and this far apart, on the flow plane. */
export const MIN_BAND = 130;
export const BAND_GAP = 60;
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
  /** 'board': the service's transit board (fitted to the flow's lines); 'pad': it has no board yet. */
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
  const bands = laneBands(layout, contents.map((c) => ({ id: c.serviceId, depth: c.footprintDepth })));
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
    return { serviceDefinitionId: l.id, label: l.label, z0: band.z0, z1: band.z1 };
  });
  const flowPlane = { x0: -layout.width / 2 - CAPTION_GUTTER, x1: layout.width / 2, z0: lanes[0]?.z0 ?? 0, z1: bands.get(OUTCOMES_LANE)?.z1 ?? lanes.at(-1)?.z1 ?? 0 };
  const drop = Math.max(BOARD_DROP, round(DROP_RATIO * Math.max(flowPlane.x1 - flowPlane.x0, flowPlane.z1 - flowPlane.z0)));
  const placed = contents.map((c) => placeService(input, c, bands.get(c.serviceId) ?? { z0: 0, z1: 0 }, drop, steps, centeredX));
  const boards = placed.map((p) => p.board);
  const shafts = steps.flatMap((step): DrilldownShaft[] => {
    const service = placed.find((p) => p.board.serviceDefinitionId === step.serviceDefinitionId);
    if (!service) return [];
    const entry = step.lineId ? service.entries.get(step.lineId) : undefined;
    const fallback: Vec3 = [step.position[0], service.board.center[1], clamp(step.position[2], service.board.center[2] - service.board.depth / 2, service.board.center[2] + service.board.depth / 2)];
    const to = entry ?? (service.board.kind === 'pad' ? padTop(service.board, step.position[0]) : fallback);
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
  /** Depth of the footprint in world units (the lane band needs at least this). */
  footprintDepth: number;
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
  if (!index) return { serviceId, index, positions: new Map(), polylines: new Map(), flowLineIds, fitted: EMPTY_BOX, full: EMPTY_BOX, footprintDepth: PAD_DEPTH };
  const positions = placeStations(index);
  const graph = buildTrackGraph(index, positions);
  const polylines = new Map(index.lines.map((line) => [line.id, (graph.paths.get(line.id) ?? []).map((path) => bundledPolyline(graph, path, line.id))]));
  const full = boxOf([...positions.values(), ...[...polylines.values()].flat(2)]);
  const fitted = flowLineIds.size ? boxOf([...flowLineIds].flatMap((id) => (polylines.get(id) ?? []).flat())) : full;
  return { serviceId, index, positions, polylines, flowLineIds, fitted, full, footprintDepth: (fitted.v1 - fitted.v0) * BOARD_SCALE };
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

/** Each service lane's band is as deep as its plane or pad (at least MIN_BAND), in lane order; outcomes follow. */
function laneBands(layout: SwimlaneLayout, services: readonly { id: string; depth: number }[]): Map<string, { z0: number; z1: number }> {
  const bands = new Map<string, { z0: number; z1: number }>();
  let z = 0;
  for (const s of services) {
    const depth = Math.max(MIN_BAND, s.depth);
    bands.set(s.id, { z0: z, z1: z + depth });
    z += depth + BAND_GAP;
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

function placeService(input: DrilldownInput, c: ServiceContent, band: { z0: number; z1: number }, drop: number, steps: readonly DrilldownStep[], centeredX: (n: { x: number; width: number }) => number): PlacedService {
  const name = input.serviceName(c.serviceId);
  const laneSteps = steps.filter((s) => s.serviceDefinitionId === c.serviceId);
  const laneX = mean(input.layout.nodes.filter((n) => n.lane === c.serviceId).map(centeredX)) ?? 0;
  const bandZ = (band.z0 + band.z1) / 2;
  if (!c.index) {
    const pad: Footprint = { center: [round(laneX), -drop, round(bandZ)], width: PAD_WIDTH, depth: PAD_DEPTH };
    return { board: { serviceDefinitionId: c.serviceId, name, kind: 'pad', ...pad, full: pad, stations: [], lines: [], policies: [] }, entries: new Map() };
  }
  const index = c.index;
  const entryIdOf = (lineId: string) => {
    const route = index.lines.find((l) => l.id === lineId)?.route[0]?.stations ?? [];
    // The entry station: the first one the service owns (a gate, else the first after the caller).
    return route.find((id) => index.stations.get(id)?.kind === 'gate') ?? route.find((id) => index.stations.get(id)?.kind !== 'caller') ?? route[0];
  };
  // Under-step placement: the flow lines' entry stations sit under the steps that enter them.
  const mapped = laneSteps.filter((s) => s.lineId !== null);
  const entryUs = mapped.flatMap((s) => {
    const id = s.lineId ? entryIdOf(s.lineId) : undefined;
    const p = id ? c.positions.get(id) : undefined;
    return p ? [p.u] : [];
  });
  const fittedU = (c.fitted.u0 + c.fitted.u1) / 2;
  const fittedV = (c.fitted.v0 + c.fitted.v1) / 2;
  const anchorU = mean(entryUs) ?? fittedU;
  const anchorX = mean(mapped.map((s) => s.position[0])) ?? laneX;
  const at = (p: PlanePoint): Vec3 => [round(anchorX + (p.u - anchorU) * BOARD_SCALE), -drop, round(bandZ + (p.v - fittedV) * BOARD_SCALE)];
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
    const id = entryIdOf(line.id);
    const p = id ? c.positions.get(id) : undefined;
    if (p) entries.set(line.id, at(p));
  }
  return { board: { serviceDefinitionId: c.serviceId, name, kind: 'board', ...footprint(c.fitted), full: footprint(c.full), stations, lines, policies }, entries };
}

/** Where a stub from a step lands on a pad: on its top, under the step as far as the pad reaches. */
function padTop(pad: DrilldownBoard, x: number): Vec3 {
  return [clamp(x, pad.center[0] - pad.width / 2 + 20, pad.center[0] + pad.width / 2 - 20), pad.center[1], pad.center[2]];
}

function boundsOf(flowPlane: DrilldownModel['flowPlane'], boards: readonly DrilldownBoard[], drop: number): DrilldownModel['bounds'] {
  const xs = [flowPlane.x0, flowPlane.x1, ...boards.flatMap((b) => [b.center[0] - b.width / 2, b.center[0] + b.width / 2])];
  const zs = [flowPlane.z0, flowPlane.z1, ...boards.flatMap((b) => [b.center[2] - b.depth / 2, b.center[2] + b.depth / 2])];
  return { min: [Math.min(...xs), boards.length ? -drop : 0, Math.min(...zs)], max: [Math.max(...xs), 0, Math.max(...zs)] };
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
