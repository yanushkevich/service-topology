import { describe, expect, it } from 'vitest';
import { checkoutFlow } from '../../../data/mock/businessFlows';
import { mockTopology } from '../../../data/mock/topology';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { indexBoard } from '../../../transit/board';
import { computeSwimlanes } from '../../../transit/flows/swimlane';
import { paymentServiceBoard } from '../../../transit/mock/paymentServiceBoard';
import { BOARD_DROP, BOARD_GAP, BOARD_WIDTH, EMPTY_BOARD_DEPTH, buildDrilldown, scopeBounds } from './drilldownModel';

const topology = buildTopologyIndex(mockTopology);
const serviceName = (id: string) => topology.definitions.get(id)?.name ?? id;
const layout = computeSwimlanes(checkoutFlow, serviceName);
const payments = indexBoard(paymentServiceBoard('production'));
const model = buildDrilldown({ flow: checkoutFlow, layout, boards: new Map([['payment-service', payments]]), serviceName });

describe('3D drill-down scene model (ADR-026)', () => {
  it('hangs one plane per service lane below the flow plane, in lane order, without overlap', () => {
    const lanes = layout.lanes.filter((l) => l.id !== '__outcomes__').map((l) => l.id);
    expect(model.boards.map((b) => b.serviceDefinitionId)).toEqual(lanes);
    expect(model.boards.every((b) => b.center[1] === -BOARD_DROP && b.width === BOARD_WIDTH)).toBe(true);
    for (let i = 1; i < model.boards.length; i++) {
      const [a, b] = [model.boards[i - 1], model.boards[i]];
      if (!a || !b) continue;
      expect(b.center[2] - b.depth / 2 - (a.center[2] + a.depth / 2)).toBeCloseTo(BOARD_GAP);
    }
  });

  it('draws a service without a board as an empty plane, and the example board with its stations and lines', () => {
    const inventory = model.boards.find((b) => b.serviceDefinitionId === 'inventory-service');
    expect(inventory).toMatchObject({ hasBoard: false, depth: EMPTY_BOARD_DEPTH, stations: [], lines: [] });
    const board = model.boards.find((b) => b.serviceDefinitionId === 'payment-service');
    expect(board?.hasBoard).toBe(true);
    expect(board?.stations).toHaveLength(payments.board.stations.length);
    expect(board?.lines.map((l) => l.lineId)).toEqual(payments.lines.map((l) => l.id));
    // Every point of the board lies on its plane.
    const half = (board?.width ?? 0) / 2 + 1;
    for (const s of board?.stations ?? []) {
      expect(s.position[1]).toBe(-BOARD_DROP);
      expect(Math.abs(s.position[0] - (board?.center[0] ?? 0))).toBeLessThanOrEqual(half);
      expect(Math.abs(s.position[2] - (board?.center[2] ?? 0))).toBeLessThanOrEqual((board?.depth ?? 0) / 2 + 1);
    }
  });

  it('keeps each lane directly over its service plane', () => {
    for (const lane of model.lanes) {
      const board = model.boards.find((b) => b.serviceDefinitionId === lane.serviceDefinitionId);
      expect((lane.z0 + lane.z1) / 2).toBeCloseTo(board?.center[2] ?? NaN);
    }
    for (const step of model.steps) {
      const lane = model.lanes.find((l) => l.serviceDefinitionId === step.serviceDefinitionId);
      expect(step.position[1]).toBe(0);
      expect(step.position[2]).toBeGreaterThanOrEqual(lane?.z0 ?? Infinity);
      expect(step.position[2]).toBeLessThanOrEqual(lane?.z1 ?? -Infinity);
    }
  });

  it('drops a shaft from each mapped step to the entry station of its line', () => {
    expect(model.steps.find((s) => s.id === 'capture-payment')?.lineId).toBe('A2');
    expect(model.steps.find((s) => s.id === 'reserve-stock')?.lineId).toBeNull(); // no board for Inventory Service
    const capture = model.shafts.find((s) => s.stepId === 'capture-payment');
    const gate = model.boards.find((b) => b.serviceDefinitionId === 'payment-service')?.stations.find((s) => s.kind === 'gate' && s.position[0] === capture?.to[0] && s.position[2] === capture?.to[2]);
    expect(capture?.from).toEqual(model.steps.find((s) => s.id === 'capture-payment')?.position);
    expect(gate).toBeDefined();
    expect(model.shafts.every((s) => s.serviceDefinitionId === 'payment-service')).toBe(true);
  });

  it('is deterministic, and scopes the camera to a service plane', () => {
    expect(buildDrilldown({ flow: checkoutFlow, layout, boards: new Map([['payment-service', payments]]), serviceName })).toEqual(model);
    const scoped = scopeBounds(model, 'payment-service');
    expect(scoped.min[1]).toBe(-BOARD_DROP);
    expect(scoped.max[0] - scoped.min[0]).toBe(BOARD_WIDTH);
    expect(scopeBounds(model, null)).toEqual(model.bounds);
    expect(scopeBounds(model, 'ghost')).toEqual(model.bounds);
  });
});
