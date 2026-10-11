import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from '../app/routes';
import { RepositoryProvider } from '../data/TopologyDataProvider';
import { SavedLayoutRepositoryContext } from '../data/savedLayouts/savedLayoutContext';
import { createInMemorySavedLayoutRepository, type SavedLayoutRepository } from '../data/savedLayouts/SavedLayoutRepository';
import { mockSnapshots } from '../data/mock/snapshots';
import { SnapshotRepositoryContext } from '../data/snapshots/snapshotContext';
import { createInMemorySnapshotRepository, type SnapshotRepository } from '../data/snapshots/SnapshotRepository';
import type { TopologyRepository } from '../data/repositories/TopologyRepository';
import { createMockTopologyRepository } from '../data/repositories/mockTopologyRepository';
import { EMPTY_FILTERS } from '../domain/registry';
import { useSimulationStore } from '../state/simulationStore';
import { useUiStore } from '../state/uiStore';
import { createMemoryPreferencesRepository, setPreferencesRepository } from '../state/preferencesStore';

export function resetUiStore() {
  setPreferencesRepository(createMemoryPreferencesRepository());
  useUiStore.setState({
    theme: 'dark',
    activeView: '2d',
    layoutMode: 'topology',
    environmentId: 'production',
    selection: null,
    filters: EMPTY_FILTERS,
    highlightMode: 'direct',
    neighborhood: null,
    asOf: null,
    galaxyScope: [],
    motionPaused: false,
  });
  useSimulationStore.setState({ sim: null, running: false, speed: 'normal' });
}

export function renderApp(
  path: string,
  repository: TopologyRepository = createMockTopologyRepository(),
  savedLayouts: SavedLayoutRepository = createInMemorySavedLayoutRepository(),
  snapshots: SnapshotRepository = createInMemorySnapshotRepository(mockSnapshots()),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <RepositoryProvider repository={repository}>
      <SavedLayoutRepositoryContext.Provider value={savedLayouts}>
        <SnapshotRepositoryContext.Provider value={snapshots}>
          <RouterProvider router={router} />
        </SnapshotRepositoryContext.Provider>
      </SavedLayoutRepositoryContext.Provider>
    </RepositoryProvider>,
  );
  return router;
}
