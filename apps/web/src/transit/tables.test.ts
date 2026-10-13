import { describe, expect, it } from 'vitest';
import { indexBoard, lineStations, tablesOfLine, withTableFindings } from './board';
import { paymentServiceBoard } from './mock/paymentServiceBoard';

const board = paymentServiceBoard('production');
const index = indexBoard(board);
const rule = (b: typeof board, lineId: string) => b.lines.find((l) => l.id === lineId)!.findings.filter((f) => f.ruleId === 'store-pattern-without-table');

describe('tables: where patterns meet the database (ADR-027)', () => {
  it('has every writer and reader reach the table’s station on its route', () => {
    for (const table of board.tables ?? []) {
      for (const lineId of [...table.writes, ...table.reads]) {
        const line = index.lineById.get(lineId);
        expect(line, `${table.name}: line ${lineId}`).toBeDefined();
        expect(lineStations(line!), `${table.name} on ${lineId}`).toContain(table.stationId);
      }
    }
  });

  it('lists what a line does with each table, in route order', () => {
    const capture = tablesOfLine(index, index.lineById.get('A2')!).map((u) => [u.table.name, u.writes, u.reads]);
    expect(capture).toEqual([
      ['payments', true, false],
      ['payment_outbox', true, false],
    ]);
    expect(tablesOfLine(index, index.lineById.get('O1')!).map((u) => u.table.name)).toEqual(['payment_outbox']);
  });

  it('flags a store pattern with no table on the route, and clears it when the table is declared', () => {
    const checked = withTableFindings(board);
    for (const id of ['A2', 'W1', 'O1']) expect(rule(checked, id), id).toEqual([]);
    const noOutbox = { ...board, tables: (board.tables ?? []).filter((t) => t.pattern !== 'outbox') };
    const flagged = withTableFindings(noOutbox);
    expect(rule(flagged, 'A2').map((f) => f.text)).toEqual(['Capture declares the transactional outbox pattern, but no outbox table on its route is used by it.']);
    expect(rule(flagged, 'O1').map((f) => f.text)).toContainEqual('OutboxRelay declares the polling publisher pattern, but no outbox table on its route is polled by it.');
    // The inbox must be written by the line that declares it.
    const readOnlyInbox = { ...board, tables: (board.tables ?? []).map((t) => (t.pattern === 'inbox' ? { ...t, writes: [] } : t)) };
    expect(rule(withTableFindings(readOnlyInbox), 'W1').map((f) => f.text)).toEqual(['POST /webhooks/processor declares the inbox pattern, but no inbox table on its route is written by it.']);
  });
});
