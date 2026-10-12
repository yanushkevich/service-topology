import { describe, expect, it } from 'vitest';
import { budgetFor, dependenciesOf, formatMs, indexBoard, isUnobserved, matchingLines } from './board';
import { paymentServiceBoard } from './mock/paymentServiceBoard';

const index = indexBoard(paymentServiceBoard('production'));
const line = (id: string) => index.lineById.get(id)!;

describe('transit board model', () => {
  it('is example data whose routes only reference known stations and lanes', () => {
    expect(index.board.isExample).toBe(true);
    for (const l of index.lines) for (const b of l.route) for (const id of b.stations) expect(index.stations.has(id), `${l.id}: ${id}`).toBe(true);
    for (const p of index.board.policies) expect(index.stations.get(p.clientId)?.kind).toBe('client');
  });

  it('orders lines by code and lists the lines through each station', () => {
    expect(index.lines.map((l) => l.code)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'E1', 'J1', 'J2', 'O1', 'W1']);
    expect(index.linesByStation.get('cli:ledger')).toEqual(['A3', 'J2', 'W1']);
  });

  it('searches by name, transport, and station name', () => {
    expect([...matchingLines(index, 'ledger')]).toEqual(['A3', 'J2', 'W1']);
    expect([...matchingLines(index, 'KAFKA')]).toEqual(['E1']);
    expect([...matchingLines(index, 'cron')]).toEqual(['J1', 'J2']);
    expect([...matchingLines(index, 'https')]).toEqual(['W1']);
    expect(matchingLines(index, '  ').size).toBe(index.lines.length);
    expect(matchingLines(index, 'zzz').size).toBe(0);
  });

  it('stacks downstream timeouts × attempts against the deadline', () => {
    const budget = budgetFor(index, line('A1'))!;
    expect(budget.segments.map((s) => [s.clientId, s.timeoutMs, s.attempts, s.ms])).toEqual([
      ['cli:fraud', 300, 2, 600],
      ['cli:card', 2000, 4, 8000],
    ]);
    expect(budget.overflowMs).toBe(8600 - 3000);
    // Jobs and consumers without a deadline have no budget bar.
    expect(budgetFor(index, line('J1'))).toBeNull();
    // An alternative branch is not part of the typical budget.
    expect(budgetFor(index, line('A5'))!.segments.map((s) => s.clientId)).toEqual(['cli:cache']);
  });

  it('counts clients whose config is unknown instead of treating them as zero', () => {
    const board = paymentServiceBoard('production');
    board.policies = board.policies.map((p) => (p.clientId === 'cli:card' ? { ...p, state: 'unknown' } : p));
    const budget = budgetFor(indexBoard(board), board.lines.find((l) => l.id === 'A1')!)!;
    expect(budget.segments.map((s) => s.clientId)).toEqual(['cli:fraud']);
    expect(budget.uncounted).toBe(1);
  });

  it('knows dependencies and unobserved lines', () => {
    expect(dependenciesOf(index, line('A2')).map((s) => s.id)).toEqual(['dep:card', 'dep:pg']);
    expect(isUnobserved(line('O1'))).toBe(true);
    expect(isUnobserved(line('A1'))).toBe(false);
    expect([formatMs(9), formatMs(2100), formatMs(360_000)]).toEqual(['9 ms', '2.1 s', '6 min']);
  });
});
