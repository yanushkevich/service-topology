import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { buildTopologyIndex } from './topologyIndex';
import { neighborhood, reachFrom } from './traversal';

const index = buildTopologyIndex(mockTopology);

describe('reachFrom', () => {
  it('direct: immediate neighbors in both directions', () => {
    const { entityIds, relationshipIds } = reachFrom(index, 'topic-orders-events-prod', 'direct');
    expect([...entityIds].sort()).toEqual(
      ['inventory-service.production', 'notification-service.production', 'order-service.production', 'topic-orders-events-prod'],
    );
    expect(relationshipIds.size).toBe(3);
  });

  it('upstream: everything the entity transitively depends on, through topics', () => {
    const { entityIds } = reachFrom(index, 'order-service.production', 'upstream');
    // order → orders.events → inventory → inventory.updates → catalog → catalog-search
    for (const id of ['topic-orders-events-prod', 'inventory-service.production', 'catalog-service.production', 'search-catalog-prod', 'ext-card-processor']) {
      expect(entityIds).toContain(id);
    }
    expect(entityIds).not.toContain('api-gateway.production');
  });

  it('downstream: everything that transitively depends on the entity', () => {
    const { entityIds } = reachFrom(index, 'rds-orders-prod', 'downstream');
    expect(entityIds).toEqual(
      new Set(['rds-orders-prod', 'order-service.production', 'legacy-report-cron.production', 'api-gateway.production']),
    );
  });

  it('terminates on cycles', () => {
    const data = structuredClone(mockTopology);
    data.relationships.push({ ...data.relationships[0]!, id: 'cycle', sourceEntityId: 'web-bff.production', targetEntityId: 'api-gateway.production' });
    const result = reachFrom(buildTopologyIndex(data), 'api-gateway.production', 'upstream');
    expect(result.entityIds).toContain('web-bff.production');
  });
});

describe('neighborhood', () => {
  it('expands hop by hop, ignoring direction', () => {
    expect(neighborhood(index, 'ledger-service.production', 0)).toEqual(new Set(['ledger-service.production']));
    expect(neighborhood(index, 'ledger-service.production', 1)).toEqual(
      new Set(['ledger-service.production', 'topic-payments-events-prod', 'pg-ledger-prod', 'payout-worker.production']),
    );
    expect(neighborhood(index, 'ledger-service.production', 2)).toContain('payment-service.production');
  });
});
