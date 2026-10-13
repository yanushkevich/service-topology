import { GENERATED_DATASETS, generateTopology, type GeneratedDatasetName } from './mock/generateTopology';
import { createMockTopologyRepository } from './repositories/mockTopologyRepository';
import type { TopologyRepository } from './repositories/TopologyRepository';
import { mockSnapshots } from './mock/snapshots';
import { createInMemorySnapshotRepository, type SnapshotRepository } from './snapshots/SnapshotRepository';
import { createLocalSavedLayoutRepository, type SavedLayoutRepository } from './savedLayouts/SavedLayoutRepository';
import { createHttpSavedLayoutRepository, createHttpSnapshotRepository, createHttpTopologyRepository } from './http/httpRepositories';
import { createApiClient } from './http/apiClient';
import { createHttpBoardStore } from './boards/httpBoardStore';
import { createSandbox } from './sandbox/sandbox';
import { createTransitRepository } from './transitRepository';
import { createExampleTransitRepository, type TransitRepository } from '../transit/repository';
import { FLOW_DATASET, generateFlowDataset } from './mock/generateFlowDataset';

export interface Repositories {
  topology: TopologyRepository;
  snapshots: SnapshotRepository;
  layouts: SavedLayoutRepository;
  /** Transit boards: stored definitions (backend or sandbox) over observed data (ADR-031). */
  transit: TransitRepository;
}

/**
 * Picks the data source at startup. `?source=api` (or the build variable VITE_DATA_SOURCE=api)
 * uses the backend HTTP API through `/api/v1`. `?dataset=scale-250` or `?dataset=inventory-1000`
 * loads a generated fixture (benchmarks, scale checks); anything else uses the hand-written mock
 * inventory. Simulation always runs in the browser (ADR-017).
 */
export function selectRepository(search: string, defaultSource: string | undefined = import.meta.env.VITE_DATA_SOURCE): Repositories {
  const params = new URLSearchParams(search);
  if ((params.get('source') ?? defaultSource) === 'api') {
    const api = createApiClient();
    return { topology: createHttpTopologyRepository(api), snapshots: createHttpSnapshotRepository(api), layouts: createHttpSavedLayoutRepository(api), transit: createTransitRepository(createHttpBoardStore(api)) };
  }
  const name = params.get('dataset');
  if (name === FLOW_DATASET) return flowDataset();
  if (name && name in GENERATED_DATASETS) {
    const options = GENERATED_DATASETS[name as GeneratedDatasetName];
    return {
      topology: createMockTopologyRepository(generateTopology(options), `Generated dataset “${name}”`),
      // History fixtures describe the hand-written mock; generated datasets start without history.
      snapshots: createInMemorySnapshotRepository(),
      layouts: createLocalSavedLayoutRepository(),
      transit: createTransitRepository(null),
    };
  }
  // The built-in mock data is editable in a labelled local sandbox (ADR-031).
  const sandbox = createSandbox();
  return { topology: sandbox.topology, snapshots: createInMemorySnapshotRepository(mockSnapshots()), layouts: createLocalSavedLayoutRepository(), transit: createTransitRepository(sandbox.boards) };
}

/** The 3D drill-down benchmark dataset (`?dataset=flow-12x6`): its boards come with it. */
function flowDataset(): Repositories {
  const { topology, boards } = generateFlowDataset();
  return {
    topology: createMockTopologyRepository(topology, `Generated dataset “${FLOW_DATASET}”`),
    snapshots: createInMemorySnapshotRepository(),
    layouts: createLocalSavedLayoutRepository(),
    transit: createExampleTransitRepository(Object.fromEntries(Object.entries(boards).map(([id, board]) => [id, { board: () => board, traces: () => new Map() }]))),
  };
}

