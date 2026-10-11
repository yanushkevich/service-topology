import type { RouteObject } from 'react-router';
import { AppShell } from '../layouts/AppShell';
import { RedirectToMap } from '../layouts/RedirectToMap';
import { RouteError } from '../layouts/RouteError';
import { ServiceMapPage } from '../features/service-map/ServiceMapPage';
import { PlaceholderPage } from '../features/placeholders/PlaceholderPage';
import { NotFoundPage } from '../features/placeholders/NotFoundPage';
import { RegistryPage } from '../features/service-registry/RegistryPage';
import { EventsPage } from '../features/events/EventsPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <RedirectToMap /> },
      { path: 'map', element: <ServiceMapPage /> },
      {
        path: 'overview',
        element: (
          <PlaceholderPage
            title="Overview"
            description="Platform health summary, recent changes, and entry points into the map and registry."
            milestone="Milestone 5"
          />
        ),
      },
      { path: 'registry', element: <RegistryPage /> },
      {
        path: 'dependencies',
        element: (
          <PlaceholderPage
            title="Dependencies"
            description="Upstream and downstream traversal and impact analysis from a selected entity."
            milestone="Milestone 3"
          />
        ),
      },
      { path: 'events', element: <EventsPage /> },
      {
        path: 'infrastructure',
        element: (
          <PlaceholderPage
            title="Infrastructure"
            description="Containment hierarchy (account → region → cluster → namespace → workload). The grouped view is a layout mode of the Service Map."
            milestone="Milestone 2"
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <PlaceholderPage
            title="Settings"
            description="Display preferences, saved layouts, and data source configuration."
            milestone="Milestone 5"
          />
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
