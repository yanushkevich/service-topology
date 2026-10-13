import { describe, expect, it } from 'vitest';
import { checkoutFlow } from '../../data/mock/businessFlows';
import { typicalPath } from '../../domain/businessFlow';
import { indexBoard } from '../board';
import { paymentServiceBoard } from '../mock/paymentServiceBoard';
import { flowLineRows, flowLinesSummary } from './flowLines';

const payments = indexBoard(paymentServiceBoard('production'));
const boards = new Map([['payment-service', payments]]);
const name = (id: string) => id;
const rows = flowLineRows(checkoutFlow, boards, name, typicalPath(checkoutFlow).steps);

describe('which lines each step uses (Milestone 13.2)', () => {
  it('lists every step once, the typical path first in its order', () => {
    expect(rows).toHaveLength(checkoutFlow.steps.length);
    expect(new Set(rows.map((r) => r.stepId)).size).toBe(rows.length);
    const typical = typicalPath(checkoutFlow).steps;
    expect(rows.slice(0, typical.length).map((r) => r.stepId)).toEqual(typical);
    expect(rows.slice(typical.length).every((r) => !r.typical)).toBe(true);
  });

  it('maps the Payment Service steps to their lines, with route, dependencies, policies, and stats', () => {
    const codes = Object.fromEntries(rows.filter((r) => r.status === 'mapped').map((r) => [r.stepId, r.line?.code]));
    expect(codes).toEqual({ 'authorize-payment': 'A1', 'capture-payment': 'A2', 'await-settlement': 'W1', 'void-authorization': 'A4' });
    const capture = rows.find((r) => r.stepId === 'capture-payment')?.line;
    const a2 = payments.lines.find((l) => l.code === 'A2');
    expect(capture?.signature).toBe(a2?.signature);
    expect(capture?.p95Ms).toBe(a2?.stats.p95Ms);
    expect(capture?.stops[0]).toEqual({ station: payments.stations.get(a2?.route[0]?.stations[0] ?? '') });
    expect(capture?.dependencies.length).toBeGreaterThan(0);
    expect(capture?.policies.total).toBeGreaterThan(0);
  });

  it('says why a step has no line: no board, no matching line, or no entry point', () => {
    expect(rows.find((r) => r.stepId === 'reserve-stock')?.status).toBe('no-board');
    const renamed = { ...checkoutFlow, steps: checkoutFlow.steps.map((s) => (s.id === 'capture-payment' ? { ...s, entryPoint: 'CaptureEverything' } : s.id === 'void-authorization' ? { id: s.id, name: s.name, serviceDefinitionId: s.serviceDefinitionId, kind: s.kind } : s)) };
    const other = flowLineRows(renamed, boards, name, typicalPath(renamed).steps);
    expect(other.find((r) => r.stepId === 'capture-payment')?.status).toBe('no-line');
    expect(other.find((r) => r.stepId === 'void-authorization')?.status).toBe('no-entry-point');
  });

  it('summarises how much of the flow lands on known lines', () => {
    expect(flowLinesSummary(rows)).toEqual({ steps: 12, mapped: 4, boards: 1, services: 6, noBoard: 8, unmatched: 0 });
  });
});
