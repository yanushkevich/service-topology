import { describe, expect, it } from 'vitest';
import { checkoutFlow } from '../data/mock/businessFlows';
import { mockTopology } from '../data/mock/topology';
import { dataStoresOf, flowDataStores } from './dataStores';
import { buildTopologyIndex } from './topologyIndex';

const index = buildTopologyIndex(mockTopology);

describe('data stores of services and flows (ADR-027)', () => {
  it('finds the databases, caches, and search indexes a service uses in an environment', () => {
    expect(dataStoresOf(index, 'payment-service', 'production').map((s) => s.name)).toEqual(['payments-db']);
    expect(dataStoresOf(index, 'cart-service', 'production').map((s) => s.type)).toEqual(['cache']);
    expect(dataStoresOf(index, 'notification-service', 'production')).toEqual([]);
    expect(dataStoresOf(index, 'payment-service', 'no-such-environment')).toEqual([]);
  });

  it('lists every store Checkout touches with the steps whose service uses it', () => {
    const stores = new Map(flowDataStores(index, checkoutFlow, 'production').map((e) => [e.store.name, e.stepIds]));
    expect([...stores.keys()].sort()).toEqual(['inventory-db', 'ledger-db', 'orders-db', 'payments-db']);
    expect(stores.get('orders-db')).toEqual(['place-order', 'ship-order', 'cancel-order']);
    expect(stores.get('ledger-db')).toEqual(['post-to-ledger']);
  });
});
