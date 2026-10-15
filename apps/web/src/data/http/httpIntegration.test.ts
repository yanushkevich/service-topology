import { describe, expect, it, vi } from 'vitest';
import { connectedStatus, readyPreview } from '../../test/fakeIntegration';
import { createApiClient } from './apiClient';
import { createHttpSourceIntegration } from './httpIntegration';

/** The Dynatrace connector's HTTP client (ADR-034, docs/api/openapi.json "integrations"). */

function fakeFetch(respond: (method: string, url: string, init?: RequestInit) => Response) {
  const calls: { method: string; url: string; ifMatch: string | null; body: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, ifMatch: headers['If-Match'] ?? null, body: init?.body ? JSON.parse(init.body as string) : undefined });
    return respond(method, url, init);
  });
  return { integration: createHttpSourceIntegration(createApiClient('/api/v1', fn)), calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe('createHttpSourceIntegration', () => {
  it('reads the status, and a backend without a connection as null', async () => {
    let configured = true;
    const { integration } = fakeFetch(() =>
      configured ? json(connectedStatus) : json({ type: 'https://example.test/problems/integration-not-configured', title: 'Not found', status: 404 }, 404),
    );
    expect(await integration.status()).toEqual(connectedStatus);
    configured = false;
    expect(await integration.status()).toBeNull();
  });

  it('applies a preview by ID, guarded by its base revision', async () => {
    const { integration, calls } = fakeFetch((_method, url) =>
      url.endsWith('/preview') ? json(readyPreview, 200, { ETag: '"rev-1"' }) : json({ revision: 'rev-2', summary: {} }, 200, { ETag: '"rev-2"' }),
    );
    const preview = await integration.preview();
    expect(await integration.apply(preview)).toBe('rev-2');
    expect(calls.at(-1)).toEqual({ method: 'POST', url: '/api/v1/integrations/dynatrace/apply', ifMatch: '"rev-1"', body: { previewId: 'preview-1' } });
  });

  it('reads and saves aliases with their revision', async () => {
    const { integration, calls } = fakeFetch((method) =>
      method === 'GET' ? json({ aliases: {} }, 200, { ETag: '"0"' }) : json({ aliases: { PaymentService: 'payment-service' } }, 200, { ETag: '"1"' }),
    );
    const stored = await integration.aliases();
    expect(stored).toEqual({ aliases: {}, revision: '"0"' });
    expect(await integration.saveAliases({ PaymentService: 'payment-service' }, stored.revision)).toEqual({ aliases: { PaymentService: 'payment-service' }, revision: '"1"' });
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', ifMatch: '"0"', body: { aliases: { PaymentService: 'payment-service' } } });
  });
});
