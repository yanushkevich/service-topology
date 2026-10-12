import { createContext } from 'react';
import { paymentServiceBoard } from './mock/paymentServiceBoard';
import type { TransitBoard } from './types';

/**
 * Source of transit boards (ADR-021). Phase 1 has only the example implementation; an HTTP one
 * follows when `GET /services/{id}/transit` is added to the contract (spec phases 2–3).
 */
export interface TransitRepository {
  /** Shown with the board, e.g. 'Example data'. */
  sourceLabel: string;
  /** The board for a service definition in an environment; null when no entry points are known for it. */
  getBoard(serviceDefinitionId: string, environmentId: string, signal?: AbortSignal): Promise<TransitBoard | null>;
}

/** Example boards from the prototype: Payment Service only; every other service has none yet. */
export function createExampleTransitRepository(boards: Record<string, (environmentId: string) => TransitBoard> = { 'payment-service': paymentServiceBoard }): TransitRepository {
  return {
    sourceLabel: 'Example data',
    async getBoard(serviceDefinitionId, environmentId, signal) {
      signal?.throwIfAborted();
      return boards[serviceDefinitionId]?.(environmentId) ?? null;
    },
  };
}

export const TransitRepositoryContext = createContext<TransitRepository>(createExampleTransitRepository());
