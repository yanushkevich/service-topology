import { describe, expect, it } from 'vitest';
import { businessFlows, checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { mockTopology } from '../../data/mock/topology';
import { overlaps } from '../layout';
import { buildFlowGraph, computeFlowGeometry, FLOW_COLUMN, flowRanks, indexFlows, placeFlowStations } from './flowLayout';

const names = new Map(mockTopology.serviceDefinitions.map((d) => [d.id, d.name]));
const fx = indexFlows(businessFlows, (id) => names.get(id) ?? id);

describe('flow board layout (ADR-022)', () => {
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

  it('places columns by rank and rows by service band, outcomes last', () => {
    const { positions, bandRanges } = placeFlowStations(fx);
    const place = positions.get(fx.stationOf('flow-checkout', 'place-order'))!;
    const authorize = positions.get(fx.stationOf('flow-checkout', 'authorize-payment'))!;
    expect(place.u).toBe(0);
    expect(authorize.u).toBe(2 * FLOW_COLUMN);
    expect(bandRanges.at(-1)?.id).toBe('outcomes');
    expect(bandRanges[0]?.label).toBe('Order Service');
    // Steps of one service share a band.
    const ship = positions.get(fx.stationOf('flow-checkout', 'ship-order'))!;
    const orderBand = bandRanges[0]!;
    expect(ship.v).toBeGreaterThanOrEqual(orderBand.v0);
    expect(ship.v).toBeLessThanOrEqual(orderBand.v1);
  });

  it('routes every transition and bundles flows that share an edge', () => {
    const { positions } = placeFlowStations(fx);
    const graph = buildFlowGraph(fx, positions);
    const routed = [...graph.transitionPaths.keys()].length;
    const toStations = businessFlows.flatMap((f) => f.transitions).length;
    expect(routed).toBe(toStations);
    for (const path of graph.transitionPaths.values()) {
      for (const id of path) expect(graph.nodes.has(id)).toBe(true);
    }
  });

  it.each([false, true])('fits the board, with policy diamonds and no overlapping labels (flat: %s)', (flat) => {
    const g = computeFlowGeometry(fx, { flat });
    expect(g.lines.map((l) => l.transitions.length)).toEqual([checkoutFlow.transitions.length, refundFlow.transitions.length]);
    expect(g.stops.length).toBe(businessFlows.flatMap((f) => f.transitions).reduce((n, t) => n + t.policies.length, 0));
    for (const s of g.stations) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(g.width);
    }
    const visible = g.stations.filter((s) => !s.label.hidden);
    for (const a of visible) for (const b of visible) if (a !== b) expect(overlaps(a.label.box, b.label.box)).toBe(false);
    expect(g.lines.every((l) => l.transitions.every((t) => !t.top.includes('NaN')))).toBe(true);
  });
});
