import { describe, expect, it } from 'vitest';
import { mockTopology } from '../../data/mock/topology';
import { buildTopologyIndex } from '../../domain/topologyIndex';
import { createSimulation, injectFailure } from '../../simulation/engine';
import { describeEvent, formatClock } from './describeEvent';

const index = buildTopologyIndex(mockTopology);

describe('describeEvent', () => {
  const sim = injectFailure(createSimulation(mockTopology), 'payment-service.production', 'unavailable');
  const find = (id: string, type: string) => sim.events.find((e) => e.entityId === id && e.type === type)!;

  it('describes the injected failure', () => {
    expect(describeEvent(index, find('payment-service.production', 'failure-injected')).title).toBe(
      'Payment Service: simulated failure, Healthy → Unavailable',
    );
  });

  it('explains propagated changes with cause, protocol, rule, and root', () => {
    expect(describeEvent(index, find('order-service.production', 'health-changed'))).toEqual({
      title: 'Order Service: Healthy → Degraded',
      detail: 'Caused by Payment Service over HTTPS (synchronous). Rule: Synchronous dependency.',
    });
    expect(describeEvent(index, find('api-gateway.production', 'health-changed')).detail).toBe(
      'Caused by Order Service over HTTPS (synchronous). Rule: Synchronous dependency. Root failure: Payment Service.',
    );
  });

  it('describes connection status changes by endpoint names', () => {
    expect(describeEvent(index, find('rel:order-service.production->payment-service.production', 'status-changed')).title).toBe(
      'Connection Order Service → Payment Service: Active → Degraded',
    );
  });

  it('formats the simulated clock', () => {
    expect(formatClock('2026-10-11T08:45:10.000Z')).toBe('08:45:10 UTC');
  });
});
