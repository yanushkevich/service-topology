import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { buildTopologyIndex, environmentOf, resourceAncestors } from './topologyIndex';
import type { TopologyData } from './types';
import { validateTopology } from './validation';

function clone(): TopologyData {
  return structuredClone(mockTopology);
}

function codes(data: TopologyData) {
  return validateTopology(data).map((issue) => `${issue.severity}:${issue.code}:${issue.entityId}`);
}

describe('mock topology integrity', () => {
  it('has no validation errors or warnings', () => {
    expect(validateTopology(mockTopology)).toEqual([]);
  });

  it('has 15+ connected entities spanning AWS, Azure, GCP, and on-prem', () => {
    const index = buildTopologyIndex(mockTopology);
    const connected = new Set(mockTopology.relationships.flatMap((r) => [r.sourceEntityId, r.targetEntityId]));
    expect(connected.size).toBeGreaterThanOrEqual(15);

    const providers = new Set(
      [...connected].map((id) => index.instances.get(id)?.provider ?? index.resources.get(id)?.provider),
    );
    for (const provider of ['aws', 'azure', 'gcp', 'on-prem'] as const) expect(providers).toContain(provider);
  });

  it('gives each service instance exactly one existing environment', () => {
    const index = buildTopologyIndex(mockTopology);
    for (const instance of mockTopology.serviceInstances) {
      expect(typeof instance.environmentId).toBe('string');
      expect(index.environments.has(instance.environmentId)).toBe(true);
    }
  });

  it('deploys at least one logical definition to multiple environments', () => {
    const index = buildTopologyIndex(mockTopology);
    const envs = (index.instancesByDefinition.get('order-service') ?? []).map((i) => i.environmentId);
    expect(new Set(envs)).toEqual(new Set(['production', 'staging', 'development']));
  });

  it('models Kafka topics and a RabbitMQ exchange/queue as first-class communicating resources', () => {
    const index = buildTopologyIndex(mockTopology);
    for (const type of ['topic', 'exchange', 'queue'] as const) {
      const resources = mockTopology.resources.filter((r) => r.type === type);
      expect(resources.length).toBeGreaterThan(0);
      // Producer → resource → consumer, as explicit relationships.
      expect(resources.some((r) => index.incoming.has(r.id) && index.outgoing.has(r.id))).toBe(true);
    }
  });

  it('keeps containment as parent references, never as relationships', () => {
    const index = buildTopologyIndex(mockTopology);
    expect(resourceAncestors(index, 'topic-orders-events-prod').map((r) => r.id)).toEqual([
      'gcp-proj-data',
      'gcp-usc1',
      'kafka-events-prod',
    ]);
    expect(environmentOf(index, 'topic-orders-events-prod')).toBe('production');
    expect(environmentOf(index, 'ext-card-processor')).toBeUndefined();
  });
});

describe('validateTopology', () => {
  it('reports duplicate IDs across collections', () => {
    const data = clone();
    data.resources.push({ id: 'order-service', name: 'clash', type: 'other', provider: 'unknown' });
    expect(codes(data)).toContain('error:duplicate-id:order-service');
  });

  it('reports instances with a missing or non-singular environment', () => {
    const data = clone();
    data.serviceInstances[0]!.environmentId = 'nowhere';
    (data.serviceInstances[1] as { environmentId: unknown }).environmentId = ['production', 'staging'];
    const result = codes(data);
    expect(result).toContain(`error:missing-environment:${data.serviceInstances[0]!.id}`);
    expect(result).toContain(`error:missing-environment:${data.serviceInstances[1]!.id}`);
  });

  it('reports missing service definitions and resources', () => {
    const data = clone();
    const instance = data.serviceInstances[0]!;
    instance.serviceDefinitionId = 'ghost';
    instance.resourceId = 'ghost-ns';
    expect(codes(data)).toEqual(
      expect.arrayContaining([
        `error:missing-service-definition:${instance.id}`,
        `error:missing-resource:${instance.id}`,
      ]),
    );
  });

  it('reports missing parents', () => {
    const data = clone();
    data.resources.find((r) => r.id === 'ns-edge-prod')!.parentResourceId = 'ghost-cluster';
    expect(codes(data)).toContain('error:missing-parent:ns-edge-prod');
  });

  it('reports parent cycles for every resource on the cycle', () => {
    const data = clone();
    data.resources.find((r) => r.id === 'aws-acct-commerce-prod')!.parentResourceId = 'eks-commerce-prod';
    const result = codes(data);
    for (const id of ['aws-acct-commerce-prod', 'aws-use1-prod', 'eks-commerce-prod']) {
      expect(result).toContain(`error:parent-cycle:${id}`);
    }
    // Descendants of the cycle are not themselves on it.
    expect(result).not.toContain('error:parent-cycle:ns-edge-prod');
  });

  it('reports a resource that is its own parent', () => {
    const data = clone();
    data.resources.find((r) => r.id === 'dc-fra')!.parentResourceId = 'dc-fra';
    expect(codes(data)).toContain('error:parent-cycle:dc-fra');
  });

  it('reports unknown, self, and containment-only relationship endpoints', () => {
    const data = clone();
    const base = data.relationships[0]!;
    data.relationships.push(
      { ...base, id: 'r-missing', targetEntityId: 'ghost' },
      { ...base, id: 'r-self', targetEntityId: base.sourceEntityId },
      { ...base, id: 'r-containment', targetEntityId: 'eks-commerce-prod' },
      { ...base, id: 'r-definition', targetEntityId: 'order-service' },
    );
    expect(codes(data)).toEqual(
      expect.arrayContaining([
        'error:missing-relationship-endpoint:r-missing',
        'error:self-relationship:r-self',
        'error:invalid-relationship-endpoint:r-containment',
        'error:invalid-relationship-endpoint:r-definition',
      ]),
    );
  });

  it('rejects relationships that cross environments, including through inherited environments', () => {
    const data = clone();
    data.relationships.push(
      { ...data.relationships[0]!, id: 'r-cross', targetEntityId: 'order-service.staging' },
      // Topic inherits "production" from its broker; the staging instance must not consume it.
      { ...data.relationships[0]!, id: 'r-cross-inherited', sourceEntityId: 'topic-orders-events-prod', targetEntityId: 'inventory-service.staging' },
    );
    expect(codes(data)).toEqual(
      expect.arrayContaining([
        'error:cross-environment-relationship:r-cross',
        'error:cross-environment-relationship:r-cross-inherited',
      ]),
    );
  });

  it('allows environment-independent entities to be shared across environments', () => {
    const relationships = mockTopology.relationships.filter((r) => r.targetEntityId === 'ext-card-processor');
    const environments = new Set(relationships.map((r) => r.sourceEntityId.split('.').at(-1)));
    expect(environments).toEqual(new Set(['production', 'staging']));
  });

  it('rejects a resource whose environment conflicts with the one it inherits', () => {
    const data = clone();
    data.resources.find((r) => r.id === 'ns-commerce-prod')!.environmentId = 'staging';
    // Restating the inherited environment is allowed.
    data.resources.find((r) => r.id === 'ns-edge-prod')!.environmentId = 'production';
    const result = codes(data);
    expect(result).toContain('error:environment-conflict:ns-commerce-prod');
    expect(result).not.toContain('error:environment-conflict:ns-edge-prod');
  });

  it('only allows exchanges to be bound to queues or exchanges', () => {
    const data = clone();
    const binding = data.relationships.find((r) => r.sourceEntityId === 'exchange-notifications-prod')!;
    data.relationships.push({ ...binding, id: 'r-exchange-to-consumer', targetEntityId: 'email-dispatcher.production' });
    expect(codes(data)).toEqual(['error:invalid-binding-target:r-exchange-to-consumer']);
  });

  it('rejects an instance that runs in a resource assigned to another environment', () => {
    const data = clone();
    // ns-commerce-prod inherits "production" from its account.
    data.serviceInstances.find((i) => i.id === 'order-service.staging')!.resourceId = 'ns-commerce-prod';
    expect(codes(data)).toContain('error:environment-mismatch:order-service.staging');
  });

  it('accepts an instance hosted in an environment-independent resource', () => {
    const data = clone();
    // The nonprod account has no environment of its own.
    data.serviceInstances.find((i) => i.id === 'order-service.staging')!.resourceId = 'aws-acct-commerce-nonprod';
    expect(codes(data)).toEqual([]);
  });
});
