import { describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000 } from '../../../data/mock/generateTopology';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { effectivePath, resolveGalaxyScope } from './scope';

const index = buildTopologyIndex(mockTopology);
const base = { environmentId: 'production', filters: EMPTY_FILTERS } as const;
const ids = (model: { nodes: { id: string }[] }) => model.nodes.map((n) => n.id);
const byRole = (model: ReturnType<typeof resolveGalaxyScope>, role: string) => model.nodes.filter((n) => n.role === role).map((n) => n.id);

describe('galaxy overview', () => {
  const overview = resolveGalaxyScope(index, { ...base, path: [] });

  it('groups the same entities as the 2D map into constellations by outermost container', () => {
    expect(overview.kind).toBe('overview');
    expect(overview.groups.map((g) => g.id)).toEqual(['aws-acct-commerce-prod', 'az-sub-payments', 'dc-fra', 'external', 'gcp-proj-data']);
    expect(overview.groups.find((g) => g.id === 'az-sub-payments')?.memberIds).toEqual([
      'fraud-scoring.production',
      'ledger-service.production',
      'payment-service.production',
      'payout-worker.production',
      'pg-payments-prod',
    ]);
    expect(byRole(overview, 'core')).toEqual(['aws-acct-commerce-prod', 'az-sub-payments', 'dc-fra', 'gcp-proj-data']);
  });

  it('draws communication edges between entities, and no containment links', () => {
    expect(overview.containment).toEqual([]);
    expect(overview.edges.some((e) => e.id === 'rel:order-service.production->payment-service.production')).toBe(true);
    expect(overview.edges.every((e) => ids(overview).includes(e.source) && ids(overview).includes(e.target))).toBe(true);
  });

  it('applies shared filters and environment', () => {
    const filtered = resolveGalaxyScope(index, { ...base, path: [], filters: { ...EMPTY_FILTERS, groups: ['messaging'] } });
    expect(byRole(filtered, 'member').every((id) => /topic|queue|exchange/.test(id))).toBe(true);
    const staging = resolveGalaxyScope(index, { ...base, environmentId: 'staging', path: [] });
    expect(byRole(staging, 'member')).toContain('order-service.staging');
    expect(byRole(staging, 'member')).not.toContain('order-service.production');
  });

  it('marks traffic as simulated when it comes from simulated metrics', () => {
    const edge = overview.edges.find((e) => e.id === 'rel:api-gateway.production->web-bff.production');
    expect(edge).toMatchObject({ throughputPerSecond: 1300, trafficSimulated: true });
    expect(overview.edges.find((e) => e.id === 'rel:payout-worker.production->ledger-service.production')?.throughputPerSecond).toBeUndefined();
  });

  it('aggregates constellations above the node limit (1,000-entity inventory)', () => {
    const big = buildTopologyIndex(generateTopology(INVENTORY_1000));
    const model = resolveGalaxyScope(big, { ...base, path: [] });
    expect(model.aggregated).toBe(true);
    expect(model.nodes.length).toBeLessThanOrEqual(10);
    expect(model.nodes.reduce((sum, n) => sum + n.memberCount, 0)).toBeGreaterThan(250);
    expect(model.note).toMatch(/collapsed/);
  });
});

describe('galaxy entity scopes', () => {
  it('container: shows modeled children with containment links and grandchildren on sub-rings', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['aws-acct-commerce-prod', 'eks-commerce-prod'] });
    expect(model.kind).toBe('container');
    expect(byRole(model, 'center')).toEqual(['eks-commerce-prod']);
    expect(byRole(model, 'child')).toEqual(['ns-commerce-prod', 'ns-edge-prod']);
    expect(byRole(model, 'grandchild')).toContain('order-service.production');
    expect(model.containment).toContainEqual({ parentId: 'eks-commerce-prod', childId: 'ns-commerce-prod' });
    expect(model.containment).toContainEqual({ parentId: 'ns-commerce-prod', childId: 'order-service.production' });
  });

  it('container: real outside partners appear at the sides, never inside', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['aws-acct-commerce-prod', 'eks-commerce-prod'] });
    expect(byRole(model, 'outbound')).toContain('payment-service.production'); // order → payment (Azure)
    expect(byRole(model, 'outbound')).toContain('rds-orders-prod');
    expect(byRole(model, 'inbound')).toContain('topic-orders-events-prod'); // topic → inventory (bidirectional partner shown once)
    for (const e of model.edges) {
      const roles = [e.source, e.target].map((id) => model.nodes.find((n) => n.id === id)?.role);
      expect(roles.every((r) => r === 'inbound' || r === 'outbound')).toBe(false);
    }
  });

  it('leaf: an instance has no fabricated interior; its real neighborhood is shown with a note', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['payment-service.production'] });
    expect(model.kind).toBe('leaf');
    expect(model.containment).toEqual([]);
    expect(byRole(model, 'child')).toEqual([]);
    expect(byRole(model, 'outbound').sort()).toEqual(
      ['ext-card-processor', 'fraud-scoring.production', 'pg-payments-prod', 'topic-payments-events-prod'],
    );
    expect(byRole(model, 'inbound')).toEqual(['order-service.production']);
    expect(model.note).toMatch(/no modeled children/);
  });

  it('topic: producers and consumers', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['topic-orders-events-prod'] });
    expect(byRole(model, 'inbound')).toEqual(['order-service.production']);
    expect(byRole(model, 'outbound')).toEqual(['inventory-service.production', 'notification-service.production']);
  });

  it('broker: topics are children (containment); producers/consumers are outside partners', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['kafka-events-prod'] });
    expect(byRole(model, 'child')).toEqual(['topic-inventory-updates-prod', 'topic-orders-events-prod', 'topic-payments-events-prod']);
    expect(byRole(model, 'inbound')).toContain('payment-service.production');
    expect(byRole(model, 'outbound')).toContain('ledger-service.production');
  });

  it('logical service: its instances across environments', () => {
    const model = resolveGalaxyScope(index, { ...base, path: ['order-service'] });
    expect(byRole(model, 'child')).toEqual(['order-service.development', 'order-service.production', 'order-service.staging']);
  });

  it('drops unknown path segments (keeps the valid prefix)', () => {
    expect(effectivePath(index, ['aws-acct-commerce-prod', 'ghost', 'eks-commerce-prod'])).toEqual(['aws-acct-commerce-prod']);
    expect(resolveGalaxyScope(index, { ...base, path: ['ghost'] }).kind).toBe('overview');
  });

  it('is deterministic', () => {
    const opts = { ...base, path: ['aws-acct-commerce-prod', 'eks-commerce-prod'] };
    expect(resolveGalaxyScope(index, opts)).toEqual(resolveGalaxyScope(index, opts));
  });
});
