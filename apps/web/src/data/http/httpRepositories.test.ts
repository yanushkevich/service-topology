import { describe, expect, it, vi } from 'vitest';
import { mockSnapshots } from '../mock/snapshots';
import { mockTopology } from '../mock/topology';
import { selectRepository } from '../selectRepository';
import { ApiError, createApiClient } from './apiClient';
import { createHttpSavedLayoutRepository, createHttpSnapshotRepository, createHttpTopologyRepository } from './httpRepositories';

type Route = (init: RequestInit | undefined) => { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    calls.push(key);
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ type: 'about:blank', title: 'Not found', status: 404, requestId: 'req-404' }), { status: 404 });
    const { status, body, headers } = route(init);
    return new Response(status === 204 ? null : JSON.stringify(body), headers ? { status, headers } : { status });
  });
  return { fn, calls };
}

const layout = {
  schemaVersion: 1,
  id: 'layout-1',
  name: 'On-call',
  createdAt: '2026-10-11T09:00:00.000Z',
  view: { environmentId: 'production', layoutMode: 'topology', filters: { query: '', providers: [], health: [], groups: [] }, collapsedGroupIds: [] },
  positions: {},
} as const;

describe('HTTP repositories (backend integration)', () => {
  it('loads the topology and labels the source from /meta (still mock for fixture data)', async () => {
    const { fn } = fakeFetch({
      'GET /api/v1/meta': () => ({ status: 200, body: { topology: { sourceType: 'fixture', isMock: true } } }),
      'GET /api/v1/topology': () => ({ status: 200, body: mockTopology }),
    });
    const repo = createHttpTopologyRepository(createApiClient('/api/v1', fn));
    expect(repo.isMock).toBe(true);
    const data = await repo.getTopology();
    expect(data.serviceInstances).toHaveLength(mockTopology.serviceInstances.length);
    expect(repo.sourceLabel).toBe('Backend API · mock inventory');
    expect(repo.isMock).toBe(true);
  });

  it('surfaces problem details with the request ID', async () => {
    const { fn } = fakeFetch({ 'GET /api/v1/meta': () => ({ status: 503, body: { type: 'x', title: 'Service unavailable', status: 503, requestId: 'req-1' } }) });
    const repo = createHttpTopologyRepository(createApiClient('/api/v1', fn));
    await expect(repo.getTopology()).rejects.toThrow(new ApiError(503, 'Service unavailable', 'req-1'));
  });

  it('reads snapshots, treating 404 and invalid payloads as missing', async () => {
    const snap = mockSnapshots()[0]!;
    const { fn, calls } = fakeFetch({
      'GET /api/v1/topology/snapshots': () => ({ status: 200, body: { items: [{ id: snap.id, label: snap.label, takenAt: snap.takenAt, source: snap.source, isSimulated: true }] } }),
      [`GET /api/v1/topology/snapshots/${snap.id}`]: () => ({ status: 200, body: snap }),
      'GET /api/v1/topology/snapshots/broken': () => ({ status: 200, body: { ...snap, id: 'broken', source: 'observed', isSimulated: false, data: { environments: 'x' } } }),
      'POST /api/v1/topology/snapshots': () => ({ status: 201, body: {} }),
    });
    const repo = createHttpSnapshotRepository(createApiClient('/api/v1', fn));
    expect(await repo.list()).toHaveLength(1);
    expect((await repo.get(snap.id))?.data.serviceInstances.length).toBeGreaterThan(0);
    expect(await repo.get('ghost')).toBeNull();
    expect(await repo.get('broken')).toBeNull();
    await repo.save(snap);
    expect(calls).toContain('POST /api/v1/topology/snapshots');
  });

  it('saves layouts with PUT, falling back to POST for new ones, and ignores deleting a missing layout', async () => {
    let stored = false;
    const { fn, calls } = fakeFetch({
      'GET /api/v1/layouts': () => ({ status: 200, body: { items: [layout, { ...layout, id: 'bad', schemaVersion: 9 }] } }),
      'PUT /api/v1/layouts/layout-1': () => (stored ? { status: 200, body: layout } : { status: 404, body: { title: 'Not found', status: 404 } }),
      'POST /api/v1/layouts': () => {
        stored = true;
        return { status: 201, body: layout };
      },
      'DELETE /api/v1/layouts/layout-1': () => ({ status: 204 }),
    });
    const repo = createHttpSavedLayoutRepository(createApiClient('/api/v1', fn));
    expect((await repo.list()).map((l) => l.id)).toEqual(['layout-1']); // invalid entry dropped
    await repo.save(structuredClone(layout) as never);
    await repo.save(structuredClone(layout) as never);
    expect(calls.filter((c) => c.startsWith('PUT') || c.startsWith('POST'))).toEqual(['PUT /api/v1/layouts/layout-1', 'POST /api/v1/layouts', 'PUT /api/v1/layouts/layout-1']);
    await repo.remove('layout-1');
    await repo.remove('ghost');
  });

  it('selects the backend with ?source=api or VITE_DATA_SOURCE=api', () => {
    expect(selectRepository('?source=api').topology.sourceLabel).toBe('Backend API');
    expect(selectRepository('', 'api').topology.sourceLabel).toBe('Backend API');
    expect(selectRepository('').topology.sourceLabel).toBe('Mock inventory');
    expect(selectRepository('?dataset=scale-250').topology.sourceLabel).toContain('scale-250');
  });
});
