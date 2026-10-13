import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { indexFlows } from '../../transit/flows/flowIndex';
import { computeSwimlanes } from '../../transit/flows/swimlane';
import { applyView, NO_VIEW, swimlaneElements, type StepNode } from './swimlaneAdapter';

const shared = structuredClone(refundFlow);
shared.id = 'flow-reorder';
shared.name = 'Reorder';
shared.steps[0]!.serviceDefinitionId = 'order-service';
shared.steps[0]!.entryPoint = 'POST /v1/orders'; // Checkout's first step
const fx = indexFlows([checkoutFlow, shared], (id) => id);
const layout = computeSwimlanes(checkoutFlow, (id) => id);
const base = swimlaneElements(layout, checkoutFlow, { fx, color: 'var(--transit-line-1)', serviceName: (id) => id, eventName: (id) => id, shares: new Map([['declined', 0.02]]), storesOf: (id) => (id === 'payment-service' ? [{ id: 'pg-payments-prod', name: 'payments-db', health: 'healthy' }] : []) });
const step = (nodes: typeof base.nodes, id: string) => nodes.find((n): n is StepNode => n.type === 'step' && n.id === id)!;

describe('swimlane view model (ADR-023)', () => {
  it('builds lanes, steps, outcomes, and one routed edge per transition', () => {
    expect(base.nodes.filter((n) => n.type === 'lane')).toHaveLength(layout.lanes.length);
    expect(base.nodes.filter((n) => n.type === 'step')).toHaveLength(checkoutFlow.steps.length);
    expect(base.nodes.filter((n) => n.type === 'outcome')).toHaveLength(checkoutFlow.outcomes.length);
    expect(base.edges).toHaveLength(checkoutFlow.transitions.length);
    expect(base.edges.find((e) => e.id === 'declined')?.data?.label).toBe('if declined · 2%');
    expect(base.edges.find((e) => e.id === 'void')?.data?.undo).toBe(true);
  });

  it('names the other flows that run a step', () => {
    expect(step(base.nodes, 'place-order').data.alsoIn).toEqual([{ id: 'flow-reorder', name: 'Reorder', code: 'RE' }]);
    expect(step(base.nodes, 'reserve-stock').data.alsoIn).toEqual([]);
  });

  it('applies selection, focus, and replay to data only', () => {
    const viewed = applyView(base, {
      selectedStepId: 'capture-payment',
      focus: { steps: new Set(['capture-payment']), transitions: new Set() },
      matches: null,
      replay: { active: [{ stepId: 'reserve-stock', status: 'warn', correlated: true }], traversed: new Set(['placed']), divergence: { stepId: 'reserve-stock', transitionId: 'placed' } },
    });
    expect(viewed.nodes.map((n) => [n.id, n.position, n.width, n.height])).toEqual(base.nodes.map((n) => [n.id, n.position, n.width, n.height]));
    expect(viewed.edges.map((e) => e.data?.route.path)).toEqual(base.edges.map((e) => e.data?.route.path));
    expect(step(viewed.nodes, 'capture-payment').data).toMatchObject({ selected: true, emphasis: 'focus' });
    expect(step(viewed.nodes, 'reserve-stock').data).toMatchObject({ train: { status: 'warn', correlated: true }, divergence: true });
    expect(viewed.edges.find((e) => e.id === 'placed')?.data).toMatchObject({ emphasis: 'traversed', divergence: true });
    expect(applyView(base, NO_VIEW).nodes.every((n) => n.type !== 'step' || n.data.emphasis === 'normal')).toBe(true);
  });
});
