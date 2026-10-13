import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RepositoryProvider } from '../data/TopologyDataProvider';
import { TransitRepositoryContext } from '../transit/repository';
import { selectRepository } from '../data/selectRepository';
import { SnapshotRepositoryContext } from '../data/snapshots/snapshotContext';
import { SavedLayoutRepositoryContext } from '../data/savedLayouts/savedLayoutContext';
import { routes } from './routes';

const router = createBrowserRouter(routes);
// Chosen once at startup from `source`/`dataset`, which the URL-state sync keeps in the URL.
const repositories = selectRepository(window.location.search);

export function App() {
  return (
    <RepositoryProvider repository={repositories.topology}>
      <SnapshotRepositoryContext.Provider value={repositories.snapshots}>
        <SavedLayoutRepositoryContext.Provider value={repositories.layouts}>
          <TransitRepositoryContext.Provider value={repositories.transit}>
            <RouterProvider router={router} />
          </TransitRepositoryContext.Provider>
        </SavedLayoutRepositoryContext.Provider>
      </SnapshotRepositoryContext.Provider>
    </RepositoryProvider>
  );
}
