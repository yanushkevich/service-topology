import type { TopologyData } from '../../domain/types';
import { parseSnapshot, type SnapshotSummary, type TopologySnapshot } from '../../domain/snapshot';
import type { TopologyRepository, TopologyWriter, WritableKind } from '../repositories/TopologyRepository';
import type { SnapshotRepository } from '../snapshots/SnapshotRepository';
import { parseSavedLayout, type SavedLayout } from '../savedLayouts/savedLayout';
import type { SavedLayoutRepository } from '../savedLayouts/SavedLayoutRepository';
import { ApiError, createApiClient, type ApiClient } from './apiClient';

/**
 * HTTP implementations of the frontend repositories (Milestone B6). They talk to the Go backend
 * through docs/api/openapi.json and validate what they receive at the boundary, so the UI behaves
 * exactly as with the in-memory repositories.
 */

interface Meta {
  topology?: { sourceType?: string; isMock?: boolean } | null;
}

/**
 * Topology from GET /topology. The data-source label comes from GET /meta: still mock unless
 * observed. Writes (ADR-020) send the revision of the last read or write as If-Match, so an edit
 * based on stale data is refused (412) instead of overwriting someone else's change.
 */
export function createHttpTopologyRepository(api: ApiClient = createApiClient()): TopologyRepository {
  let sourceLabel = 'Backend API';
  let isMock = true;
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
  return {
    writer,
    get sourceLabel() {
      return sourceLabel;
    },
    get isMock() {
      return isMock;
    },
    async getTopology(signal?: AbortSignal): Promise<TopologyData> {
      const [meta, tagged] = await Promise.all([api.get<Meta>('/meta', signal), api.getTagged<TopologyData>('/topology', signal)]);
      const data = tagged.data;
      revision = tagged.etag;
      const source = meta.topology?.sourceType || 'unknown source';
      isMock = meta.topology?.isMock !== false;
      sourceLabel = `Backend API · ${source === 'fixture' ? 'mock inventory' : source}`;
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
