import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { buildTopologyIndex } from '../domain/topologyIndex';
import { isUnobserved } from './board';
import { boardFromDefinition, definitionOf, validateBoardDefinition, type BoardDefinition } from './definition';
import { paymentServiceBoard } from './mock/paymentServiceBoard';

const index = buildTopologyIndex(mockTopology);
const example = paymentServiceBoard('production');
const def = definitionOf(example);
const codes = (d: BoardDefinition) => validateBoardDefinition(d, index).map((i) => `${i.code} @ ${i.path}`);

describe('board definitions (ADR-031)', () => {
  it('round-trips the example: definition + its observed data gives the same board', () => {
    expect(boardFromDefinition(def, { environmentId: 'production', window: '24h', observed: example })).toEqual(example);
  });

  it('keeps no observed data in a definition', () => {
    const json = JSON.stringify(def);
    for (const observed of ['"stats"', '"stepStats"', '"findings"', '"provenance"', '"state"', '"stat"', '"status"']) expect(json, observed).not.toContain(observed);
  });

  it('shows a new board as declared and not observed', () => {
    const fresh: BoardDefinition = {
      serviceDefinitionId: 'order-service',
      stations: [
        { id: 'caller:gw', name: 'API Gateway', kind: 'caller' },
        { id: 'gate:http', name: 'HTTP ingress', kind: 'gate' },
        { id: 'mod:orders', name: 'Orders', kind: 'module' },
        { id: 'cli:pg', name: 'pg pool', kind: 'client' },
        { id: 'dep:db', name: 'orders-db', kind: 'dependency', entityId: 'rds-orders-prod' },
      ],
      lines: [{ id: 'H1', code: 'H1', name: 'POST /v1/orders', group: 'http', signature: 'POST /v1/orders', caller: 'API Gateway', route: [{ stations: ['caller:gw', 'gate:http', 'mod:orders', 'cli:pg', 'dep:db'], kind: 'sequential' }], patterns: ['idempotency'] }],
      policies: [
        { id: 'p1', clientId: 'cli:pg', order: 0, type: 'timeout', label: '2 s', config: { timeoutMs: '2000' } },
        { id: 'p2', clientId: 'cli:pg', order: 1, type: 'breaker', label: 'no breaker', missing: true },
      ],
      tables: [{ id: 'orders', stationId: 'dep:db', name: 'orders', writes: ['H1'], reads: [] }],
    };
    expect(codes(fresh)).toEqual([]);
    const board = boardFromDefinition(fresh, { environmentId: 'production', window: '24h' });
    expect(board.isExample).toBe(false);
    expect(isUnobserved(board.lines[0]!)).toBe(true);
    expect(board.policies.map((p) => p.state)).toEqual(['idle', 'missing']);
    expect(board.lines[0]!.provenance.entry).toEqual({ kind: 'declared', detail: 'authored in the app' });
  });

  it('keeps observed data on unchanged IDs when the example is edited', () => {
    const edited = structuredClone(def);
    edited.lines = edited.lines.filter((l) => l.id !== 'A6');
    edited.lines.push({ id: 'A7', code: 'A7', name: 'ListRefunds', group: 'grpc', signature: 'rpc ListRefunds()', caller: 'Admin Console', route: [{ stations: ['caller:admin-console', 'gate:grpc', 'mod:query'], kind: 'sequential' }], patterns: [] });
    const board = boardFromDefinition(edited, { environmentId: 'production', window: '24h', observed: example });
    expect(board.lines.find((l) => l.id === 'A2')!.stats).toEqual(example.lines.find((l) => l.id === 'A2')!.stats);
    expect(isUnobserved(board.lines.find((l) => l.id === 'A7')!)).toBe(true);
    expect(board.lines.some((l) => l.id === 'A6')).toBe(false);
  });

  it('accepts the example and reports each broken rule with its field path', () => {
    expect(codes(def)).toEqual([]);
    const broken = structuredClone(def);
    broken.serviceDefinitionId = 'nope';
    broken.stations.push({ id: 'dep:pg', name: 'dup', kind: 'dependency' });
    broken.stations.push({ id: 'dep:ghost', name: 'Ghost', kind: 'dependency', entityId: 'not-a-thing' });
    broken.stations.push({ id: 'mod:x', name: 'X', kind: 'module', entityId: 'pg-payments-prod' });
    broken.lines[1]!.code = 'A1';
    broken.lines[0]!.route[1]!.stations[0] = 'cli:ledger'; // fork from a station not on an earlier branch
    broken.lines[2]!.route[0]!.stations.push('nowhere');
    broken.policies[0]!.clientId = 'mod:capture';
    broken.tables[0]!.writes.push('A4'); // Void does not reach payments-db
    const n = def.stations.length;
    expect(codes(broken)).toEqual([
      'board-service-not-found @ serviceDefinitionId',
      `invalid-board-station @ stations[${n}].id`,
      `board-entity-not-found @ stations[${n + 1}].entityId`,
      `invalid-board-station @ stations[${n + 2}].entityId`,
      'invalid-board-line @ lines[0].route[1].stations[0]',
      'invalid-board-line @ lines[1].code',
      'invalid-board-line @ lines[2].route[0].stations[5]',
      'invalid-board-policy @ policies[0].clientId',
      'invalid-board-table @ tables[0].writes[3]',
    ]);
  });
});
