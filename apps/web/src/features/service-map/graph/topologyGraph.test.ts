import { describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000, SCALE_250 } from '../../../data/mock/generateTopology';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { validateTopology } from '../../../domain/validation';
import { buildTopologyGraph, groupIdsAtDepth, providerGroupId } from './topologyGraph';

const index = buildTopologyIndex(mockTopology);
const base = { environmentId: 'production', filters: EMPTY_FILTERS } as const;

describe('buildTopologyGraph — topology mode', () => {
  const graph = buildTopologyGraph(index, { ...base, mode: 'topology' });
  const ids = graph.nodes.map((n) => n.id);

  it('shows instances and connected resources of the environment, never containment levels', () => {
    expect(ids).toContain('order-service.production');
    expect(ids).toContain('topic-orders-events-prod');
    expect(ids).toContain('ext-card-processor'); // environment-independent, connected
    expect(ids).not.toContain('order-service.staging');
    expect(ids).not.toContain('eks-commerce-prod');
    expect(ids).not.toContain('kafka-events-prod'); // broker without relationships
    expect(graph.groups).toEqual([]);
  });

  it('maps every relationship between visible nodes to one edge keyed by canonical ID', () => {
    const visible = new Set(ids);
    const expected = mockTopology.relationships.filter((r) => visible.has(r.sourceEntityId) && visible.has(r.targetEntityId));
    expect(graph.edges.map((e) => e.id).sort()).toEqual(expected.map((r) => r.id).sort());
    const topicEdge = graph.edges.find((e) => e.id === 'rel:order-service.production->topic-orders-events-prod');
    expect(topicEdge).toMatchObject({ kind: 'event', relationshipIds: ['rel:order-service.production->topic-orders-events-prod'] });
  });

  it('hides SaaS nodes that only connect to other environments', () => {
    const dev = buildTopologyGraph(index, { ...base, environmentId: 'development', mode: 'topology' });
    expect(dev.nodes.map((n) => n.id).sort()).toEqual(['catalog-service.development', 'order-service.development']);
  });

  it('applies shared filters and drops edges to hidden nodes', () => {
    const filtered = buildTopologyGraph(index, { ...base, mode: 'topology', filters: { ...EMPTY_FILTERS, groups: ['messaging'] } });
    expect(filtered.nodes.every((n) => ['topic', 'queue', 'exchange'].includes(n.type))).toBe(true);
    expect(filtered.edges.map((e) => e.id)).toEqual(['rel:exchange-notifications-prod->queue-notifications-email-prod']);
  });

  it('restricts to a neighborhood', () => {
    const near = buildTopologyGraph(index, { ...base, mode: 'topology', neighborhood: { centerId: 'ledger-service.production', depth: 1 } });
    expect(near.nodes.map((n) => n.id).sort()).toEqual(
      ['ledger-service.production', 'payout-worker.production', 'pg-ledger-prod', 'topic-payments-events-prod'],
    );
  });
});

describe('buildTopologyGraph — infrastructure mode', () => {
  const graph = buildTopologyGraph(index, { ...base, mode: 'infrastructure' });
  const group = (id: string) => graph.groups.find((g) => g.id === id);

  it('groups by provider, then explicit containment', () => {
    expect(group(providerGroupId('aws'))).toMatchObject({ depth: 0, parentId: undefined });
    expect(group('aws-acct-commerce-prod')).toMatchObject({ parentId: 'provider:aws', depth: 1 });
    expect(group('ns-commerce-prod')).toMatchObject({ parentId: 'eks-commerce-prod' });
    expect(graph.nodes.find((n) => n.id === 'order-service.production')?.groupId).toBe('ns-commerce-prod');
    expect(graph.nodes.find((n) => n.id === 'topic-orders-events-prod')?.groupId).toBe('kafka-events-prod');
    expect(graph.nodes.find((n) => n.id === 'ext-card-processor')?.groupId).toBe('provider:saas');
  });

  it('keeps the same nodes and edges as topology mode (same graph, different grouping)', () => {
    const topo = buildTopologyGraph(index, { ...base, mode: 'topology' });
    expect(graph.nodes.map((n) => n.id)).toEqual(topo.nodes.map((n) => n.id));
    expect(graph.edges.map((e) => e.id)).toEqual(topo.edges.map((e) => e.id));
  });

  it('lists parents before children', () => {
    const order = graph.groups.map((g) => g.id);
    for (const g of graph.groups) if (g.parentId) expect(order.indexOf(g.parentId)).toBeLessThan(order.indexOf(g.id));
  });

  it('collapses a group into one node with merged, deduplicated edges and worst health', () => {
    const collapsed = buildTopologyGraph(index, { ...base, mode: 'infrastructure', collapsedGroupIds: new Set(['kafka-events-prod']) });
    const node = collapsed.nodes.find((n) => n.id === 'kafka-events-prod');
    expect(node).toMatchObject({ kind: 'collapsed-group', memberCount: 3, health: 'healthy' });
    expect(collapsed.nodes.some((n) => n.id === 'topic-orders-events-prod')).toBe(false);
    expect(collapsed.groups.some((g) => g.id === 'kafka-events-prod')).toBe(false);
    const toConsumer = collapsed.edges.filter((e) => e.source === 'kafka-events-prod' && e.target === 'inventory-service.production');
    expect(toConsumer).toHaveLength(1);
    expect(collapsed.edges.every((e) => e.source !== e.target)).toBe(true);
  });

  it('collapsing an outer group hides groups nested inside it', () => {
    const collapsed = buildTopologyGraph(index, { ...base, mode: 'infrastructure', collapsedGroupIds: new Set(['provider:aws', 'ns-commerce-prod']) });
    expect(collapsed.groups.some((g) => g.id === 'ns-commerce-prod')).toBe(false);
    expect(collapsed.nodes.some((n) => n.id === 'ns-commerce-prod')).toBe(false);
    expect(collapsed.nodes.find((n) => n.id === 'provider:aws')?.memberCount).toBe(10);
  });
});

describe('scale fixtures', () => {
  it('SCALE_250 is valid and yields exactly 250 nodes / 750 edges in production', () => {
    const data = generateTopology(SCALE_250);
    expect(validateTopology(data)).toEqual([]);
    const graph = buildTopologyGraph(buildTopologyIndex(data), { ...base, mode: 'topology' });
    expect(graph.nodes).toHaveLength(250);
    expect(graph.edges).toHaveLength(750);
  });

  it('generation is deterministic', () => {
    expect(generateTopology(SCALE_250)).toEqual(generateTopology(SCALE_250));
  });

  it('INVENTORY_1000 has 1,000+ entities and is navigable below the visible-node target', () => {
    const data = generateTopology(INVENTORY_1000);
    expect(validateTopology(data)).toEqual([]);
    expect(data.serviceInstances.length + data.resources.length).toBeGreaterThanOrEqual(1000);
    const big = buildTopologyIndex(data);

    const full = buildTopologyGraph(big, { ...base, mode: 'topology' });
    expect(full.nodes.length).toBeGreaterThan(250); // too many to render at full detail

    const searched = buildTopologyGraph(big, { ...base, mode: 'topology', filters: { ...EMPTY_FILTERS, query: 'payments' } });
    expect(searched.nodes.length).toBeGreaterThan(0);
    expect(searched.nodes.length).toBeLessThanOrEqual(250);

    const near = buildTopologyGraph(big, { ...base, mode: 'topology', neighborhood: { centerId: full.nodes[0]!.id, depth: 1 } });
    expect(near.nodes.length).toBeLessThanOrEqual(250);

    const grouped = buildTopologyGraph(big, { ...base, mode: 'infrastructure' });
    const collapsed = buildTopologyGraph(big, { ...base, mode: 'infrastructure', collapsedGroupIds: new Set(groupIdsAtDepth(grouped, 0)) });
    expect(collapsed.nodes.length).toBeLessThanOrEqual(10);
    expect(collapsed.nodes.reduce((sum, n) => sum + n.memberCount, 0)).toBe(full.nodes.length);
  });
});
