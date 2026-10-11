import { buildTopologyIndex, environmentOf } from './topologyIndex';
import { CONTAINMENT_ONLY_RESOURCE_TYPES, type EntityId, type TopologyData } from './types';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'empty-id'
  | 'duplicate-id'
  | 'missing-environment'
  | 'missing-service-definition'
  | 'missing-resource'
  | 'missing-parent'
  | 'parent-cycle'
  | 'missing-relationship-endpoint'
  | 'invalid-relationship-endpoint'
  | 'self-relationship'
  | 'environment-mismatch'
  | 'environment-conflict'
  | 'cross-environment-relationship'
  | 'invalid-binding-target';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  entityId: EntityId;
  message: string;
}

/**
 * Integrity rules for canonical topology data. Errors break documented invariants (ADR-004, ADR-008);
 * warnings flag combinations that are allowed but probably unintended.
 */
export function validateTopology(data: TopologyData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, entityId: EntityId, message: string) =>
    issues.push({ severity: 'error', code, entityId, message });
  const warning = (code: ValidationCode, entityId: EntityId, message: string) =>
    issues.push({ severity: 'warning', code, entityId, message });

  // IDs are unique across every collection, so a bare ID resolves to exactly one entity.
  const seen = new Set<EntityId>();
  const all = [
    ...data.environments,
    ...data.serviceDefinitions,
    ...data.serviceInstances,
    ...data.resources,
    ...data.relationships,
  ];
  for (const { id } of all) {
    if (id.trim() === '') error('empty-id', id, 'Entity has an empty ID');
    else if (seen.has(id)) error('duplicate-id', id, `Duplicate ID "${id}"`);
    seen.add(id);
  }

  const index = buildTopologyIndex(data);

  for (const instance of data.serviceInstances) {
    // Data from future adapters is untyped at runtime; an instance must name exactly one environment.
    if (typeof instance.environmentId !== 'string') {
      error('missing-environment', instance.id, 'Instance must reference exactly one environment ID');
    } else if (!index.environments.has(instance.environmentId)) {
      error('missing-environment', instance.id, `Instance references unknown environment "${instance.environmentId}"`);
    }
    if (!index.definitions.has(instance.serviceDefinitionId)) {
      error(
        'missing-service-definition',
        instance.id,
        `Instance references unknown service definition "${instance.serviceDefinitionId}"`,
      );
    }
    if (instance.resourceId !== undefined) {
      if (!index.resources.has(instance.resourceId)) {
        error('missing-resource', instance.id, `Instance references unknown resource "${instance.resourceId}"`);
      } else {
        const hostEnvironment = environmentOf(index, instance.resourceId);
        if (hostEnvironment !== undefined && hostEnvironment !== instance.environmentId) {
          warning(
            'environment-mismatch',
            instance.id,
            `Instance is in "${instance.environmentId}" but runs in a resource assigned to "${hostEnvironment}"`,
          );
        }
      }
    }
  }

  for (const resource of data.resources) {
    if (resource.environmentId !== undefined && !index.environments.has(resource.environmentId)) {
      error('missing-environment', resource.id, `Resource references unknown environment "${resource.environmentId}"`);
    }
    if (resource.parentResourceId === undefined) continue;
    // Environment is inherited through containment (ADR-008); a child may restate it but not change it.
    if (resource.environmentId !== undefined) {
      const inherited = environmentOf(index, resource.parentResourceId);
      if (inherited !== undefined && inherited !== resource.environmentId) {
        error(
          'environment-conflict',
          resource.id,
          `Resource sets environment "${resource.environmentId}" but its ancestors are in "${inherited}"`,
        );
      }
    }
    if (!index.resources.has(resource.parentResourceId)) {
      error('missing-parent', resource.id, `Resource references unknown parent "${resource.parentResourceId}"`);
      continue;
    }
    // Walk up the parent chain; revisiting this resource means it is on a cycle.
    const visited = new Set<EntityId>();
    let current: EntityId | undefined = resource.parentResourceId;
    while (current !== undefined && !visited.has(current)) {
      if (current === resource.id) {
        error('parent-cycle', resource.id, `Resource "${resource.id}" is its own ancestor`);
        break;
      }
      visited.add(current);
      current = index.resources.get(current)?.parentResourceId;
    }
  }

  for (const relationship of data.relationships) {
    const { id, sourceEntityId, targetEntityId } = relationship;
    if (sourceEntityId === targetEntityId) {
      error('self-relationship', id, 'Relationship connects an entity to itself');
    }
    for (const endpoint of [sourceEntityId, targetEntityId]) {
      const resource = index.resources.get(endpoint);
      if (index.instances.has(endpoint)) continue;
      if (!resource) {
        const message = seen.has(endpoint)
          ? `Endpoint "${endpoint}" is not a service instance or resource`
          : `Relationship references unknown endpoint "${endpoint}"`;
        error(seen.has(endpoint) ? 'invalid-relationship-endpoint' : 'missing-relationship-endpoint', id, message);
      } else if (CONTAINMENT_ONLY_RESOURCE_TYPES.has(resource.type)) {
        error(
          'invalid-relationship-endpoint',
          id,
          `Endpoint "${endpoint}" is a ${resource.type}; containment is not communication`,
        );
      }
    }
    // RabbitMQ bindings: an exchange routes only to queues or other exchanges, never straight to a consumer.
    const source = index.resources.get(sourceEntityId);
    const target = index.resources.get(targetEntityId);
    if (source?.type === 'exchange' && target?.type !== 'queue' && target?.type !== 'exchange') {
      error('invalid-binding-target', id, 'An exchange can only be bound to a queue or another exchange');
    }
    const sourceEnvironment = environmentOf(index, sourceEntityId);
    const targetEnvironment = environmentOf(index, targetEntityId);
    // Environments are isolated (ADR-008): only environment-independent entities (e.g. SaaS) may be shared.
    if (sourceEnvironment && targetEnvironment && sourceEnvironment !== targetEnvironment) {
      error(
        'cross-environment-relationship',
        id,
        `Relationship crosses environments ("${sourceEnvironment}" → "${targetEnvironment}")`,
      );
    }
  }

  return issues;
}
