import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from '../app/routes';
import { RepositoryProvider } from '../data/TopologyDataProvider';
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
  });
}

export function renderApp(path: string, repository: TopologyRepository = createMockTopologyRepository()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <RepositoryProvider repository={repository}>
      <RouterProvider router={router} />
    </RepositoryProvider>,
  );
  return router;
}
