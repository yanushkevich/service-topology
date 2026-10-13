import { describe, expect, it } from 'vitest';
import { createApiClient } from '../http/apiClient';
import { createHttpBoardStore } from './httpBoardStore';

const def = { serviceDefinitionId: 'order-service', stations: [], lines: [], policies: [], tables: [] };

describe('board store over the backend API (ADR-031)', () => {
  it('reads with the ETag, writes with If-Match, and treats 404 as no board', async () => {
    const calls: { method: string; url: string; ifMatch: string | null }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ method: init?.method ?? 'GET', url, ifMatch: headers.get('If-Match') });
      if (url.endsWith('/transit-boards/missing')) return new Response(JSON.stringify({ type: 'x', title: 'Not found', status: 404 }), { status: 404, headers: { 'Content-Type': 'application/problem+json' } });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify(def), { status: init?.method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json', ETag: '"7"' } });
    };
    const store = createHttpBoardStore(createApiClient('/api/v1', fetchImpl));
    expect(store.kind).toBe('backend');
    expect(await store.get('missing')).toBeNull();
    expect(await store.get('order-service')).toEqual({ definition: def, revision: '"7"' });
    expect((await store.create(def)).revision).toBe('"7"');
    await store.replace(def, '"7"');
    await store.remove('order-service', '"7"');
    expect(calls.map((c) => `${c.method} ${c.url} ${c.ifMatch ?? '-'}`)).toEqual([
      'GET /api/v1/transit-boards/missing -',
      'GET /api/v1/transit-boards/order-service -',
      'POST /api/v1/transit-boards -',
      'PUT /api/v1/transit-boards/order-service "7"',
      'DELETE /api/v1/transit-boards/order-service "7"',
    ]);
  });
});
