import { reachableFrom, stepById, transitionBacking } from './businessFlow';
import { resolveEventFlow, type EventFlowParticipant } from './eventFlow';
import { buildTopologyIndex, environmentOf } from './topologyIndex';
import { CONTAINMENT_ONLY_RESOURCE_TYPES, EVENT_CHANNEL_TYPES, type EntityId, type TopologyData } from './types';

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
  | 'invalid-binding-target'
  | 'missing-event-channel'
  | 'invalid-event-channel'
  | 'duplicate-event-channel-environment'
  | 'missing-event-service'
  | 'event-flow-missing-relationship'
  | 'missing-flow-service'
  | 'invalid-flow-step'
  | 'invalid-flow-trigger'
  | 'invalid-flow-transition'
  | 'flow-no-success-path'
  | 'flow-transition-unbacked';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  entityId: EntityId;
  message: string;
}

/**
 * Integrity rules for canonical topology data. Every current rule is an error: it breaks a documented
 * invariant (ADR-004, ADR-008). `warning` is reserved for future advisory checks.
 */
export function validateTopology(data: TopologyData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: ValidationCode, entityId: EntityId, message: string) =>
    issues.push({ severity: 'error', code, entityId, message });

  // IDs are unique across every collection, so a bare ID resolves to exactly one entity.
  const seen = new Set<EntityId>();
  const all = [
    ...data.environments,
    ...data.serviceDefinitions,
    ...data.serviceInstances,
    ...data.resources,
    ...data.relationships,
    ...(data.eventTypes ?? []),
    ...(data.businessFlows ?? []),
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
          error(
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

  // Event types (ADR-014) annotate existing messaging; they must agree with the relationships.
  for (const eventType of data.eventTypes ?? []) {
    const channelEnvironments = new Map<string, EntityId>();
    for (const channelId of eventType.channelResourceIds) {
      const channel = index.resources.get(channelId);
      if (!channel) {
        error('missing-event-channel', eventType.id, `Event type references unknown channel "${channelId}"`);
        continue;
      }
      if (!EVENT_CHANNEL_TYPES.has(channel.type)) {
        error('invalid-event-channel', eventType.id, `Channel "${channelId}" is a ${channel.type}, not a topic, queue, or exchange`);
        continue;
      }
      const key = environmentOf(index, channelId) ?? '(environment-independent)';
      const other = channelEnvironments.get(key);
      if (other !== undefined || (channelEnvironments.size > 0 && (key === '(environment-independent)' || channelEnvironments.has('(environment-independent)')))) {
        error(
          'duplicate-event-channel-environment',
          eventType.id,
          `Event type has more than one channel for ${key === '(environment-independent)' ? 'all environments' : `environment "${key}"`}`,
        );
        continue;
      }
      channelEnvironments.set(key, channelId);
    }
    for (const serviceId of [...eventType.producerServiceIds, ...eventType.consumerServiceIds]) {
      if (!index.definitions.has(serviceId)) {
        error('missing-event-service', eventType.id, `Event type references unknown service definition "${serviceId}"`);
      }
    }
    for (const [key, channelId] of channelEnvironments) {
      const flow = resolveEventFlow(index, eventType, key === '(environment-independent)' ? '' : key);
      if (!flow || flow.channelId !== channelId) continue;
      const check = (participants: EventFlowParticipant[], role: string) => {
        for (const p of participants) {
          if (p.instanceId && p.relationshipIds.length === 0 && index.definitions.has(p.serviceDefinitionId)) {
            error(
              'event-flow-missing-relationship',
              eventType.id,
              `"${p.instanceId}" is a ${role} of "${eventType.name}" but has no relationship ${role === 'producer' ? 'to' : 'from'} "${channelId}"`,
            );
          }
        }
      };
      check(flow.producers, 'producer');
      check(flow.consumers, 'consumer');
    }
  }

  // Business flows (ADR-022) annotate existing communication: every hand-off between two services
  // must be backed by a relationship or an event type in each environment where both run.
  for (const flow of data.businessFlows ?? []) {
    const ids = new Set<string>();
    for (const { id } of [...flow.steps, ...flow.outcomes]) {
      if (id.trim() === '' || ids.has(id)) error('invalid-flow-step', flow.id, `Step or outcome ID "${id}" is empty or used twice`);
      ids.add(id);
    }
    for (const step of flow.steps) {
      if (!index.definitions.has(step.serviceDefinitionId)) {
        error('missing-flow-service', flow.id, `Step "${step.id}" references unknown service definition "${step.serviceDefinitionId}"`);
      }
      if (step.compensatedBy !== undefined && stepById(flow, step.compensatedBy)?.kind !== 'compensation') {
        error('invalid-flow-step', flow.id, `Step "${step.id}" is compensated by "${step.compensatedBy}", which is not a compensation step of this flow`);
      }
    }
    const start = stepById(flow, flow.startStepId);
    if (!start) error('invalid-flow-step', flow.id, `Start step "${flow.startStepId}" is not a step of this flow`);
    const { trigger } = flow;
    if (trigger.kind === 'call' && trigger.ref !== undefined && !index.definitions.has(trigger.ref)) {
      error('invalid-flow-trigger', flow.id, `Trigger references unknown service definition "${trigger.ref}"`);
    }
    if (trigger.kind === 'event') {
      const eventType = trigger.ref === undefined ? undefined : index.eventTypes.get(trigger.ref);
      if (!eventType) error('invalid-flow-trigger', flow.id, `Trigger references unknown event type "${trigger.ref ?? ''}"`);
      else if (start && !eventType.consumerServiceIds.includes(start.serviceDefinitionId)) {
        error('invalid-flow-trigger', flow.id, `"${eventType.name}" is not consumed by "${start.serviceDefinitionId}", which runs the start step`);
      }
    }

    const transitionIds = new Set<string>();
    for (const t of flow.transitions) {
      const bad = (message: string) => error('invalid-flow-transition', flow.id, `Transition "${t.id}": ${message}`);
      if (t.id.trim() === '' || transitionIds.has(t.id)) bad('ID is empty or used twice');
      transitionIds.add(t.id);
      const from = stepById(flow, t.from);
      const to = stepById(flow, t.to);
      if (!from) {
        bad(`unknown source step "${t.from}"`);
        continue;
      }
      if (!to && !flow.outcomes.some((o) => o.id === t.to)) {
        bad(`unknown target "${t.to}"`);
        continue;
      }
      if (!to) continue; // to an outcome: ends the flow
      if (t.via.kind === 'local' && from.serviceDefinitionId !== to.serviceDefinitionId) {
        bad(`a local hand-off must stay in one service ("${from.serviceDefinitionId}" → "${to.serviceDefinitionId}")`);
      } else if (t.via.kind === 'call' && t.via.callerServiceId !== undefined && !index.definitions.has(t.via.callerServiceId)) {
        bad(`unknown caller "${t.via.callerServiceId}"`);
      } else if (t.via.kind === 'event') {
        const eventType = index.eventTypes.get(t.via.eventTypeId);
        if (!eventType) bad(`unknown event type "${t.via.eventTypeId}"`);
        else if (!eventType.producerServiceIds.includes(from.serviceDefinitionId)) bad(`"${from.serviceDefinitionId}" does not produce "${eventType.name}"`);
        else if (!eventType.consumerServiceIds.includes(to.serviceDefinitionId)) bad(`"${to.serviceDefinitionId}" does not consume "${eventType.name}"`);
        else {
          for (const environment of data.environments) {
            const backing = transitionBacking(index, flow, t, environment.id);
            if (backing.status === 'unbacked') error('flow-transition-unbacked', flow.id, `Transition "${t.id}": ${backing.reason}`);
          }
        }
        continue;
      }
      if (t.via.kind === 'call') {
        for (const environment of data.environments) {
          const backing = transitionBacking(index, flow, t, environment.id);
          if (backing.status === 'unbacked') error('flow-transition-unbacked', flow.id, `Transition "${t.id}": ${backing.reason}`);
        }
      }
    }
    if (start) {
      const reached = reachableFrom(flow);
      if (!flow.outcomes.some((o) => o.kind === 'success' && reached.has(o.id))) {
        error('flow-no-success-path', flow.id, `No path reaches a success outcome, starting at step "${flow.startStepId}"`);
      }
    }
  }

  return issues;
}
