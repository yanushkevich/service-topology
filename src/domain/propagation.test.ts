import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { analyzeImpact, PROPAGATION_RULE_IDS, PROPAGATION_RULES, type Impact } from './propagation';
import { buildTopologyIndex } from './topologyIndex';

const index = buildTopologyIndex(mockTopology);
const byId = (impacts: Impact[]) => Object.fromEntries(impacts.map((i) => [i.entityId, i]));

describe('propagation rules', () => {
  it('documents every rule id exactly once', () => {
    expect(PROPAGATION_RULES.map((r) => r.id)).toEqual([...PROPAGATION_RULE_IDS]);
  });

  it('synchronous-call: callers degrade, transitively up the call chain', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'payment-service.production', mode: 'unavailable' }]));
    expect(impacts['order-service.production']).toMatchObject({
      effect: 'degraded',
      ruleId: 'synchronous-call',
      causeId: 'payment-service.production',
      viaRelationshipId: 'rel:order-service.production->payment-service.production',
    });
    // order ← api-gateway (transitive)
    expect(impacts['api-gateway.production']).toMatchObject({
      ruleId: 'synchronous-call',
      path: ['payment-service.production', 'order-service.production', 'api-gateway.production'],
    });
  });

  it('data-access: services using a failed database degrade', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'pg-payments-prod', mode: 'unavailable' }]));
    expect(impacts['payment-service.production']).toMatchObject({ effect: 'degraded', ruleId: 'data-access' });
  });

  it('scheduled-job: jobs targeting a failed entity degrade', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'ledger-service.production', mode: 'unavailable' }]));
    expect(impacts['payout-worker.production']).toMatchObject({ ruleId: 'scheduled-job' });
  });

  it('async decoupling: a failed consumer backs up its topic but does not reach producers', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'ledger-service.production', mode: 'unavailable' }]));
    expect(impacts['topic-payments-events-prod']).toMatchObject({ effect: 'degraded', ruleId: 'consumer-backlog' });
    expect(impacts['payment-service.production']).toBeUndefined();
  });

  it('a failed producer does not affect the topic or its consumers', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'payment-service.production', mode: 'unavailable' }]));
    expect(impacts['topic-payments-events-prod']).toBeUndefined();
    expect(impacts['ledger-service.production']).toBeUndefined();
  });

  it('a failed topic degrades producers and consumers', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'topic-orders-events-prod', mode: 'unavailable' }]));
    expect(impacts['order-service.production']).toMatchObject({ ruleId: 'publish-to-failed-channel' });
    expect(impacts['inventory-service.production']).toMatchObject({ ruleId: 'consume-from-failed-channel' });
    expect(impacts['notification-service.production']).toMatchObject({ ruleId: 'consume-from-failed-channel' });
  });

  it('a merely degraded topic does not propagate to producers', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'topic-orders-events-prod', mode: 'degraded' }]));
    expect(impacts['order-service.production']).toBeUndefined();
  });

  it('containment: a failed cluster makes hosted instances unavailable, then they propagate', () => {
    const impacts = byId(analyzeImpact(index, [{ entityId: 'aks-payments-prod', mode: 'unavailable' }]));
    expect(impacts['ns-payments-prod']).toMatchObject({ effect: 'unavailable', ruleId: 'containment' });
    expect(impacts['payment-service.production']).toMatchObject({ effect: 'unavailable', ruleId: 'containment' });
    expect(impacts['fraud-scoring.production']).toMatchObject({ effect: 'unavailable', ruleId: 'containment' });
    // …and their callers degrade through communication rules.
    expect(impacts['order-service.production']).toMatchObject({ effect: 'degraded', ruleId: 'synchronous-call' });
  });

  it('never escalates communication impacts beyond degraded', () => {
    const impacts = analyzeImpact(index, [{ entityId: 'ext-card-processor', mode: 'unavailable' }]);
    expect(impacts.every((i) => i.effect === 'degraded')).toBe(true);
    // An environment-independent SaaS reaches callers in every environment.
    expect(impacts.map((i) => i.entityId)).toContain('payment-service.staging');
  });

  it('keeps the most severe effect when several roots reach an entity', () => {
    const impacts = byId(
      analyzeImpact(index, [
        { entityId: 'payment-service.production', mode: 'unavailable' },
        { entityId: 'aks-payments-prod', mode: 'unavailable' },
      ]),
    );
    expect(impacts['fraud-scoring.production']).toMatchObject({ effect: 'unavailable', ruleId: 'containment' });
  });

  it('does not list roots and is deterministic', () => {
    const roots = [{ entityId: 'rds-orders-prod', mode: 'unavailable' as const }];
    const a = analyzeImpact(index, roots);
    expect(a.some((i) => i.entityId === 'rds-orders-prod')).toBe(false);
    expect(analyzeImpact(index, roots)).toEqual(a);
  });
});
