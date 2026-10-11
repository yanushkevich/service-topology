import type { TopologyData } from '../../domain/types';
import { mockTopology } from '../mock/topology';
import type { TopologyRepository } from './TopologyRepository';

/** In-memory repository over a fixture. Returns a deep copy so callers cannot mutate the fixture. */
export function createMockTopologyRepository(
  data: TopologyData = mockTopology,
  sourceLabel = 'Mock inventory',
): TopologyRepository {
  return {
    sourceLabel,
    isMock: true,
    async getTopology(signal) {
      signal?.throwIfAborted();
      return structuredClone(data);
    },
  };
}
