import { describe, expect, it } from 'vitest';
import { mockTopology } from '../../data/mock/topology';
import { buildTopologyIndex } from '../../domain/topologyIndex';
import { definitionOf } from '../../transit/definition';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';
import { locationOf, quickSearch, searchItems } from './quickSearch';

const items = searchItems({
  index: buildTopologyIndex(mockTopology),
  environmentId: 'production',
  boards: [definitionOf(paymentServiceBoard('production'))],
  pages: [
    { path: '/overview', label: 'Overview' },
    { path: '/settings', label: 'Settings' },
  ],
});
const labels = (query: string, group: string) => quickSearch(items, query).groups.find((g) => g.group === group)?.items.map((i) => i.label) ?? [];

describe('quick search', () => {
  it('finds an entity, a flow, an event type, an endpoint, and a page by name', () => {
    expect(labels('ledger', 'entity')).toContain('Ledger Service');
    expect(labels('checkout', 'flow')).toEqual(['Checkout']);
    expect(labels('orderplaced', 'event')).toEqual(['OrderPlaced']);
    expect(labels('capture', 'endpoint')).toContain('A2 Capture');
    expect(labels('sett', 'page')).toEqual(['Settings']);
  });

  it('keeps to the environment', () => {
    expect(items.filter((i) => i.target.kind === 'entity').every((i) => !i.key.endsWith('.staging'))).toBe(true);
  });

  it('matches every word, in any field, and ranks label matches first', () => {
    // "capture" is a step of Checkout (a term) and the name of endpoint A2 (a label).
    expect(labels('capture', 'flow')).toContain('Checkout');
    expect(labels('payment capture', 'endpoint')).toEqual(['A2 Capture']);
    const entities = labels('payment', 'entity');
    expect(entities[0]).toBe('Payment Service');
  });

  it('groups in a fixed order, caps each group, and counts the rest', () => {
    const results = quickSearch(items, 'service', 3);
    expect(results.groups.map((g) => g.group)).toEqual(['entity', 'flow', 'endpoint']);
    expect(results.groups[0]?.items).toHaveLength(3);
    expect(results.more.entity).toBeGreaterThan(0);
  });

  it('lists the pages for an empty query', () => {
    expect(quickSearch(items, '  ').groups.map((g) => g.group)).toEqual(['page']);
  });

  it('opens each kind of result where it can be seen, keeping shared state and dropping page parameters', () => {
    const search = '?v=1&env=production&step=place-order&line=A1';
    expect(locationOf({ kind: 'entity', ref: { kind: 'resource', id: 'x' } }, search, '/overview')).toEqual({ pathname: '/registry', search: '?v=1&env=production' });
    expect(locationOf({ kind: 'entity', ref: { kind: 'resource', id: 'x' } }, search, '/map').pathname).toBe('/map');
    expect(locationOf({ kind: 'flow', flowId: 'flow-checkout' }, search, '/flows/flow-refund')).toEqual({ pathname: '/flows/flow-checkout', search: '?v=1&env=production' });
    expect(locationOf({ kind: 'event', eventTypeId: 'event-order-placed' }, search, '/map').pathname).toBe('/events/event-order-placed');
    expect(locationOf({ kind: 'endpoint', serviceDefinitionId: 'payment-service', lineId: 'A2' }, search, '/map')).toEqual({ pathname: '/services/payment-service/transit', search: '?v=1&env=production&line=A2' });
    expect(locationOf({ kind: 'page', path: '/settings' }, '', '/map')).toEqual({ pathname: '/settings', search: '' });
  });
});
