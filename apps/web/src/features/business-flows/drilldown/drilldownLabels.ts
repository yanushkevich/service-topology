import type { LabelAnchor } from '../../service-map/galaxy/labelLayer';
import type { DrilldownBoard, DrilldownModel, DrilldownStation, DrilldownStep, Vec3 } from './drilldownModel';

/**
 * Where the drill-down's labels sit, and which keeps its place when they overlap (the shared
 * LabelLayer declutter): the selected step, then steps, then planes and outcomes, then stations.
 * The scene draws each label at these same anchors.
 */

export const stepLabelAnchor = (step: DrilldownStep): Vec3 => [step.position[0], step.position[1] + 24, step.position[2]];
/** A plane's name, centred on its back edge. */
export const boardLabelAnchor = (board: DrilldownBoard): Vec3 => [board.center[0], board.center[1], board.center[2] - board.depth / 2];
export const stationLabelAnchor = (station: DrilldownStation): Vec3 => [station.position[0], station.position[1] + 12, station.position[2]];

export function labelAnchors(model: DrilldownModel, selectedStepId: string | null, scope: string | null): LabelAnchor[] {
  const steps = model.steps.map((s) => ({ id: `step:${s.id}`, position: stepLabelAnchor(s), priority: s.id === selectedStepId ? 0 : 1 }));
  const boards = model.boards.map((b) => ({ id: `board:${b.serviceDefinitionId}`, position: boardLabelAnchor(b), priority: b.serviceDefinitionId === scope ? 0 : 2 }));
  const entered = model.boards.find((b) => b.serviceDefinitionId === scope);
  const stations = (entered?.stations ?? []).map((s) => ({ id: `station:${s.id}`, position: stationLabelAnchor(s), priority: 3 }));
  return [...steps, ...boards, ...stations];
}
