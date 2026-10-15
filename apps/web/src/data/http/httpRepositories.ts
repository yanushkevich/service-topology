import type { TopologyData } from '../../domain/types';
import { parseSnapshot, type SnapshotSummary, type TopologySnapshot } from '../../domain/snapshot';
import type { TopologyRepository, TopologyWriter, WritableKind } from '../repositories/TopologyRepository';
import { countsOf, type BundleImporter, type ModuleCounts } from '../bundle/bundle';
import type { SnapshotRepository } from '../snapshots/SnapshotRepository';
import { parseSavedLayout, type SavedLayout } from '../savedLayouts/savedLayout';
import type { SavedLayoutRepository } from '../savedLayouts/SavedLayoutRepository';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import { createHttpSourceIntegration } from './httpIntegration';
import type { ObservationMeta } from '../integrations/sourceIntegration';

/**
 * HTTP implementations of the frontend repositories (Milestone B6). They talk to the Go backend
 * through docs/api/openapi.json and validate what they receive at the boundary, so the UI behaves
 * exactly as with the in-memory repositories.
 */

interface Meta {
  topology?: { sourceType?: string; isMock?: boolean } | null;
  observations?: ObservationMeta | null;
}

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The data-source label and mock flag from GET /meta. Mock unless the topology is observed; a
 * topology source's observations (ADR-034) are named with their time, and an example tenant is
 * never called observed.
 */
export function describeSource(meta: Meta): { sourceLabel: string; isMock: boolean } {
  const source = meta.topology?.sourceType || 'unknown source';
  const parts = [`Backend API · ${source === 'fixture' ? 'mock inventory' : source}`];
  const o = meta.observations;
  if (o?.isExample) parts.push(`example Dynatrace tenant (${clockTime(o.observedAt)})`);
  else if (o?.stale) parts.push(`Dynatrace observations out of date (last ${clockTime(o.observedAt)})`);
  else if (o) parts.push(`observed by Dynatrace at ${clockTime(o.observedAt)}`);
  return { sourceLabel: parts.join(' · '), isMock: meta.topology?.isMock !== false };
}

/**
 * Topology from GET /topology. The data-source label comes from GET /meta: still mock unless
 * observed. Writes (ADR-020) send the revision of the last read or write as If-Match, so an edit
 * based on stale data is refused (412) instead of overwriting someone else's change.
 */
export function createHttpTopologyRepository(api: ApiClient = createApiClient()): TopologyRepository {
  let sourceLabel = 'Backend API';
  let isMock = true;
  let refreshMs: number | null = null;
  let revision: string | null = null;
  const path = (kind: WritableKind, id?: string) => `/entities/${kind}${id === undefined ? '' : `/${encodeURIComponent(id)}`}`;
  const writer: TopologyWriter = {
    async create(kind, entity) {
      const res = await api.sendTagged<typeof entity>('POST', path(kind), entity, revision);
      revision = res.etag ?? revision;
      return res.data ?? entity;
    },
    async update(kind, entity) {
      const res = await api.sendTagged<typeof entity>('PUT', path(kind, entity.id), entity, revision);
      revision = res.etag ?? revision;
      return res.data ?? entity;
    },
    async remove(kind, id) {
      const res = await api.sendTagged('DELETE', path(kind, id), undefined, revision);
      revision = res.etag ?? revision;
    },
  };
  const importer: BundleImporter = {
    async importBundle(bundle) {
      const res = await api.sendTagged<{ documents: Partial<ModuleCounts>; boards: number }>('POST', '/imports/bundle', bundle, revision);
      revision = res.etag ?? revision;
      return { counts: { ...countsOf({}), ...res.data?.documents, transitBoards: res.data?.boards ?? 0 } };
    },
  };
  return {
    writer,
    importer,
    integration: createHttpSourceIntegration(api),
    get sourceLabel() {
      return sourceLabel;
    },
    get isMock() {
      return isMock;
    },
    get refreshMs() {
      return refreshMs;
    },
    async getTopology(signal?: AbortSignal): Promise<TopologyData> {
      const [meta, tagged] = await Promise.all([api.get<Meta>('/meta', signal), api.getTagged<TopologyData>('/topology', signal)]);
      const data = tagged.data;
      revision = tagged.etag;
      ({ sourceLabel, isMock } = describeSource(meta));
      refreshMs = meta.observations ? meta.observations.refreshIntervalSeconds * 1000 : null;
      return data;
    },
  };
}

export function createHttpSnapshotRepository(api: ApiClient = createApiClient()): SnapshotRepository {
  return {
    async list(): Promise<SnapshotSummary[]> {
      return (await api.get<{ items: SnapshotSummary[] }>('/topology/snapshots')).items;
    },
    async get(id: string): Promise<TopologySnapshot | null> {
      try {
        // Validate at the boundary: an invalid snapshot is treated as missing, like local storage.
        return parseSnapshot(await api.get<unknown>(`/topology/snapshots/${encodeURIComponent(id)}`));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async save(snapshot: TopologySnapshot): Promise<void> {
      await api.send('POST', '/topology/snapshots', snapshot);
    },
  };
}

export function createHttpSavedLayoutRepository(api: ApiClient = createApiClient()): SavedLayoutRepository {
  return {
    async list(): Promise<SavedLayout[]> {
      const { items } = await api.get<{ items: unknown[] }>('/layouts');
      return items.map(parseSavedLayout).filter((l): l is SavedLayout => l !== null);
    },
    /** Insert or replace by ID: PUT, falling back to POST for a new layout. */
    async save(layout: SavedLayout): Promise<void> {
      try {
        await api.send('PUT', `/layouts/${encodeURIComponent(layout.id)}`, layout);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        await api.send('POST', '/layouts', layout);
      }
    },
    async remove(id: string): Promise<void> {
      try {
        await api.send('DELETE', `/layouts/${encodeURIComponent(id)}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error; // already gone
      }
    },
  };
}
