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

/** Look at a box from above and in front (+z is "down the page", as in 2D), far enough to see all of it. */
export function poseFor(bounds: DrilldownModel['bounds']): Pose {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const target: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const span = Math.max(x1 - x0, z1 - z0, y1 - y0, 200);
  const distance = span * 0.95 + 120;
  return { target, position: [target[0], target[1] + distance * 0.72, target[2] + distance * 0.7] };
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
