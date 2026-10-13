import type { BoardDefinition } from './definition';

/**
 * Where authored board definitions live (ADR-031): the backend (/transit-boards) or the local
 * sandbox. Writes reject like the API: ApiError 409 (exists), 412 (stale revision), 422 (issues
 * with field paths), 404 (missing).
 */
export interface StoredDefinition {
  definition: BoardDefinition;
  /** Pass it back to guard the next write. */
  revision: string;
}

export interface BoardStore {
  /** 'backend' or 'sandbox': shown with the editor so users know where a save goes. */
  readonly kind: 'backend' | 'sandbox';
  get(serviceDefinitionId: string, signal?: AbortSignal): Promise<StoredDefinition | null>;
  create(definition: BoardDefinition): Promise<StoredDefinition>;
  replace(definition: BoardDefinition, revision: string | null): Promise<StoredDefinition>;
  remove(serviceDefinitionId: string, revision: string | null): Promise<void>;
}
