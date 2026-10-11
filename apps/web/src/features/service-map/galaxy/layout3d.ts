import type { GalaxyGroup, GalaxyScopeModel } from './scope';

/**
 * Deterministic 3D placement for a galaxy scope (spec §7). Same model → same positions; no
 * randomness, no dependence on render order. Plain tuples only (no Three.js types), so it is
 * testable without WebGL and the renderer stays a thin adapter.
 */

export const LAYOUT3D_VERSION = 2;

export type Vec3 = readonly [number, number, number];

export interface RingLayout {
  /** Group this ring belongs to. */
  id: string;
  center: Vec3;
  radius: number;
  /** Euler rotation (x, z) of the ring plane. */
  tilt: readonly [number, number];
  kind: GalaxyGroup['kind'] | 'scope-shell';
}

export interface GalaxyLayout {
  positions: Readonly<Record<string, Vec3>>;
  /** Visual radius of each node (for spacing and picking). */
  radii: Readonly<Record<string, number>>;
  rings: RingLayout[];
  /** Radius of a sphere around the origin containing everything (camera fit). */
  extent: number;
}

export const NODE_RADIUS = { core: 16, center: 22, member: 9, child: 12, grandchild: 8, outside: 9 } as const;
const MIN_GAP = 10;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Small stable hash → [0, 1). */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Point on a ring of `radius` around `center`, rotated by tilt (x then z), at angle `a`. */
export function ringPoint(center: Vec3, radius: number, tilt: readonly [number, number], a: number): Vec3 {
  const x = radius * Math.cos(a);
  const z = radius * Math.sin(a);
  // rotate around X by tilt[0]
  const y1 = -z * Math.sin(tilt[0]);
  const z1 = z * Math.cos(tilt[0]);
  // rotate around Z by tilt[1]
  const x2 = x * Math.cos(tilt[1]) - y1 * Math.sin(tilt[1]);
  const y2 = x * Math.sin(tilt[1]) + y1 * Math.cos(tilt[1]);
  return [round(center[0] + x2), round(center[1] + y2), round(center[2] + z1)];
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Ring radius that fits `count` nodes of `nodeRadius` with gaps. */
function ringRadius(count: number, nodeRadius: number, minimum: number): number {
  return Math.max(minimum, (count * (2 * nodeRadius + MIN_GAP + 6)) / (2 * Math.PI));
}

/**
 * Members on concentric tilted rings (max per ring grows with radius), so even a 100-member
 * constellation stays readable. Returns positions and the ring list.
 */
function placeOnRings(
  center: Vec3,
  ids: readonly string[],
  nodeRadius: number,
  tilt: readonly [number, number],
  phase: number,
  groupId: string,
  kind: GalaxyGroup['kind'],
  innerMinimum: number,
): { positions: Record<string, Vec3>; rings: RingLayout[]; outer: number } {
  const positions: Record<string, Vec3> = {};
  const rings: RingLayout[] = [];
  let radius = innerMinimum;
  let index = 0;
  let ring = 0;
  while (index < ids.length) {
    const capacity = Math.max(6, Math.floor((2 * Math.PI * radius) / (2 * nodeRadius + MIN_GAP + 6)));
    const count = Math.min(capacity, ids.length - index);
    const r = ring === 0 ? Math.max(radius, ringRadius(count, nodeRadius, innerMinimum)) : radius;
    for (let i = 0; i < count; i++) {
      positions[ids[index + i] as string] = ringPoint(center, r, tilt, (i / count) * 2 * Math.PI + phase + ring * 0.37);
    }
    rings.push({ id: `${groupId}#${ring}`, center, radius: round(r), tilt, kind });
    index += count;
    radius = r + 2 * nodeRadius + MIN_GAP + 14;
    ring++;
  }
  return { positions, rings, outer: rings.length ? (rings[rings.length - 1]?.radius ?? innerMinimum) : innerMinimum };
}

function layoutOverview(model: GalaxyScopeModel): GalaxyLayout {
  const positions: Record<string, Vec3> = {};
  const radii: Record<string, number> = {};
  const rings: RingLayout[] = [];
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

  // 1. Size each constellation: its anchor/aggregate at the center, members on rings.
  const clusters = model.groups.map((group, i) => {
    const members = group.memberIds.filter((id) => nodeById.has(id) && id !== group.coreId);
    const outer = members.length === 0 ? NODE_RADIUS.core : ringRadius(Math.min(members.length, 14), NODE_RADIUS.member, 60);
    // Estimate total extent including extra rings.
    const extraRings = Math.max(0, Math.ceil(members.length / 14) - 1);
    const extent = outer + extraRings * (2 * NODE_RADIUS.member + MIN_GAP + 14) + NODE_RADIUS.member;
    return { group, members, extent, order: i };
  });

  // 2. Place constellation centers on a flattened golden-angle spiral (a galaxy disk, not a globe).
  const centers: [number, number, number][] = [];
  let cumulative = 0;
  clusters.forEach((c, i) => {
    cumulative += c.extent;
    const distance = i === 0 ? 0 : cumulative * 1.3 + 120;
    const angle = i * GOLDEN * 2.4;
    const lift = (hash01(c.group.id) - 0.5) * Math.min(320, c.extent * 1.6);
    centers.push([distance * Math.cos(angle), lift, distance * Math.sin(angle)]);
  });

  // 3. Deterministic relaxation: push overlapping constellation spheres apart.
  for (let iteration = 0; iteration < 60; iteration++) {
    let moved = false;
    for (let a = 0; a < centers.length; a++) {
      for (let b = a + 1; b < centers.length; b++) {
        const ca = centers[a] as [number, number, number];
        const cb = centers[b] as [number, number, number];
        const dx = cb[0] - ca[0];
        const dy = cb[1] - ca[1];
        const dz = cb[2] - ca[2];
        const distance = Math.hypot(dx, dy, dz) || 1;
        const needed = (clusters[a]?.extent ?? 0) + (clusters[b]?.extent ?? 0) + 140;
        if (distance < needed) {
          const push = (needed - distance) / 2;
          const [ux, uy, uz] = distance === 1 && dx === 0 && dz === 0 ? [1, 0, 0] : [dx / distance, dy / distance, dz / distance];
          ca[0] -= ux * push;
          ca[1] -= uy * push * 0.5;
          ca[2] -= uz * push;
          cb[0] += ux * push;
          cb[1] += uy * push * 0.5;
          cb[2] += uz * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // 4. Center the whole galaxy and place members.
  const mean = centers.reduce((acc, c) => [acc[0] + c[0] / centers.length, acc[1] + c[1] / centers.length, acc[2] + c[2] / centers.length], [0, 0, 0]);
  clusters.forEach((c, i) => {
    const raw = centers[i] as [number, number, number];
    const center: Vec3 = [round(raw[0] - (mean[0] ?? 0)), round(raw[1] - (mean[1] ?? 0)), round(raw[2] - (mean[2] ?? 0))];
    const tilt: readonly [number, number] = [0.25 + hash01(`${c.group.id}:x`) * 0.5, (hash01(`${c.group.id}:z`) - 0.5) * 0.5];
    const coreId = c.group.coreId ?? (model.aggregated ? c.group.id : undefined);
    if (coreId && nodeById.has(coreId)) {
      positions[coreId] = center;
      radii[coreId] = NODE_RADIUS.core;
    }
    if (c.members.length > 0) {
      const placed = placeOnRings(center, c.members, NODE_RADIUS.member, tilt, hash01(c.group.id) * Math.PI, c.group.id, 'constellation', 60);
      Object.assign(positions, placed.positions);
      for (const id of c.members) radii[id] = NODE_RADIUS.member;
      rings.push(...placed.rings);
    }
  });
  return finish(positions, radii, rings);
}

function layoutEntity(model: GalaxyScopeModel): GalaxyLayout {
  const positions: Record<string, Vec3> = {};
  const radii: Record<string, number> = {};
  const rings: RingLayout[] = [];
  const center = model.nodes.find((n) => n.role === 'center');
  if (!center) return finish(positions, radii, rings);
  positions[center.id] = [0, 0, 0];
  radii[center.id] = NODE_RADIUS.center;

  const children = model.nodes.filter((n) => n.role === 'child').map((n) => n.id);
  const subGroups = new Map(model.groups.filter((g) => g.kind === 'grandchildren').map((g) => [g.coreId as string, g.memberIds]));
  // With one or two children there is room to spread their contents; otherwise keep sub-rings compact.
  const subMinimum = children.length <= 2 ? 120 : 46;
  const subRadius = (childId: string) => {
    const kids = subGroups.get(childId) ?? [];
    return kids.length === 0
      ? NODE_RADIUS.child
      : ringRadius(Math.min(kids.length, 12), NODE_RADIUS.grandchild, subMinimum) + (Math.ceil(kids.length / 12) - 1) * 30;
  };
  const maxSub = Math.max(NODE_RADIUS.child, ...children.map(subRadius));
  const tilt: readonly [number, number] = [0.42, 0.12];
  const R1 = Math.max(150, (children.length * (2 * maxSub + 40)) / (2 * Math.PI));
  if (children.length > 0) rings.push({ id: `children:${center.id}`, center: [0, 0, 0], radius: round(R1), tilt, kind: 'children' });
  children.forEach((childId, i) => {
    const p = ringPoint([0, 0, 0], R1, tilt, (i / children.length) * 2 * Math.PI + 0.6);
    positions[childId] = p;
    radii[childId] = NODE_RADIUS.child;
    const kids = subGroups.get(childId) ?? [];
    if (kids.length > 0) {
      const subTilt: readonly [number, number] = [0.92, -0.4 + i * 0.7];
      const placed = placeOnRings(p, kids, NODE_RADIUS.grandchild, subTilt, i * 0.9, `sub:${childId}`, 'grandchildren', subMinimum);
      Object.assign(positions, placed.positions);
      for (const id of kids) radii[id] = NODE_RADIUS.grandchild;
      rings.push(...placed.rings);
    }
  });

  // Outside partners on side arcs: inbound left, outbound right (mock layout).
  const inner = children.length > 0 ? R1 + maxSub : NODE_RADIUS.center + 40;
  const side = inner + 170;
  const place = (ids: string[], sign: 1 | -1) => {
    const columns = Math.ceil(ids.length / 14);
    ids.forEach((id, i) => {
      const column = Math.floor(i / 14);
      const inColumn = Math.min(14, ids.length - column * 14);
      const k = i % 14;
      const spread = Math.max(1, inColumn - 1);
      // Spread up and *towards* the default camera (whose view vector is ≈ (−0.39, 0.58, 0.71)): the
      // column direction (0, 0.75, −0.9) is nearly perpendicular to it, so partners stay apart on screen.
      const step = (k - (inColumn - 1) / 2) * Math.min(56, (2 * side) / spread);
      const y = step * 0.75;
      const z = -step * 0.9 + (column - (columns - 1) / 2) * 70;
      positions[id] = [round(sign * (side + column * 40)), round(y), round(z)];
      radii[id] = NODE_RADIUS.outside;
    });
  };
  place(model.nodes.filter((n) => n.role === 'inbound').map((n) => n.id), -1);
  place(model.nodes.filter((n) => n.role === 'outbound').map((n) => n.id), 1);

  // Scope boundary: two crossing shells around everything inside (containment, not traffic).
  const shell = Math.max(inner + 30, 120);
  rings.push({ id: `shell:${center.id}:a`, center: [0, 0, 0], radius: round(shell), tilt: [1.25, 0.3], kind: 'scope-shell' });
  rings.push({ id: `shell:${center.id}:b`, center: [0, 0, 0], radius: round(shell), tilt: [0.15, -0.5], kind: 'scope-shell' });
  return finish(positions, radii, rings);
}

function finish(positions: Record<string, Vec3>, radii: Record<string, number>, rings: RingLayout[]): GalaxyLayout {
  const extent = Math.max(
    100,
    ...Object.entries(positions).map(([id, p]) => Math.hypot(p[0], p[1], p[2]) + (radii[id] ?? 0)),
    ...rings.map((r) => Math.hypot(r.center[0], r.center[1], r.center[2]) + r.radius),
  );
  return { positions, radii, rings, extent: round(extent) };
}

export function layoutGalaxy(model: GalaxyScopeModel): GalaxyLayout {
  return model.kind === 'overview' ? layoutOverview(model) : layoutEntity(model);
}
