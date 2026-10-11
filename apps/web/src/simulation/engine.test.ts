import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { diffTopology } from '../domain/snapshot';
import type { TopologyData } from '../domain/types';
import { validateTopology } from '../domain/validation';
import { createSimulation, injectFailure, MAX_EVENTS, recover, recoverAll, reset, step, TICK_SECONDS } from './engine';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const baseline = (): TopologyData => deepFreeze(structuredClone(mockTopology));
const health = (data: TopologyData, id: string) =>
  data.serviceInstances.find((i) => i.id === id)?.health ?? data.resources.find((r) => r.id === id)?.health;
const status = (data: TopologyData, id: string) => data.relationships.find((r) => r.id === id)?.status;

describe('simulation engine', () => {
  it('starts from the baseline unchanged, at the latest recorded time', () => {
    const sim = createSimulation(baseline());
    expect(diffTopology(sim.baseline, sim.data)).toEqual([]);
    expect(sim.clock).toBe('2026-10-11T08:45:00Z');
    expect(sim.events).toEqual([]);
  });

  it('is deterministic for the same baseline, seed, and actions', () => {
    const run = () => step(injectFailure(step(createSimulation(baseline(), { seed: 7 }), 3), 'payment-service.production', 'unavailable'), 5);
    expect(run()).toEqual(run());
    const otherSeed = step(createSimulation(baseline(), { seed: 8 }), 3);
    expect(otherSeed.drift).not.toEqual(step(createSimulation(baseline(), { seed: 7 }), 3).drift);
  });

  it('injects a failure, propagates it, and explains every change', () => {
    const sim = injectFailure(createSimulation(baseline()), 'payment-service.production', 'unavailable');
    expect(health(sim.data, 'payment-service.production')).toBe('unavailable');
    expect(health(sim.data, 'order-service.production')).toBe('degraded');
    expect(status(sim.data, 'rel:order-service.production->payment-service.production')).toBe('degraded');
    expect(status(sim.data, 'rel:payment-service.production->pg-payments-prod')).toBe('inactive');

    const [root, ...rest] = sim.events;
    expect(root).toMatchObject({ type: 'failure-injected', entityId: 'payment-service.production', from: 'healthy', to: 'unavailable', isSimulated: true });
    const order = rest.find((e) => e.entityId === 'order-service.production');
    expect(order).toMatchObject({
      type: 'health-changed',
      from: 'healthy',
      to: 'degraded',
      cause: { ruleId: 'synchronous-call', rootId: 'payment-service.production', causeId: 'payment-service.production' },
    });
    expect(sim.events.every((e) => e.isSimulated)).toBe(true);
    expect(validateTopology(sim.data)).toEqual([]);
  });

  it('marks failed entities and their metrics, keeping metrics labeled simulated', () => {
    const sim = injectFailure(createSimulation(baseline()), 'payment-service.production', 'unavailable');
    const payment = sim.data.serviceInstances.find((i) => i.id === 'payment-service.production')!;
    expect(payment.metrics).toMatchObject({ throughputPerSecond: 0, errorRatePercent: 100, isSimulated: true });
    expect(payment.updatedAt).toBe(sim.clock);
  });

  it('recovers exactly to the baseline state', () => {
    let sim = createSimulation(baseline());
    sim = injectFailure(sim, 'aks-payments-prod', 'unavailable');
    expect(health(sim.data, 'fraud-scoring.production')).toBe('unavailable');
    sim = recover(sim, 'aks-payments-prod');
    expect(diffTopology(sim.baseline, sim.data)).toEqual([]);
    expect(sim.events.at(-1)).toBeDefined();
    expect(sim.events.find((e) => e.type === 'recovered')).toMatchObject({ entityId: 'aks-payments-prod' });
    // Baseline-unhealthy entities keep their recorded health after recovery.
    expect(health(sim.data, 'notification-service.production')).toBe('unavailable');
  });

  it('recovers on schedule while stepping', () => {
    let sim = injectFailure(createSimulation(baseline()), 'rds-orders-prod', 'unavailable', { durationTicks: 2 });
    sim = step(sim);
    expect(health(sim.data, 'rds-orders-prod')).toBe('unavailable');
    sim = step(sim);
    expect(health(sim.data, 'rds-orders-prod')).toBe('healthy');
    expect(sim.failures).toEqual([]);
    expect(sim.events.find((e) => e.type === 'recovered')?.note).toMatch(/scheduled/);
  });

  it('advances a simulated clock and drifts metrics without changing health', () => {
    const start = createSimulation(baseline());
    const later = step(start, 6);
    expect(Date.parse(later.clock) - Date.parse(start.clock)).toBe(6 * TICK_SECONDS * 1000);
    expect(diffTopology(start.data, later.data)).toEqual([]);
    const before = start.data.serviceInstances.find((i) => i.id === 'order-service.production')!.metrics!;
    const after = later.data.serviceInstances.find((i) => i.id === 'order-service.production')!.metrics!;
    expect(after.latencyMs).not.toBe(before.latencyMs);
    expect(after).toMatchObject({ isSimulated: true, observedAt: later.clock });
  });

  it('emits latency anomaly events from drift, deterministically', () => {
    const sim = step(createSimulation(baseline(), { seed: 3 }), 200);
    const anomalies = sim.events.filter((e) => e.type === 'latency-anomaly');
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0]).toMatchObject({ entityKind: 'service-instance', isSimulated: true });
    expect(step(createSimulation(baseline(), { seed: 3 }), 200).events).toEqual(sim.events);
  });

  it('never mutates the baseline (it is deep-frozen here)', () => {
    const b = baseline();
    expect(() => recoverAll(step(injectFailure(createSimulation(b), 'payment-service.production', 'degraded'), 3))).not.toThrow();
  });

  it('caps the event log', () => {
    let sim = createSimulation(baseline());
    for (let i = 0; i < 120; i++) sim = recover(injectFailure(sim, 'payment-service.production', 'unavailable'), 'payment-service.production');
    expect(sim.events).toHaveLength(MAX_EVENTS);
    expect(sim.events.at(-1)?.id).toBe(`sim-${sim.eventSeq - 1}`);
  });

  it('rejects unknown entities and resets to baseline', () => {
    const sim = injectFailure(createSimulation(baseline()), 'payment-service.production', 'unavailable');
    expect(() => injectFailure(sim, 'ghost', 'unavailable')).toThrow();
    expect(reset(sim)).toEqual(createSimulation(sim.baseline, { seed: sim.seed }));
  });
});
