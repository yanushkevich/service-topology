import { describe, expect, it } from 'vitest';
import { checkoutFlow } from '../../../data/mock/businessFlows';
import { mockTopology } from '../../../data/mock/topology';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { indexBoard } from '../../../transit/board';
import { computeSwimlanes } from '../../../transit/flows/swimlane';
import { paymentServiceBoard } from '../../../transit/mock/paymentServiceBoard';
import { BOARD_DROP, CAPTION_GUTTER, MIN_BAND, PAD_DEPTH, PAD_WIDTH, buildDrilldown, scopeBounds } from './drilldownModel';

const topology = buildTopologyIndex(mockTopology);
const serviceName = (id: string) => topology.definitions.get(id)?.name ?? id;
const layout = computeSwimlanes(checkoutFlow, serviceName);
const payments = indexBoard(paymentServiceBoard('production'));
const model = buildDrilldown({ flow: checkoutFlow, layout, boards: new Map([['payment-service', payments]]), serviceName });
const board = model.boards.find((b) => b.serviceDefinitionId === 'payment-service');
if (!board) throw new Error('expected the Payment Service plane');

describe('3D drill-down scene model (ADR-026, Milestone 13.1)', () => {
  it('shows the lines the flow enters, and keeps the others for "Show all lines"', () => {
    const flowLines = board.lines.filter((l) => l.inFlow).map((l) => l.code).sort();
    // Checkout enters Authorize (A1), Capture (A2), and Void (A4) on Payment Service, and its settlement webhook (W1).
    expect(flowLines).toEqual(['A1', 'A2', 'A4', 'W1']);
    expect(board.lines).toHaveLength(payments.lines.length);
    // Stations on those lines are marked; the others are not.
    const capture = payments.lines.find((l) => l.code === 'A2');
    for (const id of capture?.route.flatMap((b) => b.stations) ?? []) expect(board.stations.find((s) => s.id === id)?.inFlow, id).toBe(true);
    expect(board.stations.some((s) => !s.inFlow)).toBe(true);
    expect(board.policies.length).toBeGreaterThan(0);
  });

  it('fits the plane to the flow lines, inside the whole board', () => {
    expect(board.kind).toBe('board');
    expect(board.width).toBeLessThanOrEqual(board.full.width);
    expect(board.depth).toBeLessThanOrEqual(board.full.depth);
    const inside = (p: readonly number[]) => Math.abs((p[0] ?? 0) - board.center[0]) <= board.width / 2 + 1 && Math.abs((p[2] ?? 0) - board.center[2]) <= board.depth / 2 + 1;
    for (const line of board.lines.filter((l) => l.inFlow)) for (const branch of line.branches) for (const p of branch) expect(inside(p), line.code).toBe(true);
  });

  it('makes services without a board compact pads, with stubs from their steps', () => {
    const inventory = model.boards.find((b) => b.serviceDefinitionId === 'inventory-service');
    expect(inventory).toMatchObject({ kind: 'pad', width: PAD_WIDTH, depth: PAD_DEPTH, stations: [], lines: [] });
    const stub = model.shafts.find((s) => s.stepId === 'reserve-stock');
    expect(stub).toMatchObject({ lineId: null, serviceDefinitionId: 'inventory-service' });
    expect(stub?.to[1]).toBe(-model.drop);
    expect(Math.abs((stub?.to[2] ?? 0) - (inventory?.center[2] ?? NaN))).toBeLessThan(1);
  });

  it('drops a shaft from each mapped step to its line’s entry station, under the steps', () => {
    const capture = model.shafts.find((s) => s.stepId === 'capture-payment');
    expect(capture?.lineId).toBe('A2');
    expect(board.stations.some((s) => s.kind === 'gate' && s.position[0] === capture?.to[0] && s.position[2] === capture?.to[2])).toBe(true);
    // Under-step placement: the mapped steps' mean x equals their entry stations' mean x.
    const mapped = model.shafts.filter((s) => s.serviceDefinitionId === 'payment-service' && s.lineId !== null);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(mapped.map((s) => s.to[0]))).toBeCloseTo(avg(mapped.map((s) => s.from[0])), 0);
    expect(model.shafts.map((s) => s.stepId).sort()).toEqual(model.steps.map((s) => s.id).sort());
  });

  it('keeps each lane over its plane, at least MIN_BAND deep, with a caption gutter on the left', () => {
    for (const lane of model.lanes) {
      const plane = model.boards.find((b) => b.serviceDefinitionId === lane.serviceDefinitionId);
      expect((lane.z0 + lane.z1) / 2).toBeCloseTo(plane?.center[2] ?? NaN, 0);
      expect(lane.z1 - lane.z0).toBeGreaterThanOrEqual(MIN_BAND);
    }
    expect(model.flowPlane.x0).toBe(-layout.width / 2 - CAPTION_GUTTER);
    expect(Math.min(...model.steps.map((s) => s.position[0]))).toBeGreaterThan(model.flowPlane.x0 + CAPTION_GUTTER);
    for (const step of model.steps) {
      const lane = model.lanes.find((l) => l.serviceDefinitionId === step.serviceDefinitionId);
      expect(step.position[2]).toBeGreaterThanOrEqual(lane?.z0 ?? Infinity);
      expect(step.position[2]).toBeLessThanOrEqual(lane?.z1 ?? -Infinity);
    }
  });

  it('hangs every plane at the same drop, and is deterministic', () => {
    expect(model.drop).toBeGreaterThanOrEqual(BOARD_DROP);
    expect(model.boards.every((b) => b.center[1] === -model.drop)).toBe(true);
    expect(buildDrilldown({ flow: checkoutFlow, layout, boards: new Map([['payment-service', payments]]), serviceName })).toEqual(model);
  });

  it('scopes the camera to a plane, or its whole board with all lines, or the flow', () => {
    const fitted = scopeBounds(model, 'payment-service');
    const all = scopeBounds(model, 'payment-service', true);
    expect(fitted.min[1]).toBe(-model.drop);
    expect(fitted.max[0] - fitted.min[0]).toBeCloseTo(board.width);
    expect(all.max[0] - all.min[0]).toBeCloseTo(board.full.width);
    expect(scopeBounds(model, null)).toEqual(model.bounds);
    expect(scopeBounds(model, 'ghost')).toEqual(model.bounds);
  });
});
