import type { BusinessFlow, FlowPolicy } from '../../domain/types';

/**
 * Example business flows (ADR-022, docs/BUSINESS_FLOWS.md §6) over the mock topology. Every
 * transition between two services is backed by a relationship or an event type that the mock
 * already models; validation checks that in every environment.
 */

const p = (type: FlowPolicy['type'], label: string, state: NonNullable<FlowPolicy['state']>, extra: Partial<FlowPolicy> = {}): FlowPolicy => ({ type, label, state, ...extra });

export const checkoutFlow: BusinessFlow = {
  id: 'flow-checkout',
  name: 'Checkout',
  description: 'From a placed order to a shipped, paid order and a customer notification.',
  owner: 'Commerce',
  team: 'Orders',
  trigger: { kind: 'call', ref: 'api-gateway' },
  startStepId: 'place-order',
  target: { p95Ms: 4000, completionMs: 900_000 },
  steps: [
    { id: 'place-order', name: 'Place order', serviceDefinitionId: 'order-service', kind: 'task', entryPoint: 'POST /v1/orders' },
    { id: 'reserve-stock', name: 'Reserve stock', serviceDefinitionId: 'inventory-service', kind: 'task', entryPoint: 'ReserveStock', compensatedBy: 'release-stock', deadlineMs: 2000 },
    { id: 'authorize-payment', name: 'Authorize payment', serviceDefinitionId: 'payment-service', kind: 'decision', entryPoint: 'Authorize', compensatedBy: 'void-authorization', deadlineMs: 3000 },
    { id: 'capture-payment', name: 'Capture payment', serviceDefinitionId: 'payment-service', kind: 'task', entryPoint: 'Capture', deadlineMs: 3000 },
    { id: 'await-settlement', name: 'Await settlement', serviceDefinitionId: 'payment-service', kind: 'wait', entryPoint: 'POST /webhooks/processor', deadlineMs: 600_000 },
    { id: 'post-to-ledger', name: 'Post to ledger', serviceDefinitionId: 'ledger-service', kind: 'task', entryPoint: 'PostCapture' },
    { id: 'ship-order', name: 'Ship order', serviceDefinitionId: 'order-service', kind: 'task', entryPoint: 'ShipOrder' },
    { id: 'notify-customer', name: 'Notify customer', serviceDefinitionId: 'notification-service', kind: 'task', entryPoint: 'OrderShipped consumer' },
    { id: 'send-email', name: 'Send email', serviceDefinitionId: 'email-dispatcher', kind: 'task', entryPoint: 'notifications.email consumer' },
    { id: 'cancel-order', name: 'Cancel order', serviceDefinitionId: 'order-service', kind: 'task', entryPoint: 'CancelOrder' },
    { id: 'release-stock', name: 'Release stock', serviceDefinitionId: 'inventory-service', kind: 'compensation', entryPoint: 'OrderCancelled consumer' },
    { id: 'void-authorization', name: 'Void authorization', serviceDefinitionId: 'payment-service', kind: 'compensation', entryPoint: 'Void' },
  ],
  transitions: [
    {
      id: 'placed',
      from: 'place-order',
      to: 'reserve-stock',
      via: { kind: 'event', eventTypeId: 'event-order-placed' },
      policies: [p('outbox', 'no outbox', 'missing'), p('redelivery', 'redelivery ×5', 'exercised', { config: { maxAttempts: '5' }, stat: 'fires on 0.4%' }), p('idempotent-consumer', 'no dedupe', 'missing')],
    },
    {
      id: 'authorize',
      from: 'reserve-stock',
      to: 'authorize-payment',
      via: { kind: 'call', callerServiceId: 'order-service' },
      policies: [p('timeout', '3 s', 'exercised', { config: { timeoutMs: '3000' }, stat: 'hit by 0.6%' }), p('retry', 'retry ×3', 'exercised', { config: { maxAttempts: '3' }, stat: 'fires on 1.1%' }), p('idempotency', 'idempotency key', 'exercised')],
    },
    { id: 'approved', from: 'authorize-payment', to: 'capture-payment', via: { kind: 'local' }, condition: 'approved', policies: [] },
    { id: 'declined', from: 'authorize-payment', to: 'cancel-order', via: { kind: 'call' }, condition: 'declined', policies: [p('step-deadline', 'reply ≤ 3 s', 'exercised', { config: { deadlineMs: '3000' } })] },
    {
      id: 'captured',
      from: 'capture-payment',
      to: 'ship-order',
      via: { kind: 'call' },
      policies: [p('timeout', '3 s', 'exercised', { config: { timeoutMs: '3000' } }), p('retry', 'retry ×3', 'exercised', { config: { maxAttempts: '3' }, stat: 'fires on 0.9%' })],
    },
    { id: 'settle', from: 'capture-payment', to: 'await-settlement', via: { kind: 'local' }, policies: [p('step-deadline', 'settle ≤ 10 min', 'exercised', { config: { deadlineMs: '600000' }, stat: 'missed by 0.3%' })] },
    {
      id: 'settled',
      from: 'await-settlement',
      to: 'post-to-ledger',
      via: { kind: 'event', eventTypeId: 'event-payment-captured' },
      policies: [p('outbox', 'outbox', 'exercised'), p('redelivery', 'redelivery ×5', 'exercised', { config: { maxAttempts: '5' }, stat: 'fires on 0.1%' }), p('dead-letter', 'no DLQ', 'missing'), p('idempotent-consumer', 'dedupe by payment', 'exercised')],
    },
    { id: 'not-settled', from: 'await-settlement', to: 'cancel-order', via: { kind: 'call' }, condition: 'not settled in 10 min', policies: [p('manual-intervention', 'review queue', 'idle')] },
    { id: 'ledger-done', from: 'post-to-ledger', to: 'completed', via: { kind: 'local' }, policies: [] },
    {
      id: 'shipped',
      from: 'ship-order',
      to: 'notify-customer',
      via: { kind: 'event', eventTypeId: 'event-order-shipped' },
      policies: [p('outbox', 'no outbox', 'missing'), p('redelivery', 'redelivery ×5', 'exercised', { config: { maxAttempts: '5' } }), p('idempotent-consumer', 'dedupe by order', 'exercised')],
    },
    {
      id: 'notify',
      from: 'notify-customer',
      to: 'send-email',
      via: { kind: 'event', eventTypeId: 'event-notification-requested' },
      policies: [p('redelivery', 'redelivery ×3', 'exercised', { config: { maxAttempts: '3' } }), p('dead-letter', 'notifications.dlq', 'idle')],
    },
    { id: 'sent', from: 'send-email', to: 'completed', via: { kind: 'local' }, policies: [] },
    {
      id: 'cancelled',
      from: 'cancel-order',
      to: 'release-stock',
      via: { kind: 'event', eventTypeId: 'event-order-cancelled' },
      policies: [p('redelivery', 'redelivery ×5', 'exercised', { config: { maxAttempts: '5' } }), p('compensation', 'release hold', 'exercised')],
    },
    { id: 'void', from: 'cancel-order', to: 'void-authorization', via: { kind: 'call' }, condition: 'payment was authorized', policies: [p('retry', 'retry ×3', 'idle', { config: { maxAttempts: '3' } }), p('compensation', 'void', 'idle')] },
    { id: 'released', from: 'release-stock', to: 'order-cancelled', via: { kind: 'local' }, policies: [] },
    { id: 'voided', from: 'void-authorization', to: 'order-cancelled', via: { kind: 'local' }, policies: [] },
  ],
  outcomes: [
    { id: 'completed', name: 'Completed', kind: 'success' },
    { id: 'order-cancelled', name: 'Cancelled', kind: 'cancelled' },
  ],
  source: { kind: 'authored' },
};

export const refundFlow: BusinessFlow = {
  id: 'flow-refund',
  name: 'Refund',
  description: 'A customer refund from request to ledger posting.',
  owner: 'Payments',
  team: 'Payments',
  trigger: { kind: 'call', ref: 'api-gateway' },
  startStepId: 'request-refund',
  target: { p95Ms: 6000 },
  steps: [
    { id: 'request-refund', name: 'Request refund', serviceDefinitionId: 'order-service', kind: 'task', entryPoint: 'POST /v1/orders/{id}/refunds' },
    { id: 'refund-payment', name: 'Refund payment', serviceDefinitionId: 'payment-service', kind: 'decision', entryPoint: 'Refund', deadlineMs: 5000 },
    { id: 'post-refund', name: 'Post refund to ledger', serviceDefinitionId: 'ledger-service', kind: 'task', entryPoint: 'PostRefund' },
  ],
  transitions: [
    {
      id: 'refund',
      from: 'request-refund',
      to: 'refund-payment',
      via: { kind: 'call' },
      policies: [p('timeout', '5 s', 'exercised', { config: { timeoutMs: '5000' } }), p('retry', 'retry ×2', 'exercised', { config: { maxAttempts: '2' }, stat: 'fires on 1.2%' }), p('idempotency', 'no idem key', 'missing')],
    },
    {
      id: 'issued',
      from: 'refund-payment',
      to: 'post-refund',
      via: { kind: 'event', eventTypeId: 'event-refund-issued' },
      condition: 'refund accepted',
      policies: [p('outbox', 'outbox', 'exercised'), p('redelivery', 'redelivery ×5', 'exercised', { config: { maxAttempts: '5' } }), p('idempotent-consumer', 'no dedupe', 'missing')],
    },
    { id: 'rejected', from: 'refund-payment', to: 'refund-rejected', via: { kind: 'local' }, condition: 'processor declined', policies: [] },
    { id: 'posted', from: 'post-refund', to: 'refunded', via: { kind: 'local' }, policies: [] },
  ],
  outcomes: [
    { id: 'refunded', name: 'Refunded', kind: 'success' },
    { id: 'refund-rejected', name: 'Rejected', kind: 'failed' },
  ],
  source: { kind: 'authored' },
};

export const businessFlows: BusinessFlow[] = [checkoutFlow, refundFlow];
