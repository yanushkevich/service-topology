import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RepositoryProvider } from '../data/TopologyDataProvider';
import { selectRepository } from '../data/selectRepository';
import { routes } from './routes';

const router = createBrowserRouter(routes);
// Chosen once at startup; the URL-state sync later rewrites the query string without `dataset`.
const repository = selectRepository(window.location.search);

export function App() {
  return (
    <RepositoryProvider repository={repository}>
      <RouterProvider router={router} />
    </RepositoryProvider>
  );
}
