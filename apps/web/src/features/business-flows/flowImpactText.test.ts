import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import { mockTopology } from '../../data/mock/topology';
import { flowImpacts } from '../../domain/flowImpact';
import { analyzeImpact, type FailureRoot } from '../../domain/propagation';
import { buildTopologyIndex, endpointName } from '../../domain/topologyIndex';
import { describeAffectedStep, describeFlowImpact } from './flowImpactText';

const index = buildTopologyIndex(mockTopology);
const names = { entity: (id: string) => endpointName(index, id), event: (id: string) => index.eventTypes.get(id)?.name ?? id };
const impactsOf = (...roots: FailureRoot[]) => flowImpacts(index, roots, analyzeImpact(index, roots)).filter((f) => f.environmentId === 'production');

describe('flow impact text', () => {
  it('says where a flow stops and how it likely ends', () => {
    const roots: FailureRoot[] = [{ entityId: 'ext-card-processor', mode: 'unavailable' }];
    const [checkout, refund] = ['flow-checkout', 'flow-refund'].map((id) => impactsOf(...roots).find((f) => f.flowId === id));
    if (!checkout || !refund) throw new Error('expected both flows');
    expect(describeFlowImpact(checkout, checkoutFlow, roots, names).sentence).toBe('Card Processor API unavailable → Checkout stops at Authorize payment, likely Cancelled, with compensation.');
    expect(describeFlowImpact(refund, refundFlow, roots, names).sentence).toBe('Card Processor API unavailable → Refund stops at Refund payment, likely Rejected.');
    const authorize = checkout.steps.find((s) => s.stepId === 'authorize-payment');
    if (!authorize) throw new Error('expected the step');
    expect(describeAffectedStep(authorize, checkoutFlow, names.entity)).toBe('Authorize payment: degraded (Card Processor API → Payment Service)');
  });

  it('names the event that waits when the step is delayed', () => {
    const roots: FailureRoot[] = [{ entityId: 'notification-service.production', mode: 'unavailable' }];
    const checkout = impactsOf(...roots).find((f) => f.flowId === 'flow-checkout');
    if (!checkout) throw new Error('expected Checkout');
    expect(describeFlowImpact(checkout, checkoutFlow, roots, names).likely).toBe('likely delayed: OrderShipped waits for redelivery');
  });
});
