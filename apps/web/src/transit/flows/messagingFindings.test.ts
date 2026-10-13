import { describe, expect, it } from 'vitest';
import { checkoutFlow, refundFlow } from '../../data/mock/businessFlows';
import type { BusinessFlow, FlowPolicy, FlowTransition } from '../../domain/types';
import { flowFindings } from './flowModel';

/** Checkout with one transition's policies (and optionally its target step) replaced. */
function withPolicies(transitionId: string, policies: FlowPolicy[], change: (flow: BusinessFlow) => void = () => {}): BusinessFlow {
  const flow: BusinessFlow = structuredClone(checkoutFlow);
  const t = flow.transitions.find((x) => x.id === transitionId) as FlowTransition;
  t.policies = policies;
  change(flow);
  return flow;
}
const rules = (flow: BusinessFlow, transitionId: string) =>
  flowFindings(flow)
    .filter((f) => f.transitionIds.includes(transitionId))
    .map((f) => f.ruleId);
const p = (type: FlowPolicy['type'], state: FlowPolicy['state'] = 'exercised', config?: Record<string, string>): FlowPolicy => ({ type, label: type, state, ...(config ? { config } : {}) });

describe('messaging reliability and polling findings (ADR-024)', () => {
  it('flags an outbox without a relay, and clears it when a polling publisher is declared', () => {
    expect(rules(withPolicies('settled', [p('outbox'), p('inbox')]), 'settled')).toContain('outbox-without-relay');
    expect(rules(withPolicies('settled', [p('outbox'), p('polling-publisher'), p('inbox')]), 'settled')).not.toContain('outbox-without-relay');
    // A missing outbox is not an outbox.
    expect(rules(withPolicies('settled', [p('outbox', 'missing'), p('inbox')]), 'settled')).not.toContain('outbox-without-relay');
  });

  it('flags at-least-once delivery without deduplication; an inbox or an idempotent consumer clears it', () => {
    expect(rules(withPolicies('settled', [p('redelivery')]), 'settled')).toContain('at-least-once-without-dedup');
    expect(rules(withPolicies('settled', [p('redelivery'), p('idempotent-consumer', 'missing')]), 'settled')).toContain('at-least-once-without-dedup');
    expect(rules(withPolicies('settled', [p('redelivery'), p('inbox')]), 'settled')).not.toContain('at-least-once-without-dedup');
    expect(rules(withPolicies('settled', [p('outbox'), p('polling-publisher'), p('idempotent-consumer')]), 'settled')).not.toContain('at-least-once-without-dedup');
    // Neither outbox nor redelivery: at-most-once, nothing to deduplicate.
    expect(rules(withPolicies('settled', []), 'settled')).not.toContain('at-least-once-without-dedup');
  });

  it('reports a missing deduplication once, as the at-least-once finding, not also as a missing policy', () => {
    const found = rules(withPolicies('settled', [p('redelivery'), p('idempotent-consumer', 'missing')]), 'settled');
    expect(found.filter((r) => r === 'at-least-once-without-dedup')).toHaveLength(1);
    expect(found).not.toContain('missing-policy');
  });

  it('flags polling without a deadline; a timeout or a step deadline clears it', () => {
    expect(rules(withPolicies('captured', [p('async-request-reply')]), 'captured')).toContain('polling-without-deadline');
    expect(rules(withPolicies('captured', [p('async-request-reply', 'exercised', { pollIntervalMs: '500', timeoutMs: '30000' })]), 'captured')).not.toContain('polling-without-deadline');
    const withDeadline = withPolicies('captured', [p('async-request-reply')], (flow) => {
      const ship = flow.steps.find((s) => s.id === 'ship-order');
      if (ship) ship.deadlineMs = 60_000;
    });
    expect(rules(withDeadline, 'captured')).not.toContain('polling-without-deadline');
  });

  it('finds the example gaps: Checkout’s settlement hand-off is clean; Refund’s has no relay and no deduplication', () => {
    expect(rules(checkoutFlow, 'settled')).not.toContain('outbox-without-relay');
    expect(rules(checkoutFlow, 'settled')).not.toContain('at-least-once-without-dedup');
    expect(rules(refundFlow, 'issued')).toEqual(expect.arrayContaining(['outbox-without-relay', 'at-least-once-without-dedup']));
  });
});
