import type { IconName } from '../shared/ui/Icon';

export interface NavItem {
  path: string;
  /** Full label for accessible names and page titles. */
  label: string;
  /** Short label that fits the 56px navigation rail. */
  shortLabel: string;
  icon: IconName;
}

/** Left navigation order per docs/PRODUCT_SPEC.md §5. Service Map is the primary experience. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/overview', label: 'Overview', shortLabel: 'Overview', icon: 'overview' },
  { path: '/map', label: 'Service Map', shortLabel: 'Map', icon: 'map' },
  { path: '/registry', label: 'Service Registry', shortLabel: 'Registry', icon: 'registry' },
  { path: '/dependencies', label: 'Dependencies', shortLabel: 'Deps', icon: 'dependencies' },
  { path: '/events', label: 'Events', shortLabel: 'Events', icon: 'events' },
  { path: '/simulation', label: 'Simulation', shortLabel: 'Sim', icon: 'simulation' },
  { path: '/infrastructure', label: 'Infrastructure', shortLabel: 'Infra', icon: 'infrastructure' },
  { path: '/settings', label: 'Settings', shortLabel: 'Settings', icon: 'settings' },
];
