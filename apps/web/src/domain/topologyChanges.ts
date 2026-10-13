import type { EntityId, TopologyData } from './types';

/**
 * Applying one entity change to a topology (ADR-020): used by editors to preview a change and by
 * the local sandbox writer (ADR-031) to apply it. Pure; never modifies its input.
 */

/** The writable entity kinds (ADR-020, ADR-022); `WritableKind` in data/repositories is the same union. */
export type ChangeKind = 'environment' | 'service-definition' | 'service-instance' | 'resource' | 'relationship' | 'event-type' | 'business-flow';

const COLLECTION: Record<ChangeKind, keyof TopologyData> = {
  environment: 'environments',
  'service-definition': 'serviceDefinitions',
  'service-instance': 'serviceInstances',
  resource: 'resources',
  relationship: 'relationships',
  'event-type': 'eventTypes',
  'business-flow': 'businessFlows',
};

/** The topology after a create, replace (same ID), or delete. Does not modify data. */
export function applyChange(data: TopologyData, kind: ChangeKind, change: { op: 'create' | 'update'; entity: { id: EntityId } } | { op: 'delete'; id: EntityId }): TopologyData {
  const key = COLLECTION[kind];
  const items = [...((data[key] as { id: EntityId }[] | undefined) ?? [])];
  if (change.op === 'delete') {
    const at = items.findIndex((e) => e.id === change.id);
    if (at >= 0) items.splice(at, 1);
  } else if (change.op === 'create') {
    items.push(change.entity);
  } else {
    const at = items.findIndex((e) => e.id === change.entity.id);
    if (at >= 0) items[at] = change.entity;
  }
  return { ...data, [key]: items } as TopologyData;
}

/** Whether any collection already uses id (IDs are unique across collections). */
export function idTaken(data: TopologyData, id: EntityId): boolean {
  return Object.values(COLLECTION).some((key) => ((data[key] as { id: EntityId }[] | undefined) ?? []).some((e) => e.id === id));
}

