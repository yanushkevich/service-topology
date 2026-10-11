import type { Vec3 } from './layout3d';

/** Camera placement helpers (plain tuples; the rig applies them to Three.js objects). */

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

/** Default viewing angle: the mock's yaw (−0.5) with a higher pitch so the galaxy disk reads from above. */
const DEFAULT_DIRECTION: Vec3 = (() => {
  const yaw = -0.5;
  const pitch = 0.62;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
})();

const round = (v: number) => Math.round(v * 100) / 100;

/** Frame a scope of radius `extent` around the origin with the default angle and FOV. */
export function fitPose(extent: number, fovDegrees = 50, center: Vec3 = [0, 0, 0]): CameraPose {
  const distance = (extent / Math.sin(((fovDegrees / 2) * Math.PI) / 180)) * 1.08;
  return {
    target: center,
    position: [
      round(center[0] + DEFAULT_DIRECTION[0] * distance),
      round(center[1] + DEFAULT_DIRECTION[1] * distance),
      round(center[2] + DEFAULT_DIRECTION[2] * distance),
    ],
  };
}

/** Bring a node to the center, keeping the current viewing direction, at a readable distance. */
export function focusPose(current: CameraPose, node: Vec3, radius: number): CameraPose {
  const dx = current.position[0] - current.target[0];
  const dy = current.position[1] - current.target[1];
  const dz = current.position[2] - current.target[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  const distance = Math.max(160, radius * 9);
  return {
    target: node,
    position: [round(node[0] + (dx / length) * distance), round(node[1] + (dy / length) * distance), round(node[2] + (dz / length) * distance)],
  };
}

/** Dive-in: fly almost into the node before the scope switches. */
export function approachPose(current: CameraPose, node: Vec3, radius: number): CameraPose {
  const pose = focusPose(current, node, radius);
  const k = (radius * 2.2) / Math.max(1, Math.hypot(pose.position[0] - node[0], pose.position[1] - node[1], pose.position[2] - node[2]));
  return {
    target: node,
    position: [round(node[0] + (pose.position[0] - node[0]) * k), round(node[1] + (pose.position[1] - node[1]) * k), round(node[2] + (pose.position[2] - node[2]) * k)],
  };
}

/**
 * Camera context per scope path, so "Back", breadcrumbs, and "Overview" restore where the user was
 * (ARCHITECTURE Revision 4). Lives with the renderer; poses are plain numbers.
 */
export class CameraMemory {
  private readonly poses = new Map<string, CameraPose>();

  static key(path: readonly string[]): string {
    return path.join('/') || '(overview)';
  }

  save(path: readonly string[], pose: CameraPose): void {
    this.poses.set(CameraMemory.key(path), pose);
  }

  restore(path: readonly string[]): CameraPose | undefined {
    return this.poses.get(CameraMemory.key(path));
  }

  /** Forget scopes deeper than `path` (they will be re-entered fresh). */
  forgetBelow(path: readonly string[]): void {
    const prefix = CameraMemory.key(path);
    for (const key of [...this.poses.keys()]) {
      if (key !== prefix && (path.length === 0 ? key !== '(overview)' : key.startsWith(`${prefix}/`))) this.poses.delete(key);
    }
  }
}
