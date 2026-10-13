import type { DrilldownModel, DrilldownShaft, Vec3 } from './drilldownModel';

/**
 * Camera poses and replay particle positions for the 3D drill-down. Pure: the scene applies them
 * (camera transitions in CameraControls, particles from the playback clock), so they are tested
 * without WebGL.
 */

export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** The drill-down's camera lens: narrow, so verticals stay nearly parallel and the view reads like a diagram. */
export const DRILLDOWN_FOV = 28;

/**
 * Look at a box from in front and above (+z is "down the page", as in 2D), centred, at the distance
 * where it fills the view for this lens and aspect: about 40° down onto the stacked flow, so the
 * layers separate, and 55° onto a single plane, so it reads like the 2D board.
 */
export function poseFor(bounds: DrilldownModel['bounds'], view: { fov?: number; aspect?: number } = {}): Pose {
  const fov = ((view.fov ?? DRILLDOWN_FOV) * Math.PI) / 180;
  const aspect = view.aspect ?? 1.6;
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const target: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const width = Math.max(x1 - x0, 200);
  const depth = Math.max(z1 - z0, 100);
  const height = y1 - y0;
  const elevation = ((height > 1 ? 40 : 55) * Math.PI) / 180;
  // Extent across the screen, and up the screen (the depth foreshortened, plus the drop).
  const across = width / 2 / (Math.tan(fov / 2) * aspect);
  const up = (depth * Math.sin(elevation) + height * Math.cos(elevation)) / 2 / Math.tan(fov / 2);
  const distance = Math.max(across, up) * 1.08;
  return { target, position: [target[0], target[1] + distance * Math.sin(elevation), target[2] + distance * Math.cos(elevation)] };
}

/**
 * Where a replay particle is on a step's shaft: down to the service's line in the first half of the
 * step, back up in the second. `progress` is 0..1 through the step on the replay clock; with
 * reduced motion the particle rests at the station.
 */
export function particleOnShaft(shaft: Pick<DrilldownShaft, 'from' | 'to'>, progress: number, reduced: boolean): Vec3 {
  const p = Math.min(1, Math.max(0, progress));
  const depth = reduced ? 1 : 1 - Math.abs(1 - 2 * p);
  const lerp = (a: number, b: number) => a + (b - a) * depth;
  return [lerp(shaft.from[0], shaft.to[0]), lerp(shaft.from[1], shaft.to[1]), lerp(shaft.from[2], shaft.to[2])];
}
