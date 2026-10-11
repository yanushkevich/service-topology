import {
  buildRegistryRows,
  inEnvironment,
  matchesFilters,
  type EntityFilters,
  type RegistryRow,
} from '../../../domain/registry';
import { resourceAncestors, type TopologyIndex } from '../../../domain/topologyIndex';
import { neighborhood } from '../../../domain/traversal';
import type {
  CommunicationRelationship,
  EntityId,
  EntityRef,
  HealthStatus,
  InfrastructureResource,
  Provider,
  RelationshipStatus,
} from '../../../domain/types';
import type { LayoutMode } from '../../../state/uiStore';
import { edgeKind, type EdgeKind } from '../../../shared/mappings';

/**
 * Renderer-agnostic graph view model derived from canonical data. React Flow (and later the 3D
 * view) adapt this; it never contains renderer objects. Containment becomes groups, never edges.
 */

export interface GraphNode {
  /** Canonical entity ID, or a group ID for a collapsed group. */
  id: string;
  kind: 'entity' | 'collapsed-group';
  /** The canonical entity (or group resource) this node stands for. */
  ref: EntityRef | null;
  name: string;
  subtitle: string;
  /** Service category or resource type; drives the glyph. */
  type: string;
  health: HealthStatus;
  provider: Provider;
  /** Innermost visible group, in infrastructure mode. */
  groupId: string | undefined;
  /** For collapsed groups: number of entities hidden inside. */
  memberCount: number;
  /** Canonical entity IDs this node represents (itself, or members of a collapsed group). */
  memberIds: readonly EntityId[];
}

export interface GraphGroup {
  id: string;
  label: string;
  /** Resource type, or 'provider' for the synthetic per-provider top level. */
  type: string;
  parentId: string | undefined;
  /** The containment resource behind the group (absent for provider groups). */
  ref: EntityRef | null;
  depth: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  protocol: string;
  status: RelationshipStatus;
  /** Canonical relationships represented (more than one when merged by collapsing). */
  relationshipIds: readonly EntityId[];
}

export interface TopologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  /** Entities in the environment before filters/neighborhood; used for empty-state messages. */
  environmentEntityCount: number;
}

export interface GraphOptions {
  environmentId: string;
  filters: EntityFilters;
  mode: LayoutMode;
  collapsedGroupIds?: ReadonlySet<string>;
  /** Restrict to entities within `depth` hops of `centerId`. */
  neighborhood?: { centerId: EntityId; depth: number } | undefined;
}

const PROVIDER_GROUP_PREFIX = 'provider:';
export const providerGroupId = (provider: Provider) => `${PROVIDER_GROUP_PREFIX}${provider}`;

export const PROVIDER_GROUP_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  'on-prem': 'On-premises',
  saas: 'SaaS / external',
  internal: 'Internal',
  unknown: 'Unknown provider',
};

/**
 * Entities that appear on the map for an environment: every service instance plus every
 * communicating resource that has at least one relationship. Environment-independent resources
 * (e.g. SaaS APIs) appear only when connected to something in the environment.
 */
function environmentRows(index: TopologyIndex, rows: readonly RegistryRow[], environmentId: string): RegistryRow[] {
  const scoped = rows.filter(
    (row) =>
      row.environmentId === environmentId &&
      (row.ref.kind === 'service-instance' ||
        (index.outgoing.get(row.ref.id)?.length ?? 0) + (index.incoming.get(row.ref.id)?.length ?? 0) > 0),
  );
  const scopedIds = new Set(scoped.map((row) => row.ref.id));
  const shared = rows.filter(
    (row) =>
      row.environmentId === undefined &&
      inEnvironment(row, environmentId) &&
      [...(index.outgoing.get(row.ref.id) ?? []), ...(index.incoming.get(row.ref.id) ?? [])].some(
        (r) => scopedIds.has(r.sourceEntityId) || scopedIds.has(r.targetEntityId),
      ),
  );
  return [...scoped, ...shared];
}

/** Containment chain (outermost first) used for grouping an entity in infrastructure mode. */
function containmentChain(index: TopologyIndex, entityId: EntityId): InfrastructureResource[] {
  const instance = index.instances.get(entityId);
  if (instance) {
    if (!instance.resourceId) return [];
    const host = index.resources.get(instance.resourceId);
    return host ? [...resourceAncestors(index, host.id), host] : [];
  }
  return resourceAncestors(index, entityId);
}

const rowToNode = (row: RegistryRow, groupId: string | undefined): GraphNode => ({
  id: row.ref.id,
  kind: 'entity',
  ref: row.ref,
  name: row.name,
  subtitle: row.ref.id,
  type: row.type,
  health: row.health,
  provider: row.provider,
  groupId,
  memberCount: 1,
  memberIds: [row.ref.id],
});

const HEALTH_SEVERITY: Record<HealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unavailable: 3 };

export function buildTopologyGraph(index: TopologyIndex, options: GraphOptions): TopologyGraph {
  const allRows = buildRegistryRows(index);
  const inEnv = environmentRows(index, allRows, options.environmentId);
  const near = options.neighborhood
    ? neighborhood(index, options.neighborhood.centerId, options.neighborhood.depth)
    : undefined;
  const visibleRows = inEnv
    .filter((row) => !near || near.has(row.ref.id))
    .filter((row) => matchesFilters(row, options.filters))
    .sort((a, b) => a.ref.id.localeCompare(b.ref.id));
  const visibleIds = new Set(visibleRows.map((row) => row.ref.id));

  const relationships = index.data.relationships
    .filter((r) => visibleIds.has(r.sourceEntityId) && visibleIds.has(r.targetEntityId))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (options.mode === 'topology') {
    return {
      nodes: visibleRows.map((row) => rowToNode(row, undefined)),
      edges: relationships.map(toEdge),
      groups: [],
      environmentEntityCount: inEnv.length,
    };
  }

  // Infrastructure mode: provider → explicit containment hierarchy.
  const groups = new Map<string, GraphGroup>();
  const chainOf = new Map<EntityId, string[]>();
  for (const row of visibleRows) {
    const providerGroup = providerGroupId(row.provider);
    if (!groups.has(providerGroup)) {
      groups.set(providerGroup, {
        id: providerGroup,
        label: PROVIDER_GROUP_LABELS[row.provider] ?? row.provider,
        type: 'provider',
        parentId: undefined,
        ref: null,
        depth: 0,
      });
    }
    const chain = [providerGroup];
    for (const resource of containmentChain(index, row.ref.id)) {
      const parentId = chain[chain.length - 1];
      if (!groups.has(resource.id)) {
        groups.set(resource.id, {
          id: resource.id,
          label: resource.name,
          type: resource.type,
          parentId,
          ref: { kind: 'resource', id: resource.id },
          depth: chain.length,
        });
      }
      chain.push(resource.id);
    }
    chainOf.set(row.ref.id, chain);
  }

  // A communicating resource that also contains visible entities (e.g. a broker with topics)
  // is shown as its group; its relationships attach to the group node.
  const entityGroups = visibleRows.filter((row) => groups.has(row.ref.id)).map((row) => row.ref.id);
  const entityGroupSet = new Set(entityGroups);

  // Collapsing: the outermost collapsed group on an entity's chain represents it.
  const collapsed = options.collapsedGroupIds ?? new Set<string>();
  const representative = new Map<EntityId, string>();
  const members = new Map<string, RegistryRow[]>();
  for (const row of visibleRows) {
    const chain = chainOf.get(row.ref.id) ?? [];
    const outer = chain.find((g) => collapsed.has(g));
    const rep = outer ?? row.ref.id;
    representative.set(row.ref.id, rep);
    if (outer) members.set(outer, [...(members.get(outer) ?? []), row]);
  }

  // Groups strictly inside a collapsed group disappear, and the collapsed group becomes a node.
  const hiddenGroups = new Set<string>();
  for (const group of groups.values()) {
    let parent = group.parentId;
    while (parent !== undefined) {
      if (collapsed.has(parent)) {
        hiddenGroups.add(group.id);
        break;
      }
      parent = groups.get(parent)?.parentId;
    }
  }
  const collapsedNodes = [...members.keys()].filter((id) => !hiddenGroups.has(id));
  const visibleGroups = [...groups.values()].filter(
    (g) => !hiddenGroups.has(g.id) && !collapsed.has(g.id),
  );

  const nodes: GraphNode[] = [];
  for (const row of visibleRows) {
    if (representative.get(row.ref.id) !== row.ref.id) continue;
    if (entityGroupSet.has(row.ref.id)) continue; // rendered as its group
    const chain = chainOf.get(row.ref.id) ?? [];
    nodes.push(rowToNode(row, chain[chain.length - 1]));
  }
  for (const groupId of collapsedNodes.sort()) {
    const group = groups.get(groupId);
    const groupMembers = members.get(groupId) ?? [];
    if (!group) continue;
    const worst = groupMembers.reduce<HealthStatus>(
      (acc, m) => (HEALTH_SEVERITY[m.health] > HEALTH_SEVERITY[acc] ? m.health : acc),
      'healthy',
    );
    nodes.push({
      id: groupId,
      kind: 'collapsed-group',
      ref: group.ref,
      name: group.label,
      subtitle: `${groupMembers.length} ${groupMembers.length === 1 ? 'entity' : 'entities'} collapsed`,
      type: group.type,
      health: worst,
      provider: groupMembers[0]?.provider ?? 'unknown',
      groupId: group.parentId,
      memberCount: groupMembers.length,
      memberIds: groupMembers.map((m) => m.ref.id).sort(),
    });
  }

  // Remap edge endpoints to representatives; drop edges internal to a collapsed group; merge duplicates.
  const merged = new Map<string, GraphEdge>();
  for (const r of relationships) {
    const source = representative.get(r.sourceEntityId) ?? r.sourceEntityId;
    const target = representative.get(r.targetEntityId) ?? r.targetEntityId;
    if (source === target) continue;
    if (source === r.sourceEntityId && target === r.targetEntityId) {
      merged.set(r.id, toEdge(r));
      continue;
    }
    const key = `agg:${source}->${target}:${edgeKind(r.protocol, r.pattern)}`;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ...existing,
        relationshipIds: [...existing.relationshipIds, r.id],
        status: worseStatus(existing.status, r.status),
      });
    } else {
      merged.set(key, { ...toEdge(r), id: key, source, target, relationshipIds: [r.id] });
    }
  }

  return {
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
    groups: visibleGroups.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
    environmentEntityCount: inEnv.length,
  };
}

function toEdge(r: CommunicationRelationship): GraphEdge {
  return {
    id: r.id,
    source: r.sourceEntityId,
    target: r.targetEntityId,
    kind: edgeKind(r.protocol, r.pattern),
    protocol: r.protocol,
    status: r.status,
    relationshipIds: [r.id],
  };
}

const STATUS_SEVERITY: Record<RelationshipStatus, number> = { active: 0, unknown: 1, degraded: 2, inactive: 3 };
function worseStatus(a: RelationshipStatus, b: RelationshipStatus): RelationshipStatus {
  return STATUS_SEVERITY[b] > STATUS_SEVERITY[a] ? b : a;
}

/** All group IDs at a given depth (0 = provider level) — used for "collapse all" at scale. */
export function groupIdsAtDepth(graph: TopologyGraph, depth: number): string[] {
  return graph.groups.filter((g) => g.depth === depth).map((g) => g.id);
}
