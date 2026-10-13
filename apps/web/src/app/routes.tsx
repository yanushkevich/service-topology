import type { RouteObject } from 'react-router';
import { AppShell } from '../layouts/AppShell';
import { RedirectToMap } from '../layouts/RedirectToMap';
import { RouteError } from '../layouts/RouteError';
import { ServiceMapPage } from '../features/service-map/ServiceMapPage';
import { NotFoundPage } from '../features/placeholders/NotFoundPage';
import { RegistryPage } from '../features/service-registry/RegistryPage';
import { SimulationPage } from '../features/simulation/SimulationPage';
import { EventsPage } from '../features/event-catalog/EventsPage';
import { OverviewPage } from '../features/overview/OverviewPage';
import { DependenciesPage } from '../features/dependencies/DependenciesPage';
import { InfrastructurePage } from '../features/infrastructure/InfrastructurePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TransitBoardPage } from '../features/transit-board/TransitBoardPage';
import { FlowsCatalogPage } from '../features/business-flows/FlowsCatalogPage';
import { FlowBoardPage } from '../features/business-flows/FlowBoardPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RedirectToMap /> },
      { path: 'map', element: <ServiceMapPage /> },
      { path: 'overview', element: <OverviewPage /> },
      { path: 'registry', element: <RegistryPage /> },
      { path: 'dependencies', element: <DependenciesPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:eventTypeId', element: <EventsPage /> },
      { path: 'simulation', element: <SimulationPage /> },
      { path: 'infrastructure', element: <InfrastructurePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'services/:serviceId/transit', element: <TransitBoardPage /> },
      { path: 'flows', element: <FlowsCatalogPage /> },
      { path: 'flows/:flowId', element: <FlowBoardPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
