import type { Footprint, Vec3 } from './drilldownModel';

/**
 * Small pure geometry helpers for the drill-down scene: arrowheads, outlines, and plane grids, as
 * points and segments (drei Line takes `[x, y, z][]`). Tested without WebGL.
 */

export type Point3 = [number, number, number];

/** The last segment of each polyline: where its arrowhead sits and which way it points (unit vector). */
export function arrowHeads(polylines: readonly (readonly Vec3[])[], lift = 2): { position: Point3; direction: Point3 }[] {
  return polylines.flatMap((points) => {
    const b = points.at(-1);
    const a = [...points].reverse().find((p) => b && (p[0] !== b[0] || p[2] !== b[2]));
    if (!a || !b) return [];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const length = Math.hypot(dx, dz) || 1;
    return [{ position: [b[0], b[1] + lift, b[2]], direction: [dx / length, 0, dz / length] }];
  });
}

/** A footprint's outline as a closed polyline, `lift` above it. */
export function outline(f: Footprint, lift = 0.5): Point3[] {
  const [x, y, z] = f.center;
  const hw = f.width / 2;
  const hd = f.depth / 2;
  return [
    [x - hw, y + lift, z - hd],
    [x + hw, y + lift, z - hd],
    [x + hw, y + lift, z + hd],
    [x - hw, y + lift, z + hd],
    [x - hw, y + lift, z - hd],
  ];
}

/** Grid lines across a footprint every `spacing` units, as segment pairs (for a segmented Line). */
export function gridSegments(f: Footprint, spacing: number, lift = 0.3): Point3[] {
  const [x, y, z] = f.center;
  const x0 = x - f.width / 2;
  const x1 = x + f.width / 2;
  const z0 = z - f.depth / 2;
  const z1 = z + f.depth / 2;
  const out: Point3[] = [];
  for (let gx = Math.ceil(x0 / spacing) * spacing; gx < x1; gx += spacing) out.push([gx, y + lift, z0], [gx, y + lift, z1]);
  for (let gz = Math.ceil(z0 / spacing) * spacing; gz < z1; gz += spacing) out.push([x0, y + lift, gz], [x1, y + lift, gz]);
  return out;
}

/** Polylines as segment pairs, `lift` above their plane. */
export function segmentsOf(polylines: readonly (readonly Vec3[])[], lift = 0): Point3[] {
  return polylines.flatMap((points) => points.slice(1).flatMap((b, i) => {
    const a = points[i] ?? b;
    return [[a[0], a[1] + lift, a[2]] as Point3, [b[0], b[1] + lift, b[2]] as Point3];
  }));
}
