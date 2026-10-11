import type { TopologyIndex } from './topologyIndex';
import type { EntityId } from './types';

export const HIGHLIGHT_MODES = ['direct', 'upstream', 'downstream'] as const;
/**
 * direct: immediate relationships in both directions.
 * upstream: everything the entity transitively depends on (follows outgoing relationships).
 * downstream: everything that transitively depends on the entity (follows incoming relationships).
 */
export type HighlightMode = (typeof HIGHLIGHT_MODES)[number];

export interface Reach {
  entityIds: Set<EntityId>;
  relationshipIds: Set<EntityId>;
}

/** Entities and relationships reached from `startId` under a highlight mode. Includes the start entity. */
export function reachFrom(index: TopologyIndex, startId: EntityId, mode: HighlightMode): Reach {
  const entityIds = new Set<EntityId>([startId]);
  const relationshipIds = new Set<EntityId>();

  if (mode === 'direct') {
    for (const r of index.outgoing.get(startId) ?? []) {
      entityIds.add(r.targetEntityId);
      relationshipIds.add(r.id);
    }
    for (const r of index.incoming.get(startId) ?? []) {
      entityIds.add(r.sourceEntityId);
      relationshipIds.add(r.id);
    }
    return { entityIds, relationshipIds };
  }

  const edges = mode === 'upstream' ? index.outgoing : index.incoming;
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift() as EntityId;
    for (const r of edges.get(current) ?? []) {
      relationshipIds.add(r.id);
      const next = mode === 'upstream' ? r.targetEntityId : r.sourceEntityId;
      if (!entityIds.has(next)) {
        entityIds.add(next);
        queue.push(next);
      }
    }
  }
  return { entityIds, relationshipIds };
}

/** Entities within `depth` hops of `centerId`, ignoring direction (neighborhood exploration). */
export function neighborhood(index: TopologyIndex, centerId: EntityId, depth: number): Set<EntityId> {
  const seen = new Set<EntityId>([centerId]);
  let frontier = [centerId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: EntityId[] = [];
    for (const id of frontier) {
      const peers = [
        ...(index.outgoing.get(id) ?? []).map((r) => r.targetEntityId),
        ...(index.incoming.get(id) ?? []).map((r) => r.sourceEntityId),
      ];
      for (const peer of peers) {
        if (!seen.has(peer)) {
          seen.add(peer);
          next.push(peer);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export interface DependencyEntry {
  entityId: EntityId;
  /** Hops from the start (1 = direct). */
  depth: number;
  /** Relationship used on the last hop of the shortest path. */
  viaRelationshipId: EntityId;
  /** Previous entity on the shortest path. */
  parentId: EntityId;
  /** Start → … → entity. */
  path: EntityId[];
}

/**
 * Upstream (what `startId` depends on, following outgoing relationships) or downstream (what
 * depends on it, following incoming ones), breadth-first: each entity once, at its shortest
 * distance, ordered by depth then ID. Deterministic and cycle-safe.
 */
export function dependencyTree(index: TopologyIndex, startId: EntityId, direction: 'upstream' | 'downstream'): DependencyEntry[] {
  const edges = direction === 'upstream' ? index.outgoing : index.incoming;
  const seen = new Set<EntityId>([startId]);
  const out: DependencyEntry[] = [];
  let frontier: { id: EntityId; path: EntityId[] }[] = [{ id: startId, path: [startId] }];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const next: { id: EntityId; path: EntityId[] }[] = [];
    for (const { id, path } of frontier) {
      for (const r of [...(edges.get(id) ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
        const peer = direction === 'upstream' ? r.targetEntityId : r.sourceEntityId;
        if (seen.has(peer)) continue;
        seen.add(peer);
        const entry = { entityId: peer, depth, viaRelationshipId: r.id, parentId: id, path: [...path, peer] };
        out.push(entry);
        next.push({ id: peer, path: entry.path });
      }
    }
    frontier = next;
  }
  return out.sort((a, b) => a.depth - b.depth || a.entityId.localeCompare(b.entityId));
}
