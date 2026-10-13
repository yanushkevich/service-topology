import { businessFlowsIn } from '../../domain/businessFlow';
import { eventFlowsIn } from '../../domain/eventFlow';
import { buildRegistryRows, inEnvironment } from '../../domain/registry';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { EntityId, EntityRef } from '../../domain/types';
import type { BoardDefinition } from '../../transit/definition';
import { flowSearchText } from '../../transit/flows/flowModel';
import { typeLabel } from '../../shared/mappings';

/**
 * Quick search (ADR-033): one list of everything the app can open, and a ranked, grouped match.
 * Pure; the dialog builds the items once per data load and matches on every keystroke.
 */

export type SearchTarget =
  | { kind: 'entity'; ref: EntityRef }
  | { kind: 'flow'; flowId: string }
  | { kind: 'event'; eventTypeId: string }
  | { kind: 'endpoint'; serviceDefinitionId: string; lineId: string }
  | { kind: 'page'; path: string };

export type SearchGroup = SearchTarget['kind'];

export interface SearchItem {
  /** Unique across all items (React key and option ID). */
  key: string;
  label: string;
  detail: string;
  /** Lower-cased text the query must match, beyond the label. */
  terms: string;
  target: SearchTarget;
}

/** Group order and headings in the results. */
export const SEARCH_GROUPS: readonly { group: SearchGroup; heading: string }[] = [
  { group: 'entity', heading: 'Services and resources' },
  { group: 'flow', heading: 'Business flows' },
  { group: 'event', heading: 'Event types' },
  { group: 'endpoint', heading: 'Endpoints' },
  { group: 'page', heading: 'Pages' },
];

/** Everything the quick search can open in the environment. */
export function searchItems(input: { index: TopologyIndex; environmentId: EntityId; boards: readonly BoardDefinition[]; pages: readonly { path: string; label: string }[] }): SearchItem[] {
  const { index, environmentId } = input;
  const serviceName = (id: string) => index.definitions.get(id)?.name ?? id;
  const eventName = (id: string) => index.eventTypes.get(id)?.name ?? id;

  const entities = buildRegistryRows(index)
    .filter((row) => inEnvironment(row, environmentId))
    .map((row): SearchItem => ({ key: `entity:${row.ref.id}`, label: row.name, detail: `${typeLabel(row.type)} · ${row.ref.id}`, terms: row.searchText, target: { kind: 'entity', ref: row.ref } }));

  const flows = businessFlowsIn(index, environmentId).map(({ flow }): SearchItem => ({
    key: `flow:${flow.id}`,
    label: flow.name,
    detail: `Business flow · ${flow.steps.length} steps`,
    terms: flowSearchText(flow, serviceName, eventName),
    target: { kind: 'flow', flowId: flow.id },
  }));

  const events = eventFlowsIn(index, environmentId).map(({ eventType, channelId }): SearchItem => {
    const channel = index.resources.get(channelId)?.name ?? channelId;
    return { key: `event:${eventType.id}`, label: eventType.name, detail: `Event type · ${channel}`, terms: `${eventType.name} ${channel} ${eventType.description ?? ''}`.toLowerCase(), target: { kind: 'event', eventTypeId: eventType.id } };
  });

  const endpoints = input.boards
    .filter((board) => index.definitions.has(board.serviceDefinitionId))
    .flatMap((board) =>
      board.lines.map((line): SearchItem => ({
        key: `endpoint:${board.serviceDefinitionId}:${line.id}`,
        label: `${line.code} ${line.name}`,
        detail: `${serviceName(board.serviceDefinitionId)} · ${line.signature}`,
        terms: `${line.code} ${line.name} ${line.signature} ${serviceName(board.serviceDefinitionId)}`.toLowerCase(),
        target: { kind: 'endpoint', serviceDefinitionId: board.serviceDefinitionId, lineId: line.id },
      })),
    );

  const pages = input.pages.map((page): SearchItem => ({ key: `page:${page.path}`, label: page.label, detail: 'Page', terms: page.label.toLowerCase(), target: { kind: 'page', path: page.path } }));

  return [...entities, ...flows, ...events, ...endpoints, ...pages];
}

export interface SearchResults {
  groups: { group: SearchGroup; heading: string; items: SearchItem[] }[];
  /** Matches beyond the shown ones, per group. */
  more: Partial<Record<SearchGroup, number>>;
}

/**
 * Items matching every word of the query, grouped in SEARCH_GROUPS order and ranked: the label
 * starts with the query, then a word of the label starts with it, then the label contains it, then
 * only the other terms match. An empty query lists the pages.
 */
export function quickSearch(items: readonly SearchItem[], query: string, perGroup = 6): SearchResults {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matched = q ? items.filter((item) => words.every((w) => item.label.toLowerCase().includes(w) || item.terms.includes(w))) : items.filter((item) => item.target.kind === 'page');
  const ranked = [...matched].sort((a, b) => rank(a, q) - rank(b, q) || a.label.localeCompare(b.label));
  const groups: SearchResults['groups'] = [];
  const more: SearchResults['more'] = {};
  for (const { group, heading } of SEARCH_GROUPS) {
    const all = ranked.filter((item) => item.target.kind === group);
    if (all.length === 0) continue;
    const shown = q ? all.slice(0, perGroup) : all;
    groups.push({ group, heading, items: shown });
    if (all.length > shown.length) more[group] = all.length - shown.length;
  }
  return { groups, more };
}

function rank(item: SearchItem, q: string): number {
  const label = item.label.toLowerCase();
  if (!q) return 0;
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s._-]+/).some((word) => word.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  return 3;
}

/** The page parameters of the boards (urlState PAGE_PARAMS), dropped when the search opens another page. */
const PAGE_PARAM_NAMES = ['line', 'mode', 'trace', 't', 'flow', 'strip', 'step', 'tx', 'scene', 'drill'];

/** Where a target opens: a path and the search to use, keeping the shared view state. */
export function locationOf(target: SearchTarget, currentSearch: string, currentPath: string): { pathname: string; search: string } {
  const params = new URLSearchParams(currentSearch);
  for (const name of PAGE_PARAM_NAMES) params.delete(name);
  const at = (pathname: string) => ({ pathname, search: params.size ? `?${params.toString()}` : '' });
  switch (target.kind) {
    case 'entity':
      // Selection is shared state; it opens where it can be seen.
      return at(currentPath === '/map' || currentPath === '/registry' ? currentPath : '/registry');
    case 'flow':
      return at(`/flows/${encodeURIComponent(target.flowId)}`);
    case 'event':
      return at(`/events/${encodeURIComponent(target.eventTypeId)}`);
    case 'endpoint':
      params.set('line', target.lineId);
      return at(`/services/${encodeURIComponent(target.serviceDefinitionId)}/transit`);
    case 'page':
      return at(target.path);
  }
}
