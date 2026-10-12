import { describe, expect, it } from 'vitest';
import { mockTopology } from '../../data/mock/topology';
import { WRITABLE_KINDS } from '../../data/repositories/TopologyRepository';
import { buildTopologyIndex } from '../../domain/topologyIndex';
import type { ServiceInstance } from '../../domain/types';
import {
  applyChange,
  emptyValues,
  entityFromValues,
  fieldsFor,
  idError,
  idTaken,
  newIssues,
  suggestId,
  valuesFromEntity,
  type FormContext,
} from './entityForms';

const ctx = (editingId: string | null = null): FormContext => ({ data: mockTopology, index: buildTopologyIndex(mockTopology), environmentId: 'production', editingId });

describe('entity form model (ADR-020)', () => {
  it('round-trips every entity of the mock through form values unchanged', () => {
    const samples = {
      environment: mockTopology.environments[0]!,
      'service-definition': mockTopology.serviceDefinitions[0]!,
      'service-instance': mockTopology.serviceInstances[0]!,
      resource: mockTopology.resources.find((r) => r.parentResourceId && r.health)!,
      relationship: mockTopology.relationships.find((r) => r.metadata)!,
      'event-type': mockTopology.eventTypes![0]!,
    };
    for (const kind of WRITABLE_KINDS) {
      const entity = samples[kind];
      const c = ctx(entity.id);
      const result = entityFromValues(kind, valuesFromEntity(kind, entity as never, c), c, entity as never);
      expect(result.errors, kind).toBeNull();
      expect(result.entity, kind).toEqual(entity);
    }
  });

  it('starts new entities with valid choices for required selects and the current environment', () => {
    const values = emptyValues('service-instance', ctx());
    expect(values).toMatchObject({ environmentId: 'production', provider: 'unknown', health: 'unknown' });
    expect(values.serviceDefinitionId).not.toBe('');
    expect(fieldsFor('service-instance', ctx()).find((f) => f.name === 'resourceId')?.required).toBeFalsy();
  });

  it('reports missing required fields, bad IDs, and invalid metadata JSON', () => {
    const result = entityFromValues('resource', { id: 'a/b', name: ' ', type: 'database', provider: 'aws', metadata: '[1]' }, ctx(), null);
    expect(result.errors).toEqual({ id: 'No slashes, control characters, or surrounding spaces.', name: 'Required.', metadata: 'Must be a JSON object, e.g. {"tier": "gold"}.' });
    expect(idError('')).toBe('Required.');
    expect(idError('x'.repeat(201))).toBe('At most 200 characters.');
    expect(idError('ok-id.production')).toBeNull();
  });

  it('omits empty optional fields and keeps stored telemetry on edit', () => {
    const instance = mockTopology.serviceInstances.find((i) => i.metrics)!;
    const c = ctx(instance.id);
    const values = { ...valuesFromEntity('service-instance', instance, c), version: '', resourceId: '' };
    const { entity } = entityFromValues('service-instance', values, c, instance);
    expect(entity).not.toHaveProperty('version');
    expect(entity).not.toHaveProperty('resourceId');
    expect(entity?.metrics).toEqual(instance.metrics);
    expect(entity?.updatedAt).toBe(instance.updatedAt);
  });

  it('never offers a resource or its descendants as its own parent', () => {
    const parents = fieldsFor('resource', ctx('eks-commerce-prod')).find((f) => f.name === 'parentResourceId')!.options!.map((o) => o.value);
    expect(parents).not.toContain('eks-commerce-prod');
    expect(parents).not.toContain('ns-commerce-prod'); // a child namespace of the cluster
    expect(parents).toContain('aws-use1-prod'); // its current parent stays available
  });

  it('suggests readable IDs', () => {
    expect(suggestId('service-instance', { serviceDefinitionId: 'billing', environmentId: 'qa' })).toBe('billing.qa');
    expect(suggestId('relationship', { sourceEntityId: 'a', targetEntityId: 'b' })).toBe('rel:a->b');
    expect(suggestId('event-type', { name: 'Invoice Paid' })).toBe('event-invoice-paid');
    expect(suggestId('environment', { name: '  QA / Load test ' })).toBe('qa-load-test');
  });

  it('finds what a change breaks, not issues that existed before', () => {
    const deleteUsedEnvironment = applyChange(mockTopology, 'environment', { op: 'delete', id: 'production' });
    const blockers = newIssues(mockTopology, deleteUsedEnvironment);
    expect(blockers.length).toBeGreaterThan(0);
    expect(new Set(blockers.map((i) => i.code))).toContain('missing-environment');

    const orphanRelationship = mockTopology.relationships[0]!;
    expect(newIssues(mockTopology, applyChange(mockTopology, 'relationship', { op: 'delete', id: orphanRelationship.id })).filter((i) => i.code !== 'event-flow-missing-relationship')).toEqual([]);

    const cross = { ...orphanRelationship, id: 'rel:cross', sourceEntityId: 'order-service.production', targetEntityId: 'order-service.staging' };
    const crossEnvironment = applyChange(mockTopology, 'relationship', { op: 'create', entity: cross });
    expect(newIssues(mockTopology, crossEnvironment).map((i) => i.code)).toContain('cross-environment-relationship');
    expect(mockTopology.relationships).not.toContainEqual(expect.objectContaining({ id: 'rel:cross' })); // input untouched
  });

  it('detects IDs used by any kind', () => {
    expect(idTaken(mockTopology, 'payment-service')).toBe(true);
    expect(idTaken(mockTopology, 'production')).toBe(true);
    expect(idTaken(mockTopology, 'brand-new')).toBe(false);
  });

  it('applies replacements in place', () => {
    const instance: ServiceInstance = { ...mockTopology.serviceInstances[0]!, health: 'unavailable' };
    const after = applyChange(mockTopology, 'service-instance', { op: 'update', entity: instance });
    expect(after.serviceInstances[0]).toEqual(instance);
    expect(after.serviceInstances).toHaveLength(mockTopology.serviceInstances.length);
  });
});
