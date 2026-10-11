import { create } from 'zustand';
import { EMPTY_FILTERS, type EntityFilters } from '../domain/registry';
import type { HighlightMode } from '../domain/traversal';
import type { EntityId, EntityRef } from '../domain/types';

/**
 * Cross-view UI state only (see docs/ARCHITECTURE.md §6): selection by canonical kind + ID,
 * active view, environment, shared filters, theme. Viewport, hover, and animation state stay
 * component-local; topology data lives in TopologyDataProvider, not here.
 */

export type Theme = 'dark' | 'light';

export const SERVICE_MAP_VIEWS = ['2d', '3d'] as const;
export type ServiceMapView = (typeof SERVICE_MAP_VIEWS)[number];

/** Infrastructure is a grouped layout mode of the 2D topology, not a separate renderer (Revision 2 §C). */
export const LAYOUT_MODES = ['topology', 'infrastructure'] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

interface UiState {
  theme: Theme;
  activeView: ServiceMapView;
  layoutMode: LayoutMode;
  /** Canonical environment ID. */
  environmentId: string;
  selection: EntityRef | null;
  filters: EntityFilters;
  /** How dependencies of the selection are emphasized in graph views. */
  highlightMode: HighlightMode;
  /** When set, graph views show only entities within `depth` hops of `centerId`. */
  neighborhood: Neighborhood | null;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setActiveView: (view: ServiceMapView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setEnvironmentId: (environmentId: string) => void;
  select: (ref: EntityRef | null) => void;
  setFilters: (patch: Partial<EntityFilters>) => void;
  resetFilters: () => void;
  setHighlightMode: (mode: HighlightMode) => void;
  setNeighborhood: (neighborhood: Neighborhood | null) => void;
}

export interface Neighborhood {
  centerId: EntityId;
  depth: number;
}

export const NEIGHBORHOOD_DEPTHS = [1, 2, 3] as const;

const THEME_STORAGE_KEY = 'service-topology:theme';

function readInitialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall through.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is a convenience only.
  }
}

export const useUiStore = create<UiState>()((set, get) => ({
  theme: readInitialTheme(),
  activeView: '2d',
  layoutMode: 'topology',
  environmentId: 'production',
  selection: null,
  filters: EMPTY_FILTERS,
  highlightMode: 'direct',
  neighborhood: null,
  setTheme: (theme) => {
    persistTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setActiveView: (activeView) => set({ activeView }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setEnvironmentId: (environmentId) => set({ environmentId }),
  select: (selection) => set({ selection }),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  setHighlightMode: (highlightMode) => set({ highlightMode }),
  setNeighborhood: (neighborhood) => set({ neighborhood }),
}));

/** Toggle membership of a value in a filter list. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
