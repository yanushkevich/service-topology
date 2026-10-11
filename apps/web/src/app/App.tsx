import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RepositoryProvider } from '../data/TopologyDataProvider';
import { selectRepository } from '../data/selectRepository';
import { SnapshotRepositoryContext } from '../data/snapshots/snapshotContext';
import { routes } from './routes';

const router = createBrowserRouter(routes);
// Chosen once at startup; the URL-state sync later rewrites the query string without `dataset`.
const repositories = selectRepository(window.location.search);

export function App() {
  return (
    <RepositoryProvider repository={repositories.topology}>
      <SnapshotRepositoryContext.Provider value={repositories.snapshots}>
        <RouterProvider router={router} />
      </SnapshotRepositoryContext.Provider>
    </RepositoryProvider>
  );
}
