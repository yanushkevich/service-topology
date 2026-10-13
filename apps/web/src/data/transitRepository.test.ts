import { describe, expect, it } from 'vitest';
import { isUnobserved } from '../transit/board';
import { definitionOf } from '../transit/definition';
import { paymentServiceBoard } from '../transit/mock/paymentServiceBoard';
import { mockTopology } from './mock/topology';
import { createSandbox } from './sandbox/sandbox';
import { createSandboxStorage } from './sandbox/storage';
import { createTransitRepository } from './transitRepository';

describe('transit repository over stored definitions (ADR-031)', () => {
  it('shows the example until a definition is stored, then the definition with observed data merged', async () => {
    const { boards } = createSandbox(mockTopology, createSandboxStorage(null));
    const repo = createTransitRepository(boards);
    expect(repo.boards?.kind).toBe('sandbox');
    expect((await repo.getBoard('payment-service', 'production', '24h'))?.lines.map((l) => l.id)).toEqual(paymentServiceBoard('production').lines.map((l) => l.id));

    const def = definitionOf(paymentServiceBoard('production'));
    def.lines = def.lines.filter((l) => l.id !== 'A6');
    // The replica table lists A6 as a reader; a definition cannot refer to a line it no longer has.
    def.tables = def.tables.map((t) => ({ ...t, reads: t.reads.filter((id) => id !== 'A6') }));
    await boards.create(def);
    const board = (await repo.getBoard('payment-service', 'production', '24h'))!;
    expect(board.lines.some((l) => l.id === 'A6')).toBe(false);
    expect(isUnobserved(board.lines.find((l) => l.id === 'A2')!)).toBe(false); // example stats kept
  });

  it('serves an authored board for a service without example data, as not observed', async () => {
    const { boards } = createSandbox(mockTopology, createSandboxStorage(null));
    const repo = createTransitRepository(boards);
    expect(await repo.getBoard('order-service', 'production', '24h')).toBeNull();
    await boards.create({
      serviceDefinitionId: 'order-service',
      stations: [
        { id: 'caller:gw', name: 'API Gateway', kind: 'caller' },
        { id: 'gate:http', name: 'HTTP ingress', kind: 'gate' },
      ],
      lines: [{ id: 'H1', code: 'H1', name: 'POST /v1/orders', group: 'http', signature: 'POST /v1/orders', caller: 'API Gateway', route: [{ stations: ['caller:gw', 'gate:http'], kind: 'sequential' }], patterns: [] }],
      policies: [],
      tables: [],
    });
    const board = (await repo.getBoard('order-service', 'production', '24h'))!;
    expect(board.isExample).toBe(false);
    expect(isUnobserved(board.lines[0]!)).toBe(true);
  });

  it('is the plain observed repository without a store (generated datasets)', () => {
    expect(createTransitRepository(null).boards).toBeUndefined();
  });
});
