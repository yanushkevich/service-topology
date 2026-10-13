import { describe, expect, it } from 'vitest';
import { businessFlows } from '../data/mock/businessFlows';
import { paymentServiceBoard } from '../transit/mock/paymentServiceBoard';
import { exampleOpenApi } from './examples';
import { exampleOf, findContract, parseHttpEndpoint, type SchemaNode } from './openapi';

const orders = exampleOpenApi.get('order-service')!.doc;
const payments = exampleOpenApi.get('payment-service')!.doc;
const field = (node: SchemaNode | undefined, name: string) => node?.properties?.find((p) => p.name === name);

describe('OpenAPI contracts (ADR-029)', () => {
  it('recognizes HTTP endpoints and nothing else', () => {
    expect(parseHttpEndpoint('POST /v1/orders')).toEqual({ method: 'post', path: '/v1/orders' });
    expect(parseHttpEndpoint('Authorize')).toBeNull();
    expect(parseHttpEndpoint('OrderShipped consumer')).toBeNull();
  });

  it('reads Place order: header, request model, and responses by status, with examples', () => {
    const c = findContract(orders, 'POST /v1/orders')!;
    expect(c).toMatchObject({ method: 'POST', path: '/v1/orders', operationId: 'createOrder', source: 'Order Service API 7.0.3' });
    expect(c.parameters).toMatchObject([{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }]);
    const body = c.requestBody!;
    expect(body).toMatchObject({ contentType: 'application/json', required: true, schema: { ref: 'CreateOrderRequest', type: 'object' } });
    const items = field(body.schema, 'items')!;
    expect(items).toMatchObject({ type: 'array', required: true, constraints: ['min items 1'] });
    expect(items.items?.properties?.filter((p) => p.required).map((p) => p.name)).toEqual(['sku', 'quantity']);
    expect(c.responses.map((r) => [r.status, r.schema?.ref ?? null])).toEqual([
      ['201', 'Order'],
      ['400', 'Problem'],
      ['409', 'Problem'],
    ]);
    expect(body.example).toEqual({ customerId: 'cus_281', items: [{ sku: 'SKU-1042', quantity: 2, unitPrice: { amountMinor: 4999, currency: 'EUR' } }], shippingAddress: { line1: 'Kaiserstraße 1', city: 'Frankfurt', country: 'DE' }, note: 'string' });
  });

  it('merges allOf, stops at $ref cycles, and resolves parameter references', () => {
    const order = findContract(orders, 'GET /v1/orders/{id}')!;
    expect(order.parameters).toMatchObject([{ name: 'id', in: 'path', required: true }]);
    const schema = order.responses[0]!.schema!;
    // allOf: CreateOrderRequest's fields and required list plus Order's own.
    expect(schema.properties?.map((p) => p.name)).toEqual(['customerId', 'items', 'shippingAddress', 'note', 'id', 'status', 'total', 'createdAt', 'replacementOf']);
    expect(schema.properties?.filter((p) => p.required).map((p) => p.name)).toEqual(['customerId', 'items', 'id', 'status', 'total', 'createdAt']);
    // Order refers to itself: drawn by name, not expanded, and left out of the example.
    expect(field(schema, 'replacementOf')).toMatchObject({ type: 'Order', cycle: true, description: 'The order this one replaces, if any.' });
    expect(Object.keys(exampleOf(schema) as object)).not.toContain('replacementOf');
    expect(field(schema, 'status')?.enum).toEqual(['placed', 'paid', 'shipped', 'cancelled', 'refunded']);
  });

  it('lists oneOf variants (the processor webhook’s events)', () => {
    const c = findContract(payments, 'POST /webhooks/processor')!;
    const body = c.requestBody!.schema;
    expect(body.type).toBe('oneOf');
    expect(body.variants?.map((v) => v.ref)).toEqual(['SettlementEvent', 'ChargebackEvent']);
    expect(field(body.variants?.[0], 'type')?.enum).toEqual(['payment.settled']);
    expect(c.responses.map((r) => r.status)).toEqual(['204', '401', '422']);
    expect(c.responses[0]?.schema).toBeUndefined();
  });

  it('resolves every HTTP entry point of the example flows and lines', () => {
    const endpoints = [
      ...businessFlows.flatMap((f) => f.steps.map((s) => [s.serviceDefinitionId, s.entryPoint ?? ''] as const)),
      ...paymentServiceBoard('production').lines.map((l) => ['payment-service', l.signature] as const),
    ].filter(([, e]) => parseHttpEndpoint(e));
    expect(endpoints.length).toBe(4);
    for (const [service, endpoint] of endpoints) expect(findContract(exampleOpenApi.get(service)!.doc, endpoint), `${service} ${endpoint}`).not.toBeNull();
  });

  it('answers null for an operation the document does not have', () => {
    expect(findContract(orders, 'DELETE /v1/orders')).toBeNull();
    expect(findContract(orders, 'Authorize')).toBeNull();
  });
});
