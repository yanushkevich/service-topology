import { ApiError } from '../data/http/apiClient';
import { mockTopology } from '../data/mock/topology';
import type { TopologyRepository, TopologyWriter, WritableKind } from '../data/repositories/TopologyRepository';
import type { TopologyData } from '../domain/types';
import { validateTopology } from '../domain/validation';
import { applyChange, idTaken } from '../features/editing/entityForms';

/**
 * Test double for the backend's write API (ADR-020): an in-memory topology with a writer that
 * validates the whole result like the server and rejects with the same ApiError shapes (422 issues,
 * 409 duplicate ID, 404, 412 when `stale` is set). The app itself never edits mock data.
 */
export function createWritableRepository(initial: TopologyData = mockTopology) {
  let data = structuredClone(initial);
  const calls: { op: 'create' | 'update' | 'delete'; kind: WritableKind; id: string; entity?: unknown }[] = [];
  const state = { stale: false };
  const commit = (kind: WritableKind, next: TopologyData) => {
    const issues = validateTopology(next);
    if (issues.length > 0) throw new ApiError(422, 'Validation failed', 'req-test', issues.map((i) => i.code), `${issues.length} validation issue(s).`, issues);
    data = next;
    void kind;
  };
  const guard = () => {
    if (state.stale) throw new ApiError(412, 'Precondition failed', 'req-test', [], 'The topology changed since it was read. Reload it and try again.');
  };
  const writer: TopologyWriter = {
    async create(kind, entity) {
      guard();
      calls.push({ op: 'create', kind, id: entity.id, entity });
      if (idTaken(data, entity.id)) throw new ApiError(409, 'Conflict', 'req-test', [], 'An item with this ID already exists.');
      commit(kind, applyChange(data, kind, { op: 'create', entity }));
      return entity;
    },
    async update(kind, entity) {
      guard();
      calls.push({ op: 'update', kind, id: entity.id, entity });
      commit(kind, applyChange(data, kind, { op: 'update', entity }));
      return entity;
    },
    async remove(kind, id) {
      guard();
      calls.push({ op: 'delete', kind, id });
      commit(kind, applyChange(data, kind, { op: 'delete', id }));
    },
  };
  const repository: TopologyRepository = {
    sourceLabel: 'Backend API · mock inventory',
    isMock: true,
    writer,
    async getTopology(signal) {
      signal?.throwIfAborted();
      return structuredClone(data);
    },
  };
  return { repository, calls, state, current: () => data };
}
