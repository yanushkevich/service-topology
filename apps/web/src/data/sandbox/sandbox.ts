import { buildTopologyIndex } from '../../domain/topologyIndex';
import { applyChange, idTaken } from '../../domain/topologyChanges';
import type { TopologyData } from '../../domain/types';
import { validateTopology } from '../../domain/validation';
import type { BoardStore, StoredDefinition } from '../../transit/boardStore';
import { validateBoardDefinition, type BoardDefinition } from '../../transit/definition';
import { ApiError } from '../http/apiClient';
import { mockTopology } from '../mock/topology';
import type { TopologyRepository, TopologyWriter } from '../repositories/TopologyRepository';
import { createSandboxStorage, fingerprint, type SandboxStorage } from './storage';

/**
 * The local sandbox (ADR-031): the built-in mock data made editable in the browser. Entities,
 * business flows, and transit board definitions are written here with the server's rules (whole-
 * topology validation, board validation) and its error shapes, and saved in browser storage. It is
 * always labelled as the local sandbox; nothing reaches the backend.
 */

const KEY = 'service-topology.sandbox.v1';

interface Saved {
  /** Fingerprint of the built-in data the changes apply to. */
  base: string;
  topology: TopologyData;
  boards: Record<string, StoredDefinition>;
}

export interface Sandbox {
  topology: TopologyRepository;
  boards: BoardStore;
}

/** What the UI shows and does about the sandbox (Settings, labels). */
export interface SandboxControls {
  /** False when browser storage is unavailable: changes last until the page closes. */
  readonly persistent: boolean;
  /** Set when saved changes were dropped because the built-in data changed. */
  readonly notice: string | null;
  /** Drops every change and restores the built-in data. */
  reset(): void;
}

export function createSandbox(base: TopologyData = mockTopology, storage: SandboxStorage = createSandboxStorage()): Sandbox {
  const baseKey = fingerprint(base);
  const saved = storage.read<Saved>(KEY);
  let notice: string | null = null;
  let state: Saved;
  if (saved && saved.base === baseKey && validateTopology(saved.topology).length === 0) {
    state = saved;
  } else {
    if (saved) notice = 'The built-in data changed, so earlier sandbox changes were cleared.';
    state = { base: baseKey, topology: structuredClone(base), boards: {} };
  }
  const save = () => storage.write(KEY, state);

  const issuesError = (issues: { code: string; entityId?: string; path?: string; message: string }[]) =>
    new ApiError(422, 'Validation failed', undefined, [...new Set(issues.map((i) => i.code))], `${issues.length} validation issue(s).`, issues);
  const commit = (next: TopologyData) => {
    const issues = validateTopology(next).filter((i) => i.severity === 'error');
    if (issues.length) throw issuesError(issues.map((i) => ({ code: i.code, entityId: i.entityId, message: i.message })));
    state = { ...state, topology: next };
    save();
  };

  const writer: TopologyWriter = {
    async create(kind, entity) {
      if (idTaken(state.topology, entity.id)) throw new ApiError(409, 'Conflict', undefined, [], 'An item with this ID already exists.');
      commit(applyChange(state.topology, kind, { op: 'create', entity }));
      return structuredClone(entity);
    },
    async update(kind, entity) {
      if (!idTaken(state.topology, entity.id)) throw new ApiError(404, 'Not found', undefined, [], `No ${kind} with ID “${entity.id}”.`);
      commit(applyChange(state.topology, kind, { op: 'update', entity }));
      return structuredClone(entity);
    },
    async remove(kind, id) {
      if (!idTaken(state.topology, id)) throw new ApiError(404, 'Not found', undefined, [], `No ${kind} with ID “${id}”.`);
      commit(applyChange(state.topology, kind, { op: 'delete', id }));
    },
  };

  const controls: SandboxControls = {
    get persistent() {
      return storage.persistent;
    },
    get notice() {
      return notice;
    },
    reset() {
      storage.remove(KEY);
      state = { base: baseKey, topology: structuredClone(base), boards: {} };
      notice = null;
    },
  };

  const topology: TopologyRepository = {
    sourceLabel: 'Mock inventory · local sandbox',
    isMock: true,
    writer,
    sandbox: controls,
    async getTopology(signal) {
      signal?.throwIfAborted();
      return structuredClone(state.topology);
    },
  };

  const checkBoard = (definition: BoardDefinition) => {
    const issues = validateBoardDefinition(definition, buildTopologyIndex(state.topology));
    if (issues.length) throw issuesError(issues.map((i) => ({ code: i.code, entityId: definition.serviceDefinitionId, path: i.path, message: i.message })));
  };
  const store = (definition: BoardDefinition, revision: string): StoredDefinition => {
    const stored = { definition: structuredClone(definition), revision };
    state = { ...state, boards: { ...state.boards, [definition.serviceDefinitionId]: stored } };
    save();
    return structuredClone(stored);
  };
  const boards: BoardStore = {
    kind: 'sandbox',
    async get(id, signal) {
      signal?.throwIfAborted();
      const found = state.boards[id];
      return found ? structuredClone(found) : null;
    },
    async create(definition) {
      if (state.boards[definition.serviceDefinitionId]) throw new ApiError(409, 'Conflict', undefined, [], `A transit board for “${definition.serviceDefinitionId}” exists.`);
      checkBoard(definition);
      return store(definition, '1');
    },
    async replace(definition, revision) {
      const current = state.boards[definition.serviceDefinitionId];
      if (!current) throw new ApiError(404, 'Not found', undefined, [], `No transit board is stored for “${definition.serviceDefinitionId}”.`);
      if (revision !== null && revision !== current.revision) throw new ApiError(412, 'Precondition failed', undefined, [], 'The board changed since it was read. Reload it and try again.');
      checkBoard(definition);
      return store(definition, String(Number(current.revision) + 1));
    },
    async remove(id, revision) {
      const current = state.boards[id];
      if (!current) throw new ApiError(404, 'Not found', undefined, [], `No transit board is stored for “${id}”.`);
      if (revision !== null && revision !== current.revision) throw new ApiError(412, 'Precondition failed', undefined, [], 'The board changed since it was read. Reload it and try again.');
      const { [id]: _removed, ...rest } = state.boards;
      void _removed;
      state = { ...state, boards: rest };
      save();
    },
  };

  return { topology, boards };
}
