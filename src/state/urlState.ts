import { ENTITY_GROUPS, EMPTY_FILTERS, type EntityFilters, type EntityGroup } from '../domain/registry';
import { HIGHLIGHT_MODES, type HighlightMode } from '../domain/traversal';
import { ENTITY_KINDS, HEALTH_STATUSES, PROVIDERS, type EntityKind, type EntityRef } from '../domain/types';
import { LAYOUT_MODES, NEIGHBORHOOD_DEPTHS, SERVICE_MAP_VIEWS, type LayoutMode, type Neighborhood, type ServiceMapView } from './uiStore';

/**
 * Versioned, shareable view state (ARCHITECTURE Revision 2 §5, `TopologyUrlState`).
 *
 *   ?v=1&env=production&view=3d&layout=infrastructure&sel=service-instance:order-service.production
 *    &q=pay&provider=aws,gcp&health=degraded&kind=messaging&hl=upstream&nh=ledger-service.production~2
 *    &asof=fixture-0600   (optional; added in Milestone 3, backward compatible with v1)
 *    &scope=aws-acct-commerce-prod&scope=eks-commerce-prod   (3D explore path, repeated; Milestone 4)
 *
 * Defaults are omitted (except `v` and `env`). Decoding is tolerant: unknown or malformed values are
 * dropped and reported, never thrown. Entity IDs are passed through; the UI reports unknown ones.
 * No secrets or free-form data beyond the search text belong here.
 */

export const URL_STATE_VERSION = 1;

export interface TopologyUrlState {
  environmentId: string | undefined;
  activeView: ServiceMapView;
  layoutMode: LayoutMode;
  selection: EntityRef | null;
  filters: EntityFilters;
  highlightMode: HighlightMode;
  neighborhood: Neighborhood | null;
  /** Snapshot ID being browsed (read-only history), or null for current state. */
  asOf: string | null;
  /** 3D explore path (outermost first). */
  galaxyScope: readonly string[];
}

export const DEFAULT_URL_STATE: TopologyUrlState = {
  environmentId: undefined,
  activeView: '2d',
  layoutMode: 'topology',
  selection: null,
  filters: EMPTY_FILTERS,
  highlightMode: 'direct',
  neighborhood: null,
  asOf: null,
  galaxyScope: [],
};

const LIST_SEPARATOR = ',';
const DEPTH_SEPARATOR = '~';

export function encodeUrlState(state: TopologyUrlState): string {
  const params = new URLSearchParams();
  params.set('v', String(URL_STATE_VERSION));
  if (state.environmentId) params.set('env', state.environmentId);
  if (state.activeView !== DEFAULT_URL_STATE.activeView) params.set('view', state.activeView);
  if (state.layoutMode !== DEFAULT_URL_STATE.layoutMode) params.set('layout', state.layoutMode);
  if (state.selection) params.set('sel', `${state.selection.kind}:${state.selection.id}`);
  const query = state.filters.query.trim();
  if (query) params.set('q', query);
  // Sorted so equal filter sets always produce the same URL.
  if (state.filters.providers.length) params.set('provider', [...state.filters.providers].sort().join(LIST_SEPARATOR));
  if (state.filters.health.length) params.set('health', [...state.filters.health].sort().join(LIST_SEPARATOR));
  if (state.filters.groups.length) params.set('kind', [...state.filters.groups].sort().join(LIST_SEPARATOR));
  if (state.highlightMode !== DEFAULT_URL_STATE.highlightMode) params.set('hl', state.highlightMode);
  if (state.neighborhood) params.set('nh', `${state.neighborhood.centerId}${DEPTH_SEPARATOR}${state.neighborhood.depth}`);
  if (state.asOf) params.set('asof', state.asOf);
  for (const id of state.galaxyScope) params.append('scope', id);
  return params.toString();
}

export interface DecodeResult {
  state: TopologyUrlState;
  /** Human-readable notes about ignored parameters. */
  issues: string[];
  /** False when the URL carries no view state at all (no `v` parameter). */
  present: boolean;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function listOf<T extends string>(allowed: readonly T[], value: string | null, name: string, issues: string[]): T[] {
  if (!value) return [];
  const items = value.split(LIST_SEPARATOR).filter(Boolean);
  const valid = items.filter((item): item is T => (allowed as readonly string[]).includes(item));
  if (valid.length !== items.length) issues.push(`Ignored unknown ${name} value(s)`);
  return [...new Set(valid)].sort();
}

export function decodeUrlState(search: string): DecodeResult {
  const params = new URLSearchParams(search);
  const issues: string[] = [];
  const version = params.get('v');
  if (version === null) return { state: DEFAULT_URL_STATE, issues, present: false };
  if (version !== String(URL_STATE_VERSION)) {
    return { state: DEFAULT_URL_STATE, issues: [`Unsupported URL state version "${version}"`], present: false };
  }

  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const raw = params.get(name);
    const value = oneOf(allowed, raw);
    if (raw !== null && value === undefined) issues.push(`Ignored invalid ${name} "${raw}"`);
    return value ?? fallback;
  };

  let selection: EntityRef | null = null;
  const sel = params.get('sel');
  if (sel) {
    const split = sel.indexOf(':');
    const kind = split > 0 ? oneOf<EntityKind>(ENTITY_KINDS, sel.slice(0, split)) : undefined;
    const id = split > 0 ? sel.slice(split + 1) : '';
    if (kind && id) selection = { kind, id };
    else issues.push(`Ignored malformed selection "${sel}"`);
  }

  let neighborhood: Neighborhood | null = null;
  const nh = params.get('nh');
  if (nh) {
    const split = nh.lastIndexOf(DEPTH_SEPARATOR);
    const centerId = split > 0 ? nh.slice(0, split) : nh;
    const depth = split > 0 ? Number(nh.slice(split + 1)) : 1;
    const validDepth = (NEIGHBORHOOD_DEPTHS as readonly number[]).includes(depth);
    if (!validDepth) issues.push(`Ignored invalid neighborhood depth in "${nh}"`);
    if (centerId) neighborhood = { centerId, depth: validDepth ? depth : 1 };
  }

  const env = params.get('env');
  return {
    present: true,
    issues,
    state: {
      environmentId: env || undefined,
      activeView: pick('view', SERVICE_MAP_VIEWS, DEFAULT_URL_STATE.activeView),
      layoutMode: pick('layout', LAYOUT_MODES, DEFAULT_URL_STATE.layoutMode),
      selection,
      filters: {
        query: params.get('q') ?? '',
        providers: listOf(PROVIDERS, params.get('provider'), 'provider', issues),
        health: listOf(HEALTH_STATUSES, params.get('health'), 'health', issues),
        groups: listOf<EntityGroup>(ENTITY_GROUPS, params.get('kind'), 'kind', issues),
      },
      highlightMode: pick('hl', HIGHLIGHT_MODES, DEFAULT_URL_STATE.highlightMode),
      neighborhood,
      asOf: params.get('asof') || null,
      galaxyScope: params.getAll('scope').filter(Boolean),
    },
  };
}
