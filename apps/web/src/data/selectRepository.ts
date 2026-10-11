import { GENERATED_DATASETS, generateTopology, type GeneratedDatasetName } from './mock/generateTopology';
import { createMockTopologyRepository } from './repositories/mockTopologyRepository';
import type { TopologyRepository } from './repositories/TopologyRepository';
import { mockSnapshots } from './mock/snapshots';
import { createInMemorySnapshotRepository, type SnapshotRepository } from './snapshots/SnapshotRepository';

/**
 * Picks the data source at startup. `?dataset=scale-250` or `?dataset=inventory-1000` loads a
 * generated fixture (benchmarks, scale checks); anything else uses the hand-written mock inventory.
 */
export function selectRepository(search: string): { topology: TopologyRepository; snapshots: SnapshotRepository } {
  const name = new URLSearchParams(search).get('dataset');
  if (name && name in GENERATED_DATASETS) {
    const options = GENERATED_DATASETS[name as GeneratedDatasetName];
    return {
      topology: createMockTopologyRepository(generateTopology(options), `Generated dataset “${name}”`),
      // History fixtures describe the hand-written mock; generated datasets start without history.
      snapshots: createInMemorySnapshotRepository(),
    };
  }
  return { topology: createMockTopologyRepository(), snapshots: createInMemorySnapshotRepository(mockSnapshots()) };
}
