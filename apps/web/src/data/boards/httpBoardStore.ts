import type { BoardDefinition } from '../../transit/definition';
import type { BoardStore } from '../../transit/boardStore';
import { ApiError, type ApiClient } from '../http/apiClient';

const path = (id: string) => `/transit-boards/${encodeURIComponent(id)}`;

/** Board definitions on the backend (GET/POST/PUT/DELETE /transit-boards, ADR-031). */
export function createHttpBoardStore(api: ApiClient): BoardStore {
  return {
    kind: 'backend',
    async get(id, signal) {
      try {
        const { data, etag } = await api.getTagged<BoardDefinition>(path(id), signal);
        return { definition: data, revision: etag ?? '' };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async create(definition) {
      const { data, etag } = await api.sendTagged<BoardDefinition>('POST', '/transit-boards', definition, null);
      return { definition: data ?? definition, revision: etag ?? '' };
    },
    async replace(definition, revision) {
      const { data, etag } = await api.sendTagged<BoardDefinition>('PUT', path(definition.serviceDefinitionId), definition, revision);
      return { definition: data ?? definition, revision: etag ?? '' };
    },
    async remove(id, revision) {
      await api.sendTagged('DELETE', path(id), undefined, revision);
    },
  };
}
