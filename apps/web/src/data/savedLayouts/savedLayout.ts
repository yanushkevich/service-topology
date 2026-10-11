import { ENTITY_GROUPS, type EntityFilters } from '../../domain/registry';
import { HEALTH_STATUSES, PROVIDERS } from '../../domain/types';
import { LAYOUT_MODES, type LayoutMode } from '../../state/uiStore';

/**
 * Persisted layout contract (ARCHITECTURE Revision 2 §5, `SavedLayout`). Plain JSON only: canonical
 * IDs, numbers, and option values. Never React Flow or Three.js objects. JSON Schema:
 * docs/schemas/saved-layout.v1.schema.json.
 */

export const SAVED_LAYOUT_SCHEMA_VERSION = 1;

export interface SavedLayoutPosition {
  x: number;
  y: number;
}

export interface SavedLayout {
  schemaVersion: typeof SAVED_LAYOUT_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  view: {
    environmentId: string;
    layoutMode: LayoutMode;
    filters: EntityFilters;
    /** Collapsed infrastructure groups: resource IDs, or `provider:<id>` for provider groups. */
    collapsedGroupIds: string[];
  };
  /**
   * Node positions keyed by canonical entity ID (or group ID for collapsed groups). In
   * infrastructure mode positions are relative to the containing group; in topology mode, absolute.
   * Saved positions override the automatic layout for those nodes.
   */
  positions: Record<string, SavedLayoutPosition>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const subsetOf = (list: string[], allowed: readonly string[]) => list.every((item) => allowed.includes(item));
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates untrusted JSON (storage, future API). Returns null for anything that does not match v1. */
export function parseSavedLayout(value: unknown): SavedLayout | null {
  if (!isRecord(value) || value.schemaVersion !== SAVED_LAYOUT_SCHEMA_VERSION) return null;
  const { id, name, createdAt, view, positions } = value;
  if (!isString(id) || !id || !isString(name) || !name.trim() || !isString(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    return null;
  }
  if (!isRecord(view) || !isString(view.environmentId) || !(LAYOUT_MODES as readonly unknown[]).includes(view.layoutMode)) {
    return null;
  }
  const filters = view.filters;
  if (
    !isRecord(filters) ||
    !isString(filters.query) ||
    !isStringList(filters.providers) ||
    !subsetOf(filters.providers, PROVIDERS) ||
    !isStringList(filters.health) ||
    !subsetOf(filters.health, HEALTH_STATUSES) ||
    !isStringList(filters.groups) ||
    !subsetOf(filters.groups, ENTITY_GROUPS) ||
    !isStringList(view.collapsedGroupIds)
  ) {
    return null;
  }
  if (!isRecord(positions)) return null;
  const cleanPositions: Record<string, SavedLayoutPosition> = {};
  for (const [key, pos] of Object.entries(positions)) {
    if (!isRecord(pos) || Object.keys(pos).length !== 2 || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) return null;
    cleanPositions[key] = { x: pos.x, y: pos.y };
  }
  return {
    schemaVersion: SAVED_LAYOUT_SCHEMA_VERSION,
    id,
    name: name.trim(),
    createdAt,
    view: {
      environmentId: view.environmentId,
      layoutMode: view.layoutMode as LayoutMode,
      filters: filters as unknown as EntityFilters,
      collapsedGroupIds: [...view.collapsedGroupIds],
    },
    positions: cleanPositions,
  };
}
