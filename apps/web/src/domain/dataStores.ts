import type { TopologyIndex } from './topologyIndex';
import type { BusinessFlow, EntityId, InfrastructureResource } from './types';

/**
 * Data stores used by services (ADR-027, docs/BUSINESS_FLOWS.md Revision 3 §16): the databases,
 * caches, and search indexes a service's instance in an environment has a relationship to. The
 * topology links stores to services, not to operations, so a step "uses" its service's stores.
 */

const STORE_TYPES: ReadonlySet<string> = new Set(['database', 'cache', 'search-index']);

export function dataStoresOf(index: TopologyIndex, serviceDefinitionId: EntityId, environmentId: EntityId): InfrastructureResource[] {
  const instances = (index.instancesByDefinition.get(serviceDefinitionId) ?? []).filter((i) => i.environmentId === environmentId);
  const stores = new Map<EntityId, InfrastructureResource>();
  for (const instance of instances) {
    for (const r of index.outgoing.get(instance.id) ?? []) {
      const resource = index.resources.get(r.targetEntityId);
      if (resource && STORE_TYPES.has(resource.type)) stores.set(resource.id, resource);
    }
  }
  return [...stores.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Every store a flow's steps use, with the steps that use it (by their service), in step order. */
export function flowDataStores(index: TopologyIndex, flow: BusinessFlow, environmentId: EntityId): { store: InfrastructureResource; stepIds: string[] }[] {
  const out = new Map<EntityId, { store: InfrastructureResource; stepIds: string[] }>();
  for (const step of flow.steps) {
    for (const store of dataStoresOf(index, step.serviceDefinitionId, environmentId)) {
      const entry = out.get(store.id) ?? { store, stepIds: [] };
      entry.stepIds.push(step.id);
      out.set(store.id, entry);
    }
  }
  return [...out.values()];
}
