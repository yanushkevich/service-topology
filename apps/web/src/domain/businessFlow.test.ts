import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../data/mock/businessFlows';
import { mockTopology } from '../data/mock/topology';
import { businessFlowsIn, reachableFrom, resolveBusinessFlow } from './businessFlow';
import { buildTopologyIndex } from './topologyIndex';
import type { BusinessFlow, TopologyData } from './types';
import { validateTopology } from './validation';

const index = buildTopologyIndex(mockTopology);

function withFlow(change: (flow: BusinessFlow) => void, data: TopologyData = mockTopology): TopologyData {
  const copy = structuredClone(data);
  const flow = structuredClone(checkoutFlow);
  change(flow);
  copy.businessFlows = [flow];
  return copy;
}
const codes = (data: TopologyData) => validateTopology(data).map((i) => i.code);

describe('business flow validation (ADR-022)', () => {
  it('accepts the example flows in every environment', () => {
    expect(validateTopology(mockTopology)).toEqual([]);
    expect(mockTopology.businessFlows?.map((f) => f.id)).toEqual(['flow-checkout', 'flow-refund']);
  });

  it('treats a topology without flows as valid', () => {
    const rest = { ...mockTopology };
    delete rest.businessFlows;
    expect(validateTopology(rest)).toEqual([]);
  });

  it('shares the ID space with every other entity', () => {
    expect(codes(withFlow((f) => (f.id = 'order-service')))).toContain('duplicate-id');
  });

  it('reports unknown services and broken step references', () => {
    expect(codes(withFlow((f) => (f.steps[0]!.serviceDefinitionId = 'nope')))).toContain('missing-flow-service');
    expect(codes(withFlow((f) => (f.startStepId = 'nope')))).toContain('invalid-flow-step');
    expect(codes(withFlow((f) => f.steps.push({ ...f.steps[0]! })))).toContain('invalid-flow-step');
    expect(codes(withFlow((f) => (f.steps[1]!.compensatedBy = 'capture-payment')))).toContain('invalid-flow-step');
  });

  it('reports invalid triggers', () => {
    expect(codes(withFlow((f) => (f.trigger = { kind: 'call', ref: 'nope' })))).toContain('invalid-flow-trigger');
    expect(codes(withFlow((f) => (f.trigger = { kind: 'event', ref: 'nope' })))).toContain('invalid-flow-trigger');
    // OrderPlaced is not consumed by Order Service, which runs the start step.
    expect(codes(withFlow((f) => (f.trigger = { kind: 'event', ref: 'event-order-placed' })))).toContain('invalid-flow-trigger');
  });

  it('reports structurally invalid transitions', () => {
    const t = (change: (flow: BusinessFlow) => void) => codes(withFlow(change));
    expect(t((f) => (f.transitions[0]!.to = 'nowhere'))).toContain('invalid-flow-transition');
    expect(t((f) => (f.transitions[0]!.from = 'nowhere'))).toContain('invalid-flow-transition');
    expect(t((f) => f.transitions.push({ ...f.transitions[0]! }))).toContain('invalid-flow-transition');
    // A local hand-off across services, an unknown caller, an event the services do not produce or consume.
    expect(t((f) => (f.transitions.find((x) => x.id === 'placed')!.via = { kind: 'local' }))).toContain('invalid-flow-transition');
    expect(t((f) => (f.transitions.find((x) => x.id === 'authorize')!.via = { kind: 'call', callerServiceId: 'nope' }))).toContain('invalid-flow-transition');
    expect(t((f) => (f.transitions.find((x) => x.id === 'placed')!.via = { kind: 'event', eventTypeId: 'event-payment-captured' }))).toContain('invalid-flow-transition');
    expect(t((f) => (f.transitions.find((x) => x.id === 'placed')!.via = { kind: 'event', eventTypeId: 'event-order-shipped' }))).toContain('invalid-flow-transition');
  });

  it('requires a path to a success outcome', () => {
    expect(codes(withFlow((f) => (f.transitions = f.transitions.filter((x) => x.to !== 'completed'))))).toContain('flow-no-success-path');
  });

  it('never invents communication: removing the backing relationship is an error', () => {
    // Order Service → Payment Service backs the "authorize" call (caller: Order Service).
    const data = structuredClone(mockTopology);
    data.relationships = data.relationships.filter((r) => !(r.sourceEntityId === 'order-service.production' && r.targetEntityId === 'payment-service.production'));
    const issues = validateTopology(data).filter((i) => i.code === 'flow-transition-unbacked');
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^Transition "authorize": No relationship "order-service.production" → "payment-service.production" in production/)]));
    // An event transition needs the producer → channel → consumer relationships.
    const noConsumer = structuredClone(mockTopology);
    noConsumer.relationships = noConsumer.relationships.filter((r) => r.id !== mockTopology.relationships.find((x) => x.sourceEntityId === 'topic-payments-events-prod' && x.targetEntityId === 'ledger-service.production')?.id);
    expect(codes(noConsumer)).toContain('flow-transition-unbacked');
  });

  it('a direct call needs no explicit caller and accepts the reply to a call the target made', () => {
    // capture-payment (Payment) → ship-order (Order) is backed by Order Service → Payment Service.
    const resolved = resolveBusinessFlow(index, checkoutFlow, 'production');
    const captured = resolved.transitions.find((t) => t.transition.id === 'captured')!;
    expect(captured.backing).toMatchObject({ status: 'backed' });
  });
});

describe('business flow resolution', () => {
  it('resolves steps to instances and transitions to their backing per environment', () => {
    const production = resolveBusinessFlow(index, checkoutFlow, 'production');
    expect(production.steps.every((s) => s.instanceId !== null)).toBe(true);
    const settled = production.transitions.find((t) => t.transition.id === 'settled')!.backing;
    expect(settled).toMatchObject({ status: 'backed', channelId: 'topic-payments-events-prod' });
    expect(production.transitions.find((t) => t.transition.id === 'ledger-done')!.backing).toEqual({ status: 'outcome' });

    const staging = resolveBusinessFlow(index, checkoutFlow, 'staging');
    expect(staging.steps.find((s) => s.step.id === 'post-to-ledger')!.instanceId).toBeNull();
    expect(staging.transitions.find((t) => t.transition.id === 'settled')!.backing).toEqual({ status: 'not-deployed', serviceDefinitionIds: ['ledger-service'] });
    expect(staging.transitions.find((t) => t.transition.id === 'placed')!.backing).toMatchObject({ status: 'backed' });
  });

  it('lists flows deployed in an environment and indexes them by service and event type', () => {
    expect(businessFlowsIn(index, 'production').map((r) => r.flow.name)).toEqual(['Checkout', 'Refund']);
    expect(businessFlowsIn(index, 'development').map((r) => r.flow.name)).toEqual(['Checkout', 'Refund']); // Order Service runs there
    expect(index.flowsByService.get('ledger-service')?.map((f) => f.id)).toEqual(['flow-checkout', 'flow-refund']);
    expect(index.flowsByEventType.get('event-refund-issued')?.map((f) => f.id)).toEqual(['flow-refund']);
  });

  it('finds what is reachable from the start', () => {
    const reached = reachableFrom(refundFlow);
    expect([...reached]).toEqual(['request-refund', 'refund-payment', 'post-refund', 'refund-rejected', 'refunded']);
  });
});
