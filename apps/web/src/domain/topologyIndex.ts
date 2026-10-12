import type {
  CommunicationRelationship,
  EnvironmentKind,
  EntityId,
  EntityKind,
  EntityRef,
  EnvironmentRecord,
  EventType,
  InfrastructureResource,
  ServiceDefinition,
  ServiceInstance,
  TopologyData,
} from './types';

/** Read-only lookup structure derived once from TopologyData. */
export interface TopologyIndex {
  data: TopologyData;
  environments: ReadonlyMap<EntityId, EnvironmentRecord>;
  definitions: ReadonlyMap<EntityId, ServiceDefinition>;
  instances: ReadonlyMap<EntityId, ServiceInstance>;
  resources: ReadonlyMap<EntityId, InfrastructureResource>;
  relationships: ReadonlyMap<EntityId, CommunicationRelationship>;
  eventTypes: ReadonlyMap<EntityId, EventType>;
  /** Event types keyed by each channel resource that carries them. */
  eventTypesByChannel: ReadonlyMap<EntityId, readonly EventType[]>;
  instancesByDefinition: ReadonlyMap<EntityId, readonly ServiceInstance[]>;
  instancesByResource: ReadonlyMap<EntityId, readonly ServiceInstance[]>;
  childResources: ReadonlyMap<EntityId, readonly InfrastructureResource[]>;
  /** Relationships keyed by their source entity. */
  outgoing: ReadonlyMap<EntityId, readonly CommunicationRelationship[]>;
  /** Relationships keyed by their target entity. */
  incoming: ReadonlyMap<EntityId, readonly CommunicationRelationship[]>;
}

function byId<T extends { id: EntityId }>(items: readonly T[]): Map<EntityId, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function groupBy<T>(items: readonly T[], key: (item: T) => EntityId | undefined): Map<EntityId, T[]> {
  const groups = new Map<EntityId, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function groupByMany<T>(items: readonly T[], keys: (item: T) => readonly EntityId[]): Map<EntityId, T[]> {
  const groups = new Map<EntityId, T[]>();
  for (const item of items) for (const k of new Set(keys(item))) groups.set(k, [...(groups.get(k) ?? []), item]);
  return groups;
}

export function buildTopologyIndex(data: TopologyData): TopologyIndex {
  return {
    data,
    environments: byId(data.environments),
    definitions: byId(data.serviceDefinitions),
    instances: byId(data.serviceInstances),
    resources: byId(data.resources),
    relationships: byId(data.relationships),
    eventTypes: byId(data.eventTypes ?? []),
    eventTypesByChannel: groupByMany(data.eventTypes ?? [], (e) => e.channelResourceIds),
    instancesByDefinition: groupBy(data.serviceInstances, (i) => i.serviceDefinitionId),
    instancesByResource: groupBy(data.serviceInstances, (i) => i.resourceId),
    childResources: groupBy(data.resources, (r) => r.parentResourceId),
    outgoing: groupBy(data.relationships, (r) => r.sourceEntityId),
    incoming: groupBy(data.relationships, (r) => r.targetEntityId),
  };
}

/** Kind of the entity with this ID, or undefined if it does not exist. */
export function kindOfId(index: TopologyIndex, id: EntityId): EntityKind | undefined {
  if (index.instances.has(id)) return 'service-instance';
  if (index.resources.has(id)) return 'resource';
  if (index.relationships.has(id)) return 'relationship';
  if (index.definitions.has(id)) return 'service-definition';
  if (index.environments.has(id)) return 'environment';
  return undefined;
}

export function refExists(index: TopologyIndex, ref: EntityRef): boolean {
  switch (ref.kind) {
    case 'environment':
      return index.environments.has(ref.id);
    case 'service-definition':
      return index.definitions.has(ref.id);
    case 'service-instance':
      return index.instances.has(ref.id);
    case 'resource':
      return index.resources.has(ref.id);
    case 'relationship':
      return index.relationships.has(ref.id);
  }
}

/** Ancestors of a resource, root first. Stops at a missing parent or a cycle. */
export function resourceAncestors(index: TopologyIndex, resourceId: EntityId): InfrastructureResource[] {
  const chain: InfrastructureResource[] = [];
  const seen = new Set<EntityId>([resourceId]);
  let parentId = index.resources.get(resourceId)?.parentResourceId;
  while (parentId !== undefined && !seen.has(parentId)) {
    const parent = index.resources.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentResourceId;
  }
  return chain;
}

/** Display name for any entity that takes part in communication. */
export function endpointName(index: TopologyIndex, id: EntityId): string {
  const instance = index.instances.get(id);
  if (instance) return index.definitions.get(instance.serviceDefinitionId)?.name ?? instance.id;
  return index.resources.get(id)?.name ?? id;
}

/** Display name for any entity: its name, or "source → target" for a relationship; the ID otherwise. */
export function displayName(index: TopologyIndex, id: EntityId): string {
  const relationship = index.relationships.get(id);
  if (relationship) return `${endpointName(index, relationship.sourceEntityId)} → ${endpointName(index, relationship.targetEntityId)}`;
  return index.definitions.get(id)?.name ?? index.environments.get(id)?.name ?? index.eventTypes.get(id)?.name ?? endpointName(index, id);
}

/**
 * Environment of an instance or resource. Resources inherit the nearest ancestor's environment;
 * undefined means environment-independent (e.g. an external SaaS API).
 */
export function environmentOf(index: TopologyIndex, id: EntityId): EntityId | undefined {
  const instance = index.instances.get(id);
  if (instance) return instance.environmentId;
  const resource = index.resources.get(id);
  if (!resource) return undefined;
  if (resource.environmentId !== undefined) return resource.environmentId;
  return resourceAncestors(index, id)
    .reverse()
    .find((r) => r.environmentId !== undefined)?.environmentId;
}

/** Display order for environments: production, staging, development, then other kinds (ADR-008). */
const ENVIRONMENT_KIND_ORDER: Record<EnvironmentKind, number> = { production: 0, staging: 1, development: 2, other: 3 };

export function sortEnvironments(environments: readonly EnvironmentRecord[]): EnvironmentRecord[] {
  return [...environments].sort(
    (a, b) =>
      (ENVIRONMENT_KIND_ORDER[a.kind] ?? 3) - (ENVIRONMENT_KIND_ORDER[b.kind] ?? 3) ||
      a.name.localeCompare(b.name, 'en'),
  );
}
