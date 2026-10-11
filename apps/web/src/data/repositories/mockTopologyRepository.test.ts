import { describe, expect, it } from 'vitest';
import { mockTopology } from '../mock/topology';
import { createMockTopologyRepository } from './mockTopologyRepository';

describe('mock topology repository', () => {
  it('identifies itself as mock data', () => {
    expect(createMockTopologyRepository().isMock).toBe(true);
  });

  it('returns a copy that callers cannot use to mutate the fixture', async () => {
    const data = await createMockTopologyRepository().getTopology();
    data.serviceInstances[0]!.health = 'unavailable';
    expect(mockTopology.serviceInstances[0]!.health).not.toBe('unavailable');
  });

  it('labels every metric in the fixture as simulated', () => {
    const withMetrics = [...mockTopology.serviceInstances, ...mockTopology.resources, ...mockTopology.relationships]
      .map((entity) => entity.metrics)
      .filter((m) => m !== undefined);
    expect(withMetrics.length).toBeGreaterThan(0);
    expect(withMetrics.every((m) => m.isSimulated)).toBe(true);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(createMockTopologyRepository().getTopology(controller.signal)).rejects.toThrow();
  });
});
