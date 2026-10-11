import { buildRegistryRows, matchesFilters, type EntityFilters, type RegistryRow } from '../../../domain/registry';
import { resourceAncestors, type TopologyIndex } from '../../../domain/topologyIndex';
import type { EntityId, EntityRef, HealthStatus, Provider, RelationshipStatus } from '../../../domain/types';
import { CONTAINMENT_ONLY_RESOURCE_TYPES } from '../../../domain/types';
import { edgeKind, type EdgeKind } from '../../../shared/mappings';
import type { Neighborhood } from '../../../state/uiStore';
import { buildTopologyGraph } from '../graph/topologyGraph';

/**
 * 3D scope model (docs/3D_GALAXY_EXPERIENCE.md §4, ARCHITECTURE Revision 4). Renderer-agnostic:
 * resolves which canonical entities a scope shows, keeping containment (spokes/rings) separate
 * from communication (paths). Never invents children: an entity without modeled children gets a
 * leaf scope that shows its real communication neighborhood instead.
 */

export type GalaxyNodeRole =
  /** Overview: a constellation's anchor (outermost containing resource). */
  | 'core'
  /** Overview: an entity in a constellation. */
  | 'member'
  /** Entity scope: the entity being explored. */
  | 'center'
  /** Contained directly by the center (or an instance of a logical service). */
  | 'child'
  /** Contained by a child (one more level, shown on a sub-ring). */
  | 'grandchild'
  /** Outside the scope, calls/sends into it. */
  | 'inbound'
  /** Outside the scope, called by / receives from it. */
  | 'outbound';

export interface GalaxyNode {
  id: string;
  ref: EntityRef | null;
  name: string;
  /** Service category or resource type (drives the silhouette). */
  type: string;
  health: HealthStatus;
  provider: Provider;
  role: GalaxyNodeRole;
  /** Constellation (overview) or containing node (scope). */
  groupId: string | undefined;
  /** >1 for an aggregated constellation in a large overview. */
  memberCount: number;
  /** Canonical entities this node stands for. */
  memberIds: readonly EntityId[];
  /** Has modeled containment children (so "Explore inside" shows an interior, not a neighborhood). */
  hasChildren: boolean;
}

export interface GalaxyEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  protocol: string;
  status: RelationshipStatus;
  /** Both directions exist between the same pair. */
  bidirectional: boolean;
  relationshipIds: readonly EntityId[];
  /** Summed throughput from relationship metrics, if any (drives traffic particles). */
  throughputPerSecond: number | undefined;
  /** True when that throughput is simulated (always, until observed telemetry exists). */
  trafficSimulated: boolean;
}

/** Containment link (parent → child). Rendered as an undirected spoke, never as a path. */
export interface GalaxyContainment {
  parentId: string;
  childId: string;
}

export interface GalaxyGroup {
  id: string;
  label: string;
  /** Resource type of the anchor, or 'external'. */
  type: string;
  /** Node at the group's center (constellation core or scope center/child). */
  coreId: string | undefined;
  memberIds: readonly string[];
  kind: 'constellation' | 'children' | 'grandchildren';
}

export interface GalaxyScopeModel {
  /** Effective scope path (invalid trailing IDs removed). */
  path: readonly EntityId[];
  kind: 'overview' | 'container' | 'leaf';
  title: string;
  /** Honest explanation of what the scope shows (e.g. leaf entities). */
  note: string | undefined;
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  containment: GalaxyContainment[];
  groups: GalaxyGroup[];
  /** Overview collapsed to constellation cores because it exceeded `maxNodes`. */
  aggregated: boolean;
}

export interface ScopeOptions {
  environmentId: string;
  filters: EntityFilters;
  path: readonly EntityId[];
  neighborhood?: Neighborhood | null;
  /** Above this many visible entities the overview aggregates constellations (ADR-005 target). */
  maxNodes?: number;
}

export const DEFAULT_MAX_GALAXY_NODES = 250;
const EXTERNAL_GROUP = 'external';

/** Outermost containing resource of an entity, used as its constellation. */
function constellationOf(index: TopologyIndex, entityId: EntityId): string {
  const instance = index.instances.get(entityId);
  const hostId = instance ? instance.resourceId : index.resources.get(entityId)?.parentResourceId;
  const host = hostId ? index.resources.get(hostId) : undefined;
  if (!host) return EXTERNAL_GROUP;
  return resourceAncestors(index, host.id)[0]?.id ?? host.id;
}

function containmentChildren(index: TopologyIndex, id: EntityId): EntityId[] {
  return [
    ...(index.childResources.get(id) ?? []).map((r) => r.id),
    ...(index.instancesByResource.get(id) ?? []).map((i) => i.id),
  ].sort();
}

function nodeFromRow(row: RegistryRow, role: GalaxyNodeRole, groupId: string | undefined, hasChildren: boolean): GalaxyNode {
  return {
    id: row.ref.id,
    ref: row.ref,
    name: row.name,
    type: row.type,
    health: row.health,
    provider: row.provider,
    role,
    groupId,
    memberCount: 1,
    memberIds: [row.ref.id],
    hasChildren,
  };
}

/** Node for any instance/resource, including containment levels that have no registry row. */
function entityNode(
  index: TopologyIndex,
  rows: ReadonlyMap<EntityId, RegistryRow>,
  id: EntityId,
  role: GalaxyNodeRole,
  groupId: string | undefined,
): GalaxyNode | null {
  const hasChildren = containmentChildren(index, id).length > 0;
  const row = rows.get(id);
  if (row) return nodeFromRow(row, role, groupId, hasChildren);
  const resource = index.resources.get(id);
  if (resource) {
    return {
      id,
      ref: { kind: 'resource', id },
      name: resource.name,
      type: resource.type,
      health: resource.health ?? 'unknown',
      provider: resource.provider,
      role,
      groupId,
      memberCount: 1,
      memberIds: [id],
      hasChildren,
    };
  }
  return null;
}

/** Communication edges between displayed nodes; endpoints are mapped to their displayed representative. */
function scopeEdges(index: TopologyIndex, representative: (id: EntityId) => string | undefined, outsideIds: ReadonlySet<string>): GalaxyEdge[] {
  const merged = new Map<string, GalaxyEdge>();
  for (const r of [...index.data.relationships].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = representative(r.sourceEntityId);
    const target = representative(r.targetEntityId);
    if (!source || !target || source === target) continue;
    if (outsideIds.has(source) && outsideIds.has(target)) continue; // not this scope's business
    const kind = edgeKind(r.protocol, r.pattern);
    const key = `${source}->${target}:${kind}`;
    const throughput = r.metrics?.throughputPerSecond;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        relationshipIds: [...existing.relationshipIds, r.id],
        throughputPerSecond:
          throughput === undefined ? existing.throughputPerSecond : (existing.throughputPerSecond ?? 0) + throughput,
        trafficSimulated: existing.trafficSimulated || Boolean(r.metrics?.isSimulated),
      });
    } else {
      merged.set(key, {
        id: source === r.sourceEntityId && target === r.targetEntityId ? r.id : `agg:${key}`,
        source,
        target,
        kind,
        protocol: r.protocol,
        status: r.status,
        bidirectional: r.direction === 'bidirectional',
        relationshipIds: [r.id],
        throughputPerSecond: throughput,
        trafficSimulated: Boolean(r.metrics?.isSimulated),
      });
    }
  }
  const edges = [...merged.values()];
  const pairs = new Set(edges.map((e) => `${e.source}->${e.target}`));
  return edges
    .map((e) => (pairs.has(`${e.target}->${e.source}`) ? { ...e, bidirectional: true } : e))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function resolveOverview(index: TopologyIndex, options: ScopeOptions, rows: ReadonlyMap<EntityId, RegistryRow>): GalaxyScopeModel {
  const graph = buildTopologyGraph(index, {
    environmentId: options.environmentId,
    filters: options.filters,
    mode: 'topology',
    neighborhood: options.neighborhood ?? undefined,
  });
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_GALAXY_NODES;
  const constellation = new Map(graph.nodes.map((n) => [n.id, constellationOf(index, n.id)]));
  const groupIds = [...new Set(constellation.values())].sort();
  const aggregated = graph.nodes.length > maxNodes;

  const groups: GalaxyGroup[] = groupIds.map((id) => {
    const anchor = index.resources.get(id);
    return {
      id,
      label: anchor?.name ?? 'External / SaaS',
      type: anchor?.type ?? 'external',
      coreId: anchor ? id : undefined,
      memberIds: graph.nodes.filter((n) => constellation.get(n.id) === id).map((n) => n.id),
      kind: 'constellation',
    };
  });

  const nodes: GalaxyNode[] = [];
  for (const group of groups) {
    const members = group.memberIds;
    const anchor = group.coreId ? entityNode(index, rows, group.coreId, 'core', group.id) : null;
    if (aggregated) {
      const worst = members.map((m) => rows.get(m)?.health ?? 'unknown').reduce(worse, 'healthy' as HealthStatus);
      nodes.push({
        ...(anchor ?? {
          id: group.id,
          ref: null,
          name: group.label,
          type: 'external-resource',
          provider: 'saas' as Provider,
          hasChildren: false,
        }),
        role: 'core',
        groupId: group.id,
        health: worst,
        memberCount: members.length,
        memberIds: members,
      });
      continue;
    }
    if (anchor) nodes.push(anchor);
    for (const id of members) {
      const row = rows.get(id);
      if (row && id !== group.coreId) nodes.push(nodeFromRow(row, 'member', group.id, containmentChildren(index, id).length > 0));
    }
  }
  const graphIds = new Set(graph.nodes.map((n) => n.id));
  const representative = (id: EntityId) => (aggregated ? constellation.get(id) : graphIds.has(id) ? id : undefined);
  return {
    path: [],
    kind: 'overview',
    title: 'Galaxy overview',
    note: aggregated
      ? `${graph.nodes.length} entities match: constellations are collapsed. Explore inside one to see its members.`
      : undefined,
    nodes,
    edges: scopeEdges(index, representative, new Set()),
    containment: [],
    groups,
    aggregated,
  };
}

const HEALTH_RANK: Record<HealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unavailable: 3 };
const worse = (a: HealthStatus, b: HealthStatus) => (HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a);

function resolveEntity(index: TopologyIndex, options: ScopeOptions, rows: ReadonlyMap<EntityId, RegistryRow>, path: EntityId[]): GalaxyScopeModel {
  const centerId = path[path.length - 1] as EntityId;
  const definition = index.definitions.get(centerId);
  const passes = (id: EntityId) => {
    const row = rows.get(id);
    // Containment levels have no registry row and are always shown inside a scope.
    return !row || matchesFilters(row, options.filters);
  };

  const nodes: GalaxyNode[] = [];
  const containment: GalaxyContainment[] = [];
  const groups: GalaxyGroup[] = [];
  const inside = new Map<EntityId, string>(); // entity → displayed representative

  let center: GalaxyNode | null;
  let children: EntityId[];
  let kind: GalaxyScopeModel['kind'];
  if (definition) {
    // A logical service's interior is its per-environment instances.
    center = {
      id: definition.id,
      ref: { kind: 'service-definition', id: definition.id },
      name: definition.name,
      type: definition.category,
      health: 'unknown',
      provider: 'unknown',
      role: 'center',
      groupId: undefined,
      memberCount: 1,
      memberIds: [definition.id],
      hasChildren: true,
    };
    children = (index.instancesByDefinition.get(definition.id) ?? []).map((i) => i.id).sort();
    kind = 'container';
  } else {
    center = entityNode(index, rows, centerId, 'center', undefined);
    children = containmentChildren(index, centerId);
    kind = children.length > 0 ? 'container' : 'leaf';
  }
  if (!center) return resolveOverview(index, options, rows);
  nodes.push(center);
  inside.set(centerId, centerId);

  const visibleChildren = children.filter(passes);
  for (const childId of visibleChildren) {
    const child = entityNode(index, rows, childId, 'child', centerId);
    if (!child) continue;
    nodes.push(child);
    containment.push({ parentId: centerId, childId });
    inside.set(childId, childId);
    const grandchildren = definition ? [] : containmentChildren(index, childId).filter(passes);
    for (const grandId of grandchildren) {
      const grand = entityNode(index, rows, grandId, 'grandchild', childId);
      if (!grand) continue;
      nodes.push(grand);
      containment.push({ parentId: childId, childId: grandId });
      inside.set(grandId, grandId);
    }
    if (grandchildren.length > 0) {
      groups.push({ id: `sub:${childId}`, label: child.name, type: child.type, coreId: childId, memberIds: grandchildren, kind: 'grandchildren' });
    }
    // Deeper descendants are represented by their displayed ancestor (edges only).
    const stack = definition ? [] : grandchildren.flatMap((g) => containmentChildren(index, g));
    while (stack.length > 0) {
      const id = stack.pop() as EntityId;
      const rep = [...resourceAncestors(index, id).map((r) => r.id), index.instances.get(id)?.resourceId]
        .reverse()
        .find((a) => a !== undefined && inside.has(a) && inside.get(a) === a);
      if (rep && !inside.has(id)) inside.set(id, rep);
      stack.push(...containmentChildren(index, id));
    }
  }
  if (visibleChildren.length > 0) {
    groups.unshift({ id: `children:${centerId}`, label: center.name, type: center.type, coreId: centerId, memberIds: visibleChildren, kind: 'children' });
  }
  // Filtered-out children still count as inside (their edges are not "outside" traffic).
  for (const id of children) if (!inside.has(id)) inside.set(id, centerId);
  // Instances hosted under deeper levels still belong inside for neighbor detection.
  const insideAll = (id: EntityId): boolean => {
    if (inside.has(id)) return true;
    const instance = index.instances.get(id);
    const chain = [...resourceAncestors(index, instance?.resourceId ?? id).map((r) => r.id), instance?.resourceId ?? id];
    return chain.includes(centerId);
  };

  // Outside neighbors: real communication partners of anything inside.
  const outsideIn = new Set<EntityId>();
  const outsideOut = new Set<EntityId>();
  for (const r of index.data.relationships) {
    const s = insideAll(r.sourceEntityId);
    const t = insideAll(r.targetEntityId);
    if (s && !t) outsideOut.add(r.targetEntityId);
    if (t && !s) outsideIn.add(r.sourceEntityId);
  }
  for (const id of [...outsideIn].sort()) {
    if (!passes(id)) continue;
    const node = entityNode(index, rows, id, 'inbound', undefined);
    if (node) nodes.push(node);
  }
  for (const id of [...outsideOut].sort()) {
    if (outsideIn.has(id) || !passes(id)) continue; // shown once, on the inbound side
    const node = entityNode(index, rows, id, 'outbound', undefined);
    if (node) nodes.push(node);
  }
  const outside = new Set(nodes.filter((n) => n.role === 'inbound' || n.role === 'outbound').map((n) => n.id));
  const displayed = new Set(nodes.map((n) => n.id));
  const representative = (id: EntityId): string | undefined => {
    if (outside.has(id)) return id;
    const rep = inside.get(id) ?? (insideAll(id) ? centerId : undefined);
    return rep && displayed.has(rep) ? rep : rep ? centerId : undefined;
  };

  const typeOf = index.resources.get(centerId)?.type;
  const note =
    kind === 'leaf'
      ? `${center.name} has no modeled children, so there is no interior to show. Showing its direct communication partners instead.`
      : definition
        ? 'A logical service: its interior is its deployed instances, one per environment.'
        : typeOf && CONTAINMENT_ONLY_RESOURCE_TYPES.has(typeOf)
          ? 'Containment: what runs inside this resource. Outside partners are shown at the sides.'
          : undefined;

  return {
    path,
    kind,
    title: center.name,
    note,
    nodes,
    edges: scopeEdges(index, representative, outside),
    containment,
    groups,
    aggregated: false,
  };
}

/** Drops IDs that no longer exist (e.g. after switching data), keeping the valid prefix. */
export function effectivePath(index: TopologyIndex, path: readonly EntityId[]): EntityId[] {
  const valid: EntityId[] = [];
  for (const id of path) {
    if (!index.instances.has(id) && !index.resources.has(id) && !index.definitions.has(id)) break;
    valid.push(id);
  }
  return valid;
}

export function resolveGalaxyScope(index: TopologyIndex, options: ScopeOptions): GalaxyScopeModel {
  const rows = new Map(buildRegistryRows(index).map((row) => [row.ref.id, row]));
  const path = effectivePath(index, options.path);
  return path.length === 0 ? resolveOverview(index, options, rows) : resolveEntity(index, options, rows, path);
}

/** Can "Explore inside" be offered for this entity? Every instance/resource/definition can: leaves show a neighborhood. */
export function canExplore(index: TopologyIndex, id: EntityId): boolean {
  return index.instances.has(id) || index.resources.has(id) || index.definitions.has(id);
}
