import { describe, expect, it } from 'vitest';
import { businessFlows, checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { mockTopology } from '../../data/mock/topology';
import { flowRanks, indexFlows } from './flowIndex';

const names = new Map(mockTopology.serviceDefinitions.map((d) => [d.id, d.name]));
const fx = indexFlows(businessFlows, (id) => names.get(id) ?? id);

describe('flow index (ADR-022)', () => {
  it('ranks steps by the longest path from the start', () => {
    const ranks = flowRanks(checkoutFlow);
    expect(ranks.get('place-order')).toBe(0);
    expect(ranks.get('reserve-stock')).toBe(1);
    expect(ranks.get('authorize-payment')).toBe(2);
    // Cancel order is reached on decline (rank 3) and after settlement times out (rank 5): the longest wins.
    expect(ranks.get('cancel-order')).toBe(5);
    expect(ranks.get('order-cancelled')).toBeGreaterThan(ranks.get('release-stock')!);
  });

  it('gives flows short codes and orders them by name', () => {
    expect(fx.flows.map((f) => f.name)).toEqual(['Checkout', 'Refund']);
    expect([...fx.codes.values()]).toEqual(['CH', 'RE']);
  });

  it('merges steps with the same service and entry point into interchanges', () => {
    const shared = structuredClone(refundFlow);
    shared.id = 'flow-reorder';
    shared.name = 'Reorder';
    shared.steps[0]!.entryPoint = 'POST /v1/orders'; // the same entry point as Checkout's first step
    const merged = indexFlows([checkoutFlow, shared], (id) => id);
    const key = merged.stationOf('flow-checkout', 'place-order');
    expect(merged.stationOf('flow-reorder', 'request-refund')).toBe(key);
    expect(merged.flowsByStation.get(key)).toEqual(['flow-checkout', 'flow-reorder']);
  });
});
