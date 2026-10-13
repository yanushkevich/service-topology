import { describe, expect, it } from 'vitest';
import { buildTopologyIndex } from '../../domain/topologyIndex';
import { validateTopology } from '../../domain/validation';
import { lineForStep } from '../../transit/flows/flowModel';
import { generateFlowDataset } from './generateFlowDataset';

describe('generated flow dataset (3D drill-down benchmark)', () => {
  const { topology, boards } = generateFlowDataset();

  it('is valid topology with one 12-step flow across 6 services', () => {
    expect(validateTopology(topology).filter((i) => i.severity === 'error')).toEqual([]);
    const flow = topology.businessFlows?.[0];
    expect(flow?.steps).toHaveLength(12);
    expect(new Set(flow?.steps.map((s) => s.serviceDefinitionId)).size).toBe(6);
    expect(buildTopologyIndex(topology).businessFlows.size).toBe(1);
  });

  it('gives every service a board, and every step a line on it', () => {
    expect(Object.keys(boards)).toHaveLength(6);
    for (const step of topology.businessFlows?.[0]?.steps ?? []) {
      const board = boards[step.serviceDefinitionId];
      expect(board && lineForStep(board.lines, step), step.id).toBeTruthy();
    }
  });
});
