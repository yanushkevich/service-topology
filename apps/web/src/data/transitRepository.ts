import type { BoardStore } from '../transit/boardStore';
import { boardFromDefinition } from '../transit/definition';
import { createExampleTransitRepository, type TransitRepository } from '../transit/repository';

/**
 * The transit repository the app uses (ADR-031): authored board definitions from a store (the
 * backend or the local sandbox) win, with observed data merged by ID; services without a stored
 * definition show the example board where there is one. Observed data is the example data until
 * real sources exist (docs/REAL_DATA_INTEGRATION.md).
 */
export function createTransitRepository(store: BoardStore | null, observed: TransitRepository = createExampleTransitRepository()): TransitRepository {
  if (!store) return observed;
  return {
    ...observed,
    boards: store,
    async getBoard(serviceDefinitionId, environmentId, window, signal) {
      const [stored, seen] = await Promise.all([store.get(serviceDefinitionId, signal), observed.getBoard(serviceDefinitionId, environmentId, window, signal)]);
      return stored ? boardFromDefinition(stored.definition, { environmentId, window, observed: seen }) : seen;
    },
  };
}
