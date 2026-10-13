import { createContext, useContext } from 'react';
import type { EntityOfKind, WritableKind } from '../../data/repositories/TopologyRepository';
import type { BusinessFlow, EntityId, TopologyData } from '../../domain/types';

export interface EntityEditing {
  /** Null when editing is possible; otherwise why not (shown next to disabled actions). */
  unavailable: null | { reason: string; hint: 'backend' | 'history' | 'loading' };
  /** `template` pre-fills a business flow (e.g. a duplicate of an imported one). */
  openCreate(kind: WritableKind, template?: BusinessFlow): void;
  openEdit(kind: WritableKind, id: EntityId): void;
  openDelete(kind: WritableKind, id: EntityId): void;
}

export const EntityEditingContext = createContext<EntityEditing>({
  unavailable: { reason: 'Editing is not available here.', hint: 'loading' },
  openCreate: () => undefined,
  openEdit: () => undefined,
  openDelete: () => undefined,
});

export function useEntityEditing(): EntityEditing {
  return useContext(EntityEditingContext);
}

/** Finds an entity of a kind in the stored topology. */
export function findEntity<K extends WritableKind>(data: TopologyData, kind: K, id: EntityId): EntityOfKind[K] | undefined {
  const collections: Record<WritableKind, readonly { id: EntityId }[] | undefined> = {
    environment: data.environments,
    'service-definition': data.serviceDefinitions,
    'service-instance': data.serviceInstances,
    resource: data.resources,
    relationship: data.relationships,
    'event-type': data.eventTypes,
    'business-flow': data.businessFlows,
  };
  return collections[kind]?.find((e) => e.id === id) as EntityOfKind[K] | undefined;
}

