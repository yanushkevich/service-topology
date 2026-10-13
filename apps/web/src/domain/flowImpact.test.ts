import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { flowImpacts } from './flowImpact';
import { analyzeImpact, type FailureRoot } from './propagation';
import { buildTopologyIndex } from './topologyIndex';

const index = buildTopologyIndex(mockTopology);
const run = (...roots: FailureRoot[]) => flowImpacts(index, roots, analyzeImpact(index, roots));
const inProduction = (...roots: FailureRoot[]) => run(...roots).filter((f) => f.environmentId === 'production');

describe('flowImpacts (ADR-025)', () => {
  it('the card processor unavailable: Checkout stops at Authorize payment (likely Cancelled), Refund at Refund payment (likely Rejected)', () => {
    const flows = inProduction({ entityId: 'ext-card-processor', mode: 'unavailable' });
    const checkout = flows.find((f) => f.flowId === 'flow-checkout');
    const refund = flows.find((f) => f.flowId === 'flow-refund');
    expect(checkout?.firstAffectedStepId).toBe('authorize-payment');
    expect(checkout?.likelyOutcome).toEqual({ kind: 'outcome', outcomeId: 'order-cancelled', compensated: true });
    expect(refund?.firstAffectedStepId).toBe('refund-payment');
    expect(refund?.likelyOutcome).toEqual({ kind: 'outcome', outcomeId: 'refund-rejected', compensated: false });
    // The cause chain runs from the root to the step's service.
    expect(checkout?.steps.find((s) => s.stepId === 'authorize-payment')).toEqual({
      stepId: 'authorize-payment',
      effect: 'degraded',
      entityId: 'payment-service.production',
      path: ['ext-card-processor', 'payment-service.production'],
      reason: 'service',
    });
  });

  it('attributes a failure carried by the flow’s own hand-off to the step it enters, not to the caller', () => {
    // Order Service is degraded only because it calls Payment Service: the "authorize" transition.
    const checkout = inProduction({ entityId: 'ext-card-processor', mode: 'unavailable' }).find((f) => f.flowId === 'flow-checkout');
    expect(checkout?.steps.map((s) => s.stepId)).not.toContain('place-order');
    // Order Service failing itself is a different story.
    const own = inProduction({ entityId: 'order-service.production', mode: 'unavailable' }).find((f) => f.flowId === 'flow-checkout');
    expect(own?.firstAffectedStepId).toBe('place-order');
    expect(own?.steps.find((s) => s.stepId === 'place-order')).toMatchObject({ effect: 'unavailable', path: ['order-service.production'] });
  });

  it('a failing channel affects the step its event enters', () => {
    const checkout = inProduction({ entityId: 'topic-orders-events-prod', mode: 'unavailable' }).find((f) => f.flowId === 'flow-checkout');
    expect(checkout?.firstAffectedStepId).toBe('reserve-stock');
    expect(checkout?.steps.find((s) => s.stepId === 'reserve-stock')).toMatchObject({ reason: 'input-channel', entityId: 'topic-orders-events-prod', effect: 'unavailable' });
    expect(checkout?.likelyOutcome).toEqual({ kind: 'unknown' });
  });

  it('a consumer behind redelivery on a healthy channel is delayed, not failed', () => {
    const checkout = inProduction({ entityId: 'notification-service.production', mode: 'unavailable' }).find((f) => f.flowId === 'flow-checkout');
    expect(checkout?.firstAffectedStepId).toBe('notify-customer');
    expect(checkout?.likelyOutcome).toEqual({ kind: 'delayed', transitionId: 'shipped' });
    // Its backlog on orders.events does not reach the other consumer's step (propagation: backlog is terminal).
    expect(checkout?.steps.map((s) => s.stepId)).not.toContain('reserve-stock');
  });

  it('lists nothing without failures, and only flows with an affected step', () => {
    expect(run()).toEqual([]);
    expect(run({ entityId: 'catalog-service.production', mode: 'unavailable' })).toEqual([]);
  });

  it('covers every environment that runs the flow, environments and flows in ID order', () => {
    const flows = run({ entityId: 'ext-card-processor', mode: 'unavailable' });
    expect(flows.map((f) => `${f.environmentId}/${f.flowId}`)).toEqual([...flows.map((f) => `${f.environmentId}/${f.flowId}`)].sort());
    expect(new Set(flows.map((f) => f.environmentId)).size).toBeGreaterThan(1);
  });
});
