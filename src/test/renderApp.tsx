import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from '../app/routes';
import { RepositoryProvider } from '../data/TopologyDataProvider';
import { SavedLayoutRepositoryContext } from '../data/savedLayouts/savedLayoutContext';
import { createInMemorySavedLayoutRepository, type SavedLayoutRepository } from '../data/savedLayouts/SavedLayoutRepository';
import type { TopologyRepository } from '../data/repositories/TopologyRepository';
import { createMockTopologyRepository } from '../data/repositories/mockTopologyRepository';
import { EMPTY_FILTERS } from '../domain/registry';
import { useUiStore } from '../state/uiStore';

export function resetUiStore() {
  useUiStore.setState({
    theme: 'dark',
    activeView: '2d',
    layoutMode: 'topology',
    environmentId: 'production',
    selection: null,
    filters: EMPTY_FILTERS,
    highlightMode: 'direct',
    neighborhood: null,
  });
}

export function renderApp(
  path: string,
  repository: TopologyRepository = createMockTopologyRepository(),
  savedLayouts: SavedLayoutRepository = createInMemorySavedLayoutRepository(),
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <RepositoryProvider repository={repository}>
      <SavedLayoutRepositoryContext.Provider value={savedLayouts}>
        <RouterProvider router={router} />
      </SavedLayoutRepositoryContext.Provider>
    </RepositoryProvider>,
  );
  return router;
}
