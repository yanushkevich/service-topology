import type { LabelAnchor } from '../../service-map/galaxy/labelLayer';
import type { DrilldownBoard, DrilldownLane, DrilldownModel, DrilldownOutcome, DrilldownStation, DrilldownStep, Vec3 } from './drilldownModel';

/**
 * Where the drill-down's labels sit, and which keeps its place when they overlap (the shared
 * LabelLayer declutter): the selected step and the entered plane first, then steps, then lane
 * captions, plane names, and outcomes, then stations. The scene draws each label at these anchors.
 */

/** Height of a step tile; its label sits just above it. */
export const STEP_TILE_HEIGHT = 14;
export const stepLabelAnchor = (step: DrilldownStep): Vec3 => [step.position[0], step.position[1] + STEP_TILE_HEIGHT + 16, step.position[2]];
export const outcomeLabelAnchor = (outcome: DrilldownOutcome): Vec3 => [outcome.position[0], outcome.position[1] + 30, outcome.position[2]];
/** A plane's name, centred just in front of its front edge (nearest the camera). */
export const boardLabelAnchor = (board: DrilldownBoard): Vec3 => [board.center[0], board.center[1], board.center[2] + board.depth / 2 + 18];
export const stationLabelAnchor = (station: DrilldownStation): Vec3 => [station.position[0], station.position[1] + 16, station.position[2]];
/** A lane's caption, in the gutter on the left of the flow plane, at the lane's middle. */
export const laneLabelAnchor = (model: DrilldownModel, lane: DrilldownLane): Vec3 => [model.flowPlane.x0 + 120, 2, (lane.z0 + lane.z1) / 2];

export interface LabelFocus {
  selectedStepId: string | null;
  /** The entered service, if any: only its stations are labelled. */
  scope: string | null;
  /** Label every station of the entered service, not only those on the flow's lines. */
  allLines: boolean;
}

export function labelAnchors(model: DrilldownModel, focus: LabelFocus): LabelAnchor[] {
  const steps = model.steps.map((s) => ({ id: `step:${s.id}`, position: stepLabelAnchor(s), priority: s.id === focus.selectedStepId ? 0 : 1 }));
  const lanes = model.lanes.map((l) => ({ id: `lane:${l.serviceDefinitionId}`, position: laneLabelAnchor(model, l), priority: 2 }));
  const boards = model.boards.map((b) => ({ id: `board:${b.serviceDefinitionId}`, position: boardLabelAnchor(b), priority: b.serviceDefinitionId === focus.scope ? 0 : 2 }));
  const outcomes = model.outcomes.map((o) => ({ id: `outcome:${o.id}`, position: outcomeLabelAnchor(o), priority: 2 }));
  const entered = model.boards.find((b) => b.serviceDefinitionId === focus.scope);
  const stations = (entered?.stations ?? []).filter((s) => focus.allLines || s.inFlow).map((s) => ({ id: `station:${s.id}`, position: stationLabelAnchor(s), priority: 3 }));
  return [...steps, ...lanes, ...boards, ...outcomes, ...stations];
}
