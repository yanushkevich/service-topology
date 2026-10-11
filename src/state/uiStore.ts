import { create } from 'zustand';
import { EMPTY_FILTERS, type EntityFilters } from '../domain/registry';
import { effectiveTheme, usePreferencesStore } from './preferencesStore';
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
  /** When set, all views show this snapshot (read-only) instead of the current state. */
  asOf: string | null;
  /**
   * 3D "Explore inside" path: entity IDs from the overview inward. [] = galaxy overview. Canonical IDs
   * only (serializable, URL-encoded); camera state stays in the renderer.
   */
  galaxyScope: readonly EntityId[];
  /** Global pause for decorative/traffic animation (camera controls stay usable). */
  motionPaused: boolean;
  setTheme: (theme: Theme) => void;
  setActiveView: (view: ServiceMapView) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setEnvironmentId: (environmentId: string) => void;
  select: (ref: EntityRef | null) => void;
  setFilters: (patch: Partial<EntityFilters>) => void;
  resetFilters: () => void;
  setHighlightMode: (mode: HighlightMode) => void;
  setNeighborhood: (neighborhood: Neighborhood | null) => void;
  setAsOf: (snapshotId: string | null) => void;
  enterScope: (entityId: EntityId) => void;
  /** Keep the first `depth` levels (0 = overview). */
  exitScopeTo: (depth: number) => void;
  setMotionPaused: (paused: boolean) => void;
}

export interface Neighborhood {
  centerId: EntityId;
  depth: number;
}

export const NEIGHBORHOOD_DEPTHS = [1, 2, 3] as const;

const initialPreferences = usePreferencesStore.getState().preferences;

export const useUiStore = create<UiState>()((set) => ({
  theme: effectiveTheme(initialPreferences.theme),
  activeView: initialPreferences.defaultView,
  layoutMode: 'topology',
  environmentId: 'production',
  selection: null,
  filters: EMPTY_FILTERS,
  highlightMode: 'direct',
  neighborhood: null,
  asOf: null,
  galaxyScope: [],
  motionPaused: false,
  // Effective theme only; the user's choice (incl. "system") lives in preferences.
  setTheme: (theme) => set({ theme }),
  setActiveView: (activeView) => set({ activeView }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setEnvironmentId: (environmentId) => set({ environmentId }),
  select: (selection) => set({ selection }),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  resetFilters: () => set({ filters: EMPTY_FILTERS }),
  setHighlightMode: (highlightMode) => set({ highlightMode }),
  setNeighborhood: (neighborhood) => set({ neighborhood }),
  setAsOf: (asOf) => set({ asOf }),
  enterScope: (entityId) =>
    set((state) => (state.galaxyScope.at(-1) === entityId ? {} : { galaxyScope: [...state.galaxyScope, entityId] })),
  exitScopeTo: (depth) => set((state) => ({ galaxyScope: state.galaxyScope.slice(0, Math.max(0, depth)) })),
  setMotionPaused: (motionPaused) => set({ motionPaused }),
}));

/** Toggle membership of a value in a filter list. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
