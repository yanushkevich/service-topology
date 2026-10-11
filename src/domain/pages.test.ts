import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { containmentForest, type ContainmentNode } from './containment';
import { environmentSummary } from './summary';
import { buildTopologyIndex } from './topologyIndex';
import { dependencyTree } from './traversal';

const index = buildTopologyIndex(mockTopology);
const find = (nodes: ContainmentNode[], id: string): ContainmentNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return undefined;
};

describe('dependencyTree', () => {
  it('lists upstream dependencies at their shortest depth, with path and relationship', () => {
    const up = dependencyTree(index, 'order-service.production', 'upstream');
    expect(up.filter((e) => e.depth === 1).map((e) => e.entityId).sort()).toEqual(
      ['inventory-service.production', 'payment-service.production', 'rds-orders-prod', 'topic-orders-events-prod'],
    );
    const ledger = up.find((e) => e.entityId === 'ledger-service.production');
    expect(ledger).toMatchObject({ depth: 3, viaRelationshipId: 'rel:topic-payments-events-prod->ledger-service.production' });
    expect(ledger?.path).toEqual(['order-service.production', 'payment-service.production', 'topic-payments-events-prod', 'ledger-service.production']);
    expect(new Set(up.map((e) => e.entityId)).size).toBe(up.length);
  });

  it('lists downstream dependents', () => {
    const down = dependencyTree(index, 'rds-orders-prod', 'downstream');
    expect(down.map((e) => [e.entityId, e.depth])).toEqual([
      ['legacy-report-cron.production', 1],
      ['order-service.production', 1],
      ['api-gateway.production', 2],
    ]);
  });

  it('returns nothing for an entity without relationships', () => {
    expect(dependencyTree(index, 'kafka-events-prod', 'upstream')).toEqual([]);
  });
});

describe('containmentForest', () => {
  const forest = containmentForest(index, 'production');

  it('builds provider → explicit containment, scoped to the environment', () => {
    expect(forest.roots.map((r) => r.name)).toEqual(['AWS', 'Azure', 'GCP', 'On-premises']);
    const cluster = find(forest.roots, 'eks-commerce-prod');
    expect(cluster?.children.map((c) => c.id)).toEqual(['ns-commerce-prod', 'ns-edge-prod']);
    expect(find(forest.roots, 'eks-commerce-staging')).toBeUndefined(); // other environment
    expect(find(forest.roots, 'order-service.staging')).toBeUndefined();
  });

  it('rolls up worst health and counts', () => {
    const ns = find(forest.roots, 'ns-commerce-prod')!;
    expect(ns.rollupHealth).toBe('degraded'); // inventory-service degraded
    expect(ns.descendantCount).toBe(4);
    const onPrem = forest.roots.find((r) => r.provider === 'on-prem')!;
    expect(onPrem.rollupHealth).toBe('unavailable'); // notification-service
    expect(onPrem.unhealthyCount).toBeGreaterThanOrEqual(2);
  });

  it('marks inherited environments and lists environment-independent resources separately', () => {
    expect(find(forest.roots, 'ns-commerce-prod')).toMatchObject({ environmentId: 'production', environmentInherited: true });
    expect(find(forest.roots, 'aks-payments-prod')).toMatchObject({ environmentInherited: false });
    expect(forest.independent.map((n) => n.id)).toEqual(['ext-card-processor', 'ext-email-delivery']);
  });

  it('includes a shared account only through its in-environment descendants', () => {
    const staging = containmentForest(index, 'staging');
    const nonprod = find(staging.roots, 'aws-acct-commerce-nonprod')!;
    expect(find([nonprod], 'eks-commerce-staging')).toBeDefined();
    expect(find([nonprod], 'eks-commerce-dev')).toBeUndefined();
  });
});

describe('environmentSummary', () => {
  it('counts entities, relationships, health, and providers for the environment', () => {
    const s = environmentSummary(index, 'production');
    expect(s.instances).toBe(14);
    expect(s.byHealth.unavailable).toBe(1);
    expect(s.needsAttention[0]).toMatchObject({ health: 'unavailable', name: 'Notification Service' });
    expect(s.needsAttention.every((r) => r.health === 'degraded' || r.health === 'unavailable')).toBe(true);
    expect(s.byProvider.map((p) => p.provider)).toEqual(expect.arrayContaining(['aws', 'azure', 'gcp', 'on-prem', 'saas']));
    expect(s.relationships).toBe(32);
    expect(environmentSummary(index, 'development')).toMatchObject({ instances: 2, relationships: 1 });
  });
});
