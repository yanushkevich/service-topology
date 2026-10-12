import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { eventFlowReach, eventFlowsIn, resolveEventFlow } from './eventFlow';
import { buildTopologyIndex } from './topologyIndex';
import type { EventType, TopologyData } from './types';
import { validateTopology } from './validation';

const index = buildTopologyIndex(mockTopology);
const event = (id: string) => index.eventTypes.get(id)!;

function withEvent(patch: Partial<EventType>): TopologyData {
  const data = structuredClone(mockTopology);
  delete data.businessFlows; // the example flows use the mock's event types
  data.eventTypes = [
    { id: 'event-test', name: 'Test', channelResourceIds: ['topic-orders-events-prod'], producerServiceIds: ['order-service'], consumerServiceIds: [], ...patch },
  ];
  return data;
}

const codes = (data: TopologyData) => validateTopology(data).map((i) => `${i.code}:${i.entityId}`);

describe('event flows (ADR-014)', () => {
  it('resolves producers, channel, and consumers from existing relationships', () => {
    const flow = resolveEventFlow(index, event('event-order-placed'), 'production')!;
    expect(flow.channelId).toBe('topic-orders-events-prod');
    expect(flow.producers).toEqual([
      { serviceDefinitionId: 'order-service', instanceId: 'order-service.production', relationshipIds: [expect.any(String)] },
    ]);
    expect(flow.consumers.map((c) => c.instanceId)).toEqual(['inventory-service.production', 'notification-service.production']);
  });

  it('uses the channel of the selected environment and marks definitions not deployed there', () => {
    const flow = resolveEventFlow(index, event('event-order-placed'), 'staging')!;
    expect(flow.channelId).toBe('topic-orders-events-staging');
    expect(flow.consumers).toEqual([
      expect.objectContaining({ serviceDefinitionId: 'inventory-service', instanceId: 'inventory-service.staging' }),
      { serviceDefinitionId: 'notification-service', instanceId: null, relationshipIds: [] },
    ]);
    expect(resolveEventFlow(index, event('event-payment-captured'), 'staging')).toBeNull();
  });

  it('follows an exchange binding to the queue a consumer reads from', () => {
    const flow = resolveEventFlow(index, event('event-notification-requested'), 'production')!;
    const [consumer] = flow.consumers;
    expect(consumer).toMatchObject({ instanceId: 'email-dispatcher.production', viaQueueId: 'queue-notifications-email-prod' });
    expect(consumer!.relationshipIds).toHaveLength(2);
    const reach = eventFlowReach(flow);
    expect([...reach.entityIds].sort()).toEqual(
      ['email-dispatcher.production', 'exchange-notifications-prod', 'notification-service.production', 'queue-notifications-email-prod'].sort(),
    );
    expect(reach.relationshipIds.size).toBe(3);
  });

  it('lists the events of an environment by name', () => {
    expect(eventFlowsIn(index, 'production').map((f) => f.eventType.name)).toEqual([
      'NotificationRequested',
      'OrderCancelled',
      'OrderPlaced',
      'OrderShipped',
      'PaymentCaptured',
      'PaymentFailed',
      'RefundIssued',
      'StockLevelChanged',
      'StockReserved',
    ]);
    expect(eventFlowsIn(index, 'staging')).toHaveLength(3);
    expect(eventFlowsIn(index, 'development')).toEqual([]);
  });

  it('indexes event types by channel', () => {
    expect(index.eventTypesByChannel.get('topic-orders-events-staging')?.map((e) => e.name)).toEqual(['OrderPlaced', 'OrderCancelled', 'OrderShipped']);
  });

  it('treats a topology without event types as an empty catalog', () => {
    const rest = { ...mockTopology };
    delete rest.eventTypes;
    delete rest.businessFlows;
    expect(eventFlowsIn(buildTopologyIndex(rest), 'production')).toEqual([]);
    expect(validateTopology(rest)).toEqual([]);
  });
});

describe('event type validation (ADR-014)', () => {
  it('accepts a consistent event type', () => {
    expect(codes(withEvent({}))).toEqual([]);
  });

  it('reports unknown and non-messaging channels', () => {
    expect(codes(withEvent({ channelResourceIds: ['ghost'] }))).toEqual(['missing-event-channel:event-test']);
    expect(codes(withEvent({ channelResourceIds: ['rds-orders-prod'] }))).toEqual(['invalid-event-channel:event-test']);
  });

  it('reports two channels in one environment', () => {
    expect(codes(withEvent({ channelResourceIds: ['topic-orders-events-prod', 'topic-payments-events-prod'] }))).toContain(
      'duplicate-event-channel-environment:event-test',
    );
  });

  it('reports unknown producer or consumer definitions', () => {
    expect(codes(withEvent({ consumerServiceIds: ['ghost-service'] }))).toEqual(['missing-event-service:event-test']);
  });

  it('reports producers and consumers without the matching relationship', () => {
    expect(codes(withEvent({ producerServiceIds: ['payment-service'] }))).toEqual(['event-flow-missing-relationship:event-test']);
    expect(codes(withEvent({ consumerServiceIds: ['ledger-service'] }))).toEqual(['event-flow-missing-relationship:event-test']);
    // Direction matters: the producer does not consume from the channel.
    expect(codes(withEvent({ consumerServiceIds: ['order-service'] }))).toEqual(['event-flow-missing-relationship:event-test']);
  });

  it('includes event type IDs in the global uniqueness check', () => {
    expect(codes(withEvent({ id: 'order-service' }))).toContain('duplicate-id:order-service');
  });
});
