import type { TopologyIndex } from '../../../domain/topologyIndex';
import { reachFrom, type HighlightMode } from '../../../domain/traversal';
import type { EntityRef, HealthStatus, RelationshipStatus } from '../../../domain/types';
import type { EdgeKind } from '../../../shared/mappings';
import type { GalaxyLayout, RingLayout, Vec3 } from './layout3d';
import type { GalaxyNodeRole, GalaxyScopeModel } from './scope';

/**
 * Renderer view models for the galaxy (spec §6): positions, emphasis, label level-of-detail,
 * curved edge geometry, direction markers, and data-bound traffic. Pure; IDs are canonical.
 */

export type SceneEmphasis = 'none' | 'selected' | 'highlighted' | 'dimmed';
export type LabelMode = 'auto' | 'all' | 'minimal';

export interface SceneNode {
  id: string;
  ref: EntityRef | null;
  name: string;
  type: string;
  health: HealthStatus;
  role: GalaxyNodeRole;
  position: Vec3;
  radius: number;
  emphasis: SceneEmphasis;
  /**
   * Label level-of-detail: `always` (anchors, selection, highlight, problems), `near` (only when the
   * camera is close: keeps dense scopes readable), `hover` (only on hover/focus).
   */
  labelLevel: 'always' | 'near' | 'hover';
  memberCount: number;
  hasChildren: boolean;
  outside: boolean;
  ariaLabel: string;
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  status: RelationshipStatus;
  bidirectional: boolean;
  relationshipIds: readonly string[];
  /** Curve samples from source surface to target surface. */
  points: Vec3[];
  /** Direction markers: position + unit direction (towards the receiving end). */
  arrows: { position: Vec3; direction: Vec3 }[];
  emphasis: SceneEmphasis;
  /** Particles per second bound to relationship throughput; null when no traffic field exists. */
  trafficRate: number | null;
  trafficSimulated: boolean;
}

export interface SceneContainmentLink {
  id: string;
  from: Vec3;
  to: Vec3;
}

export interface SceneModel {
  nodes: SceneNode[];
  edges: SceneEdge[];
  containment: SceneContainmentLink[];
  rings: RingLayout[];
  extent: number;
  highlightActive: boolean;
}

export interface SceneOptions {
  selection: EntityRef | null;
  highlightMode: HighlightMode;
  labelMode: LabelMode;
}

/** Below this many nodes every label is shown in auto mode. */
export const AUTO_LABEL_LIMIT = 16;
/** Camera distance (world units) under which `near` labels appear. */
export const NEAR_LABEL_DISTANCE = 560;
export const CURVE_SEGMENTS = 16;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r2 = (v: Vec3): Vec3 => [Math.round(v[0] * 100) / 100, Math.round(v[1] * 100) / 100, Math.round(v[2] * 100) / 100];

function bezier(p0: Vec3, c: Vec3, p1: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return add(add(scale(p0, u * u), scale(c, 2 * u * t)), scale(p1, t * t));
}
function bezierTangent(p0: Vec3, c: Vec3, p1: Vec3, t: number): Vec3 {
  return normalize(add(scale(sub(c, p0), 2 * (1 - t)), scale(sub(p1, c), 2 * t)));
}

/** Curved path between two node surfaces; reverse directions of a pair bend to opposite sides. */
export function edgeCurve(a: Vec3, ra: number, b: Vec3, rb: number, bendSign: 1 | -1) {
  const dir = normalize(sub(b, a));
  const start = add(a, scale(dir, ra + 2));
  const end = sub(b, scale(dir, rb + 2));
  const span = length(sub(end, start));
  let side = cross(dir, [0, 1, 0]);
  if (length(side) < 0.1) side = cross(dir, [1, 0, 0]);
  const lift = add(scale(normalize(side), 0.16 * span * bendSign), [0, 0.08 * span, 0]);
  const control = add(scale(add(start, end), 0.5), lift);
  const points = Array.from({ length: CURVE_SEGMENTS + 1 }, (_, i) => r2(bezier(start, control, end, i / CURVE_SEGMENTS)));
  return { start, end, control, points };
}

/** Particles/second from throughput: log-scaled, bounded, only when a traffic field exists. */
export function trafficRate(throughputPerSecond: number | undefined): number | null {
  if (throughputPerSecond === undefined || throughputPerSecond <= 0) return null;
  return Math.round(Math.min(2.5, Math.max(0.3, Math.log10(throughputPerSecond + 1) * 0.6)) * 100) / 100;
}

export interface MotionPolicy {
  /** Animate traffic particles. */
  particles: boolean;
  /** Camera transition length; 0 = cut. */
  transitionSeconds: number;
}

/** Reduced motion → no particles, instant camera cuts. Pause → no particles; camera stays usable. */
export function motionPolicy({ reducedMotion, paused, particlesEnabled }: { reducedMotion: boolean; paused: boolean; particlesEnabled: boolean }): MotionPolicy {
  return {
    particles: particlesEnabled && !paused && !reducedMotion,
    transitionSeconds: reducedMotion ? 0 : 0.8,
  };
}

const ROLE_LABEL: Record<GalaxyNodeRole, string> = {
  core: 'constellation',
  member: '',
  center: 'current scope',
  child: 'inside',
  grandchild: 'inside',
  inbound: 'outside current scope, sends into it',
  outbound: 'outside current scope, receives from it',
};

export function buildScene(index: TopologyIndex, model: GalaxyScopeModel, layout: GalaxyLayout, options: SceneOptions): SceneModel {
  // Highlight: the selection's reach under the shared highlight mode, mapped onto displayed nodes.
  const selectedId = options.selection?.id;
  const selectedNode = selectedId ? model.nodes.find((n) => n.id === selectedId || n.memberIds.includes(selectedId)) : undefined;
  const selectedEdge = selectedId ? model.edges.find((e) => e.relationshipIds.includes(selectedId)) : undefined;
  const highlightedNodes = new Set<string>();
  const highlightedEdges = new Set<string>();
  if (selectedNode) {
    const reach = selectedNode.memberIds.map((id) => reachFrom(index, id, options.highlightMode));
    const entities = new Set(reach.flatMap((r) => [...r.entityIds]));
    const relationships = new Set(reach.flatMap((r) => [...r.relationshipIds]));
    for (const n of model.nodes) if (n.memberIds.some((id) => entities.has(id))) highlightedNodes.add(n.id);
    for (const e of model.edges) if (e.relationshipIds.some((id) => relationships.has(id))) highlightedEdges.add(e.id);
  } else if (selectedEdge) {
    highlightedEdges.add(selectedEdge.id);
    highlightedNodes.add(selectedEdge.source).add(selectedEdge.target);
  }
  const highlightActive = Boolean(selectedNode || selectedEdge);
  const emphasisOf = (id: string, isSelected: boolean, set: Set<string>): SceneEmphasis =>
    isSelected ? 'selected' : !highlightActive ? 'none' : set.has(id) ? 'highlighted' : 'dimmed';

  const small = model.nodes.length <= AUTO_LABEL_LIMIT;
  const nodes: SceneNode[] = model.nodes.map((n) => {
    const emphasis = emphasisOf(n.id, n.id === selectedNode?.id, highlightedNodes);
    const important =
      n.role === 'center' || n.role === 'core' || n.role === 'child' || emphasis === 'selected' || emphasis === 'highlighted';
    const problem = n.health === 'unavailable' || n.health === 'degraded';
    const labelLevel: SceneNode['labelLevel'] =
      options.labelMode === 'all'
        ? 'always'
        : options.labelMode === 'minimal'
          ? n.role === 'center' || emphasis === 'selected'
            ? 'always'
            : 'hover'
          : important || problem || small
            ? 'always'
            : 'near';
    const extra = [ROLE_LABEL[n.role], n.memberCount > 1 ? `${n.memberCount} entities` : '', n.hasChildren ? 'has modeled children' : '']
      .filter(Boolean)
      .join(', ');
    return {
      id: n.id,
      ref: n.ref,
      name: n.name,
      type: n.type,
      health: n.health,
      role: n.role,
      position: layout.positions[n.id] ?? [0, 0, 0],
      radius: layout.radii[n.id] ?? 8,
      emphasis,
      labelLevel,
      memberCount: n.memberCount,
      hasChildren: n.hasChildren,
      outside: n.role === 'inbound' || n.role === 'outbound',
      ariaLabel: `${n.name}, ${n.type}, health ${n.health}${extra ? `, ${extra}` : ''}`,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: SceneEdge[] = model.edges.flatMap((e) => {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) return [];
    const bend: 1 | -1 = e.bidirectional && e.source > e.target ? -1 : 1;
    const curve = edgeCurve(a.position, a.radius, b.position, b.radius, bend);
    const arrowAt = (t: number, reverse: boolean) => {
      const tangent = bezierTangent(curve.start, curve.control, curve.end, t);
      return { position: r2(bezier(curve.start, curve.control, curve.end, t)), direction: r2(reverse ? scale(tangent, -1) : tangent) };
    };
    const emphasis = emphasisOf(e.id, e.id === selectedEdge?.id, highlightedEdges);
    return [
      {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        status: e.status,
        bidirectional: e.bidirectional,
        relationshipIds: e.relationshipIds,
        points: curve.points,
        arrows: e.bidirectional ? [arrowAt(0.86, false), arrowAt(0.14, true)] : [arrowAt(0.86, false)],
        emphasis,
        trafficRate: trafficRate(e.throughputPerSecond),
        trafficSimulated: e.trafficSimulated,
      },
    ];
  });

  const containment: SceneContainmentLink[] = model.containment.flatMap((link) => {
    const a = byId.get(link.parentId);
    const b = byId.get(link.childId);
    if (!a || !b) return [];
    const dir = normalize(sub(b.position, a.position));
    return [{ id: `${link.parentId}>${link.childId}`, from: r2(add(a.position, scale(dir, a.radius))), to: r2(sub(b.position, scale(dir, b.radius))) }];
  });

  return { nodes, edges, containment, rings: layout.rings, extent: layout.extent, highlightActive };
}
