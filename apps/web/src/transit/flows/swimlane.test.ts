import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { mockTopology } from '../../data/mock/topology';
import type { BusinessFlow } from '../../domain/types';
import { generateFlows } from './generateFlows';
import { computeSwimlanes, OUTCOMES_LANE, type SwimlaneLayout, type SwimlaneNode } from './swimlane';

const names = new Map(mockTopology.serviceDefinitions.map((d) => [d.id, d.name]));
const serviceName = (id: string) => names.get(id) ?? id;
const checkout = computeSwimlanes(checkoutFlow, serviceName);

/** Every axis-aligned segment of every edge. */
const segmentsOf = (layout: SwimlaneLayout) =>
  layout.edges.flatMap((e) => e.points.slice(1).map((b, i) => ({ edge: e, a: e.points[i]!, b })));

/** True when the segment passes through the inside of the node (touching its border is fine). */
function crosses(seg: { a: { x: number; y: number }; b: { x: number; y: number } }, n: SwimlaneNode): boolean {
  const [x0, x1] = [Math.min(seg.a.x, seg.b.x), Math.max(seg.a.x, seg.b.x)];
  const [y0, y1] = [Math.min(seg.a.y, seg.b.y), Math.max(seg.a.y, seg.b.y)];
  return x1 > n.x + 1 && x0 < n.x + n.width - 1 && y1 > n.y + 1 && y0 < n.y + n.height - 1;
}

describe('swimlane layout (ADR-023)', () => {
  it('puts services in lanes in the order the flow reaches them, outcomes last', () => {
    // Breadth-first: Capture payment → Ship order → Notify customer is reached before Await settlement → Post to ledger.
    expect(checkout.lanes.map((l) => l.label)).toEqual(['Order Service', 'Inventory Service', 'Payment Service', 'Notification Service', 'Ledger Service', 'Email Dispatcher', 'Outcomes']);
    for (const step of checkoutFlow.steps) expect(checkout.nodes.find((n) => n.id === step.id)?.lane).toBe(step.serviceDefinitionId);
    for (const outcome of checkoutFlow.outcomes) expect(checkout.nodes.find((n) => n.id === outcome.id)?.lane).toBe(OUTCOMES_LANE);
  });

  it('keeps every node inside its lane and nodes apart', () => {
    for (const n of checkout.nodes) {
      const lane = checkout.lanes.find((l) => l.id === n.lane)!;
      expect(n.y).toBeGreaterThanOrEqual(lane.y);
      expect(n.y + n.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
    for (const a of checkout.nodes) for (const b of checkout.nodes) if (a !== b) expect(crosses({ a: { x: a.x, y: a.y }, b: { x: a.x + a.width, y: a.y + a.height } }, b), `${a.id} / ${b.id}`).toBe(false);
  });

  it('orders columns by rank', () => {
    const x = (id: string) => checkout.nodes.find((n) => n.id === id)!.x;
    expect(x('place-order')).toBeLessThan(x('reserve-stock'));
    expect(x('reserve-stock')).toBeLessThan(x('authorize-payment'));
    expect(x('capture-payment')).toBeLessThan(x('cancel-order'));
  });

  it('routes every transition orthogonally from the source’s right side to the target’s left side', () => {
    expect(checkout.edges).toHaveLength(checkoutFlow.transitions.length);
    for (const e of checkout.edges) {
      const from = checkout.nodes.find((n) => n.id === e.from)!;
      const to = checkout.nodes.find((n) => n.id === e.to)!;
      expect(e.points[0]).toEqual({ x: from.x + from.width, y: from.y + from.height / 2 });
      expect(e.points.at(-1)).toEqual({ x: to.x, y: to.y + to.height / 2 });
      for (const s of segmentsOf({ ...checkout, edges: [e] })) expect(s.a.x === s.b.x || s.a.y === s.b.y, e.id).toBe(true);
    }
  });

  it('never runs an edge through a node', () => {
    for (const layout of [checkout, computeSwimlanes(refundFlow, serviceName), computeSwimlanes(generateFlows({ flows: 1 })[0]!, (id) => id)]) {
      for (const s of segmentsOf(layout)) {
        for (const n of layout.nodes) if (n.id !== s.edge.from && n.id !== s.edge.to) expect(crosses(s, n), `${s.edge.id} through ${n.id}`).toBe(false);
      }
    }
  });

  it('gives every vertical run in a channel its own track', () => {
    for (const layout of [checkout, computeSwimlanes(generateFlows({ flows: 1 })[0]!, (id) => id)]) {
      const verticals = segmentsOf(layout).filter((s) => s.a.x === s.b.x && s.a.y !== s.b.y);
      for (const a of verticals) {
        for (const b of verticals) {
          if (a.edge === b.edge || a.a.x !== b.a.x) continue;
          // Same x: the two runs must not share any stretch.
          const overlap = Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) - Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y));
          expect(overlap, `${a.edge.id} / ${b.edge.id}`).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('routes back edges and long jumps through the source lane’s gutter', () => {
    const looped: BusinessFlow = structuredClone(checkoutFlow);
    looped.transitions.push({ id: 'retry-reserve', from: 'authorize-payment', to: 'reserve-stock', via: { kind: 'call' }, condition: 'retry', policies: [] });
    const layout = computeSwimlanes(looped, serviceName);
    const back = layout.edges.find((e) => e.id === 'retry-reserve')!;
    expect(back.back).toBe(true);
    const lane = layout.lanes.find((l) => l.id === 'payment-service')!;
    expect(back.points.some((p) => p.y > lane.y + lane.height - 30 && p.y <= lane.y + lane.height)).toBe(true);
  });

  it('places policy diamonds on the edge, one per policy', () => {
    const settled = checkout.edges.find((e) => e.id === 'settled')!;
    expect(settled.policies).toHaveLength(checkoutFlow.transitions.find((t) => t.id === 'settled')!.policies.length);
    const xs = new Set(settled.policies.map((p) => p.x));
    const ys = new Set(settled.policies.map((p) => p.y));
    expect(xs.size === 1 || ys.size === 1).toBe(true); // along one segment
  });

  it('is deterministic and lays out 40 steps quickly', () => {
    expect(computeSwimlanes(checkoutFlow, serviceName)).toEqual(checkout);
    const big = generateFlows({ flows: 1, steps: 40 })[0]!;
    const started = performance.now();
    const layout = computeSwimlanes(big, (id) => id);
    expect(performance.now() - started).toBeLessThan(200);
    expect(layout.nodes).toHaveLength(big.steps.length + big.outcomes.length);
  });
});
