import { environmentOf, type TopologyIndex } from './topologyIndex';
import type {
  EntityId,
  EntityRef,
  HealthStatus,
  Provider,
  ResourceType,
  ServiceCategory,
} from './types';
import { CONTAINMENT_ONLY_RESOURCE_TYPES } from './types';

export const ENTITY_GROUPS = ['service', 'data', 'messaging', 'external', 'other'] as const;
export type EntityGroup = (typeof ENTITY_GROUPS)[number];

const RESOURCE_GROUP: Partial<Record<ResourceType, EntityGroup>> = {
  database: 'data',
  cache: 'data',
  'search-index': 'data',
  broker: 'messaging',
  topic: 'messaging',
  queue: 'messaging',
  exchange: 'messaging',
  'external-resource': 'external',
};

/** A flat, renderer-agnostic registry record for one service instance or topology resource. */
export interface RegistryRow {
  ref: EntityRef;
  name: string;
  /** Service category for instances, resource type for resources. */
  type: ServiceCategory | ResourceType;
  group: EntityGroup;
  provider: Provider;
  /** Undefined for environment-independent entities (e.g. SaaS APIs). */
  environmentId: EntityId | undefined;
  owner: string | undefined;
  team: string | undefined;
  /** 'unknown' when health is not modeled. */
  health: HealthStatus;
  outgoingCount: number;
  incomingCount: number;
  updatedAt: string | undefined;
  /** Lower-cased text matched by free-text search. */
  searchText: string;
}

/** Shared filters (cross-view). Empty arrays mean "no restriction". */
export interface EntityFilters {
  query: string;
  providers: readonly Provider[];
  health: readonly HealthStatus[];
  groups: readonly EntityGroup[];
}

export const EMPTY_FILTERS: EntityFilters = { query: '', providers: [], health: [], groups: [] };

export function hasActiveFilters(filters: EntityFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.providers.length > 0 ||
    filters.health.length > 0 ||
    filters.groups.length > 0
  );
}

/** Registry rows: every service instance plus every resource that can take part in communication. */
export function buildRegistryRows(index: TopologyIndex): RegistryRow[] {
  const rows: RegistryRow[] = [];
  const count = (id: EntityId) => ({
    outgoingCount: index.outgoing.get(id)?.length ?? 0,
    incomingCount: index.incoming.get(id)?.length ?? 0,
  });

  for (const instance of index.data.serviceInstances) {
    const definition = index.definitions.get(instance.serviceDefinitionId);
    const name = definition?.name ?? instance.serviceDefinitionId;
    rows.push({
      ref: { kind: 'service-instance', id: instance.id },
      name,
      type: definition?.category ?? 'other',
      group: 'service',
      provider: instance.provider,
      environmentId: instance.environmentId,
      owner: definition?.owner,
      team: definition?.team,
      health: instance.health,
      ...count(instance.id),
      updatedAt: instance.updatedAt,
      searchText: [name, instance.id, definition?.owner, definition?.team].join(' ').toLowerCase(),
    });
  }

  for (const resource of index.data.resources) {
    if (CONTAINMENT_ONLY_RESOURCE_TYPES.has(resource.type)) continue;
    rows.push({
      ref: { kind: 'resource', id: resource.id },
      name: resource.name,
      type: resource.type,
      group: RESOURCE_GROUP[resource.type] ?? 'other',
      provider: resource.provider,
      environmentId: environmentOf(index, resource.id),
      owner: resource.owner,
      team: resource.team,
      health: resource.health ?? 'unknown',
      ...count(resource.id),
      updatedAt: resource.updatedAt,
      searchText: [resource.name, resource.id, resource.type, resource.owner, resource.team].join(' ').toLowerCase(),
    });
  }

  return rows;
}

/** True if the row belongs to the environment (environment-independent rows always do). */
export function inEnvironment(row: RegistryRow, environmentId: EntityId | null): boolean {
  return environmentId === null || row.environmentId === undefined || row.environmentId === environmentId;
}

export function matchesFilters(row: RegistryRow, filters: EntityFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query !== '' && !query.split(/\s+/).every((term) => row.searchText.includes(term))) return false;
  if (filters.providers.length > 0 && !filters.providers.includes(row.provider)) return false;
  if (filters.health.length > 0 && !filters.health.includes(row.health)) return false;
  if (filters.groups.length > 0 && !filters.groups.includes(row.group)) return false;
  return true;
}

export function filterRegistryRows(
  rows: readonly RegistryRow[],
  filters: EntityFilters,
  environmentId: EntityId | null,
): RegistryRow[] {
  return rows.filter((row) => inEnvironment(row, environmentId) && matchesFilters(row, filters));
}

export const REGISTRY_SORT_KEYS = ['name', 'type', 'provider', 'owner', 'health', 'relationships', 'updated'] as const;
export type RegistrySortKey = (typeof REGISTRY_SORT_KEYS)[number];
export interface RegistrySort {
  key: RegistrySortKey;
  direction: 'asc' | 'desc';
}

/** Most severe first when sorting by health ascending. */
const HEALTH_RANK: Record<HealthStatus, number> = { unavailable: 0, degraded: 1, unknown: 2, healthy: 3 };

function compareText(a: string | undefined, b: string | undefined): number {
  // Missing values sort after present ones in ascending order.
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

export function sortRegistryRows(rows: readonly RegistryRow[], sort: RegistrySort): RegistryRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = (a: RegistryRow, b: RegistryRow): number => {
    switch (sort.key) {
      case 'name':
        return compareText(a.name, b.name);
      case 'type':
        return compareText(a.type, b.type);
      case 'provider':
        return compareText(a.provider, b.provider);
      case 'owner':
        return compareText(a.owner ?? a.team, b.owner ?? b.team);
      case 'health':
        return HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
      case 'relationships':
        return a.outgoingCount + a.incomingCount - (b.outgoingCount + b.incomingCount);
      case 'updated':
        return compareText(a.updatedAt, b.updatedAt);
    }
  };
  // Tie-break on canonical ID so the order is deterministic.
  return [...rows].sort((a, b) => sign * compare(a, b) || a.ref.id.localeCompare(b.ref.id));
}
