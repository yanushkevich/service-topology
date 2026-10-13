import { useContext } from 'react';
import type { StoredDefinition } from '../../../transit/boardStore';
import { TransitRepositoryContext } from '../../../transit/repository';
import { useRepositoryRead } from '../useTransitBoard';

/**
 * The stored definition of a service's board (ADR-031), re-read when `attempt` changes; null when
 * none is stored (the board then shows the example, or nothing). `kind` is where it lives.
 */
export function useStoredBoard(serviceDefinitionId: string, attempt: number): { stored: StoredDefinition | null; kind: 'backend' | 'sandbox' | null; loading: boolean } {
  const store = useContext(TransitRepositoryContext).boards;
  const read = useRepositoryRead(store ? `stored\u0000${serviceDefinitionId}\u0000${attempt}` : null, (r, signal) => r.boards?.get(serviceDefinitionId, signal) ?? Promise.resolve(null));
  if (!store) return { stored: null, kind: null, loading: false };
  return { stored: read.status === 'ready' ? read.value : null, kind: store.kind, loading: read.status === 'loading' };
}

/** The header's data label: where the board's structure and its statistics come from. */
export function boardSourceLabel(stored: StoredDefinition | null, kind: 'backend' | 'sandbox' | null, isExample: boolean | undefined, fallback: string): string {
  if (!stored) return fallback;
  const where = kind === 'sandbox' ? 'Sandbox board' : 'Saved board';
  return `${where} · ${isExample ? 'example stats' : 'not observed'}`;
}
