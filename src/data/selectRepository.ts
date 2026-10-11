import { GENERATED_DATASETS, generateTopology, type GeneratedDatasetName } from './mock/generateTopology';
import { createMockTopologyRepository } from './repositories/mockTopologyRepository';
import type { TopologyRepository } from './repositories/TopologyRepository';

/**
 * Picks the data source at startup. `?dataset=scale-250` or `?dataset=inventory-1000` loads a
 * generated fixture (benchmarks, scale checks); anything else uses the hand-written mock inventory.
 */
export function selectRepository(search: string): TopologyRepository {
  const name = new URLSearchParams(search).get('dataset');
  if (name && name in GENERATED_DATASETS) {
    const options = GENERATED_DATASETS[name as GeneratedDatasetName];
    return createMockTopologyRepository(generateTopology(options), `Generated dataset “${name}”`);
  }
  return createMockTopologyRepository();
}
