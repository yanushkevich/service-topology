import { describe, expect, it } from 'vitest';
import { mockTopology } from '../mock/topology';
import { generateTopology, SCALE_250 } from '../mock/generateTopology';
import { createApiClient, ApiError } from '../http/apiClient';
import { createHttpTopologyRepository } from '../http/httpRepositories';
import { createHttpBoardStore } from '../boards/httpBoardStore';
import { createSandbox } from '../sandbox/sandbox';
import { createSandboxStorage } from '../sandbox/storage';
import { createTransitRepository } from '../transitRepository';
import { definitionOf } from '../../transit/definition';
import { paymentServiceBoard } from '../../transit/mock/paymentServiceBoard';
import { collectBundle } from './collect';
import { readBundle, serializeBundle } from './format';

const NOW = new Date('2026-10-13T09:30:00.000Z');
const fresh = () => createSandbox(mockTopology, createSandboxStorage(null));
const orderBoard = {
  serviceDefinitionId: 'order-service',
  stations: [
    { id: 'caller:gw', name: 'API Gateway', kind: 'caller' as const },
    { id: 'gate:http', name: 'HTTP ingress', kind: 'gate' as const },
  ],
  lines: [{ id: 'H1', code: 'H1', name: 'POST /v1/orders', group: 'http' as const, signature: 'POST /v1/orders', caller: 'API Gateway', route: [{ stations: ['caller:gw', 'gate:http'], kind: 'sequential' as const }], patterns: [] }],
  policies: [],
  tables: [],
};

describe('export and import of all data (ADR-032)', () => {
  it('exports the sandbox with stored and example boards, and a fresh sandbox imports it identically', async () => {
    const source = fresh();
    await source.boards.create(orderBoard);
    await source.topology.writer!.create('environment', { id: 'qa', name: 'QA', kind: 'other' });
    const topology = await source.topology.getTopology();
    const bundle = await collectBundle({ topology, sourceLabel: source.topology.sourceLabel, isMock: true, transit: createTransitRepository(source.boards), now: NOW });
    expect(bundle.exportedAt).toBe('2026-10-13T09:30:00Z');
    expect(bundle.transitBoards.map((b) => b.serviceDefinitionId)).toEqual(['order-service', 'payment-service']);
    expect(bundle.transitBoards[1]).toEqual(definitionOf(paymentServiceBoard('production')));

    for (const format of ['json', 'yaml'] as const) {
      const read = readBundle(serializeBundle(bundle, format), format);
      if (!read.ok) throw new Error(JSON.stringify(read.issues));
      const target = fresh();
      const { counts } = await target.topology.importer!.importBundle(read.bundle);
      expect(counts).toMatchObject({ environments: topology.environments.length, transitBoards: 2 });
      expect(await target.topology.getTopology()).toEqual(topology);
      expect((await target.boards.list()).map((b) => [b.definition.serviceDefinitionId, b.revision])).toEqual([
        ['order-service', '1'],
        ['payment-service', '1'],
      ]);
      expect((await target.boards.get('order-service'))?.definition).toEqual(orderBoard);
    }
  });

  it('rejects an invalid bundle in the sandbox like the API, and keeps the data', async () => {
    const sandbox = fresh();
    const topology = await sandbox.topology.getTopology();
    const bundle = await collectBundle({ topology, sourceLabel: 'x', isMock: true, transit: createTransitRepository(sandbox.boards), now: NOW });
    const broken = { ...bundle, transitBoards: [...bundle.transitBoards, bundle.transitBoards[0]!] };
    const error = await sandbox.topology.importer!.importBundle(broken).catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).issues).toEqual([expect.objectContaining({ code: 'bundle-duplicate-board', path: 'transitBoards[1].serviceDefinitionId' })]);
    expect(await sandbox.topology.getTopology()).toEqual(topology);
  });

  it('leaves out example boards for services a generated dataset does not have', async () => {
    const topology = generateTopology(SCALE_250);
    const bundle = await collectBundle({ topology, sourceLabel: 'Generated', isMock: true, transit: createTransitRepository(null), now: NOW });
    expect(topology.serviceDefinitions.some((d) => d.id === 'payment-service')).toBe(false);
    expect(bundle.transitBoards).toEqual([]);
  });

  it('imports through the backend with the topology revision, and lists stored boards', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url} ${new Headers(init?.headers).get('If-Match') ?? '-'}`);
      const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
      if (url.endsWith('/meta')) return json({ topology: { sourceType: 'fixture', isMock: true } });
      if (url.endsWith('/topology')) return json(mockTopology, { ETag: '"rev-1"' });
      if (url.endsWith('/imports/bundle')) return json({ revision: 'rev-2', documents: { environments: 3, serviceDefinitions: 9 }, boards: 1 }, { ETag: '"rev-2"' });
      if (url.endsWith('/transit-boards')) return json({ items: [{ serviceDefinitionId: 'order-service', revision: '1', updatedAt: 'x', lines: 1 }] });
      return json(orderBoard, { ETag: '"1"' });
    };
    const api = createApiClient('/api/v1', fetchImpl);
    const repo = createHttpTopologyRepository(api);
    await repo.getTopology();
    const bundle = await collectBundle({ topology: mockTopology, sourceLabel: 'Backend', isMock: true, transit: createTransitRepository(createHttpBoardStore(api)), now: NOW });
    expect(bundle.transitBoards.map((b) => b.serviceDefinitionId)).toEqual(['order-service', 'payment-service']);
    const { counts } = await repo.importer!.importBundle(bundle);
    expect(counts).toMatchObject({ environments: 3, serviceDefinitions: 9, eventTypes: 0, transitBoards: 1 });
    expect(calls).toContain('POST /api/v1/imports/bundle "rev-1"');
  });

  it('keeps the field path of the API’s issues (422)', async () => {
    const problem = { type: 'x', title: 'Validation failed', status: 422, errors: [{ code: 'bundle-duplicate-board', path: 'transitBoards[1].serviceDefinitionId', message: 'Two transit boards' }] };
    const api = createApiClient('/api/v1', async () => new Response(JSON.stringify(problem), { status: 422, headers: { 'Content-Type': 'application/problem+json' } }));
    const error = await createHttpTopologyRepository(api).importer!.importBundle({} as never).catch((e: unknown) => e as ApiError);
    expect((error as ApiError).issues).toEqual([{ code: 'bundle-duplicate-board', path: 'transitBoards[1].serviceDefinitionId', message: 'Two transit boards' }]);
  });
});
