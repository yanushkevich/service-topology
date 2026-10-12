import { useContext, useEffect, useState } from 'react';
import { TransitRepositoryContext } from '../../transit/repository';
import type { TransitBoard } from '../../transit/types';

export type TransitBoardState =
  | { status: 'loading' }
  | { status: 'ready'; board: TransitBoard | null }
  /** The last good board stays on screen under an error banner (spec "States": Error). */
  | { status: 'error'; message: string; last: TransitBoard | null };

/** Loads the board for a service in an environment; `attempt` changes to retry. */
export function useTransitBoard(serviceDefinitionId: string, environmentId: string, attempt: number): TransitBoardState {
  const repository = useContext(TransitRepositoryContext);
  const [state, setState] = useState<TransitBoardState & { key: string }>({ status: 'loading', key: '' });
  const key = `${serviceDefinitionId}\u0000${environmentId}\u0000${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    repository.getBoard(serviceDefinitionId, environmentId, controller.signal).then(
      (board) => {
        if (!controller.signal.aborted) setState({ status: 'ready', board, key });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          last: previous.status === 'ready' ? previous.board : previous.status === 'error' ? previous.last : null,
          key,
        }));
      },
    );
    return () => controller.abort();
  }, [repository, serviceDefinitionId, environmentId, key]);

  // A request for a different service or environment is loading until it settles; an error keeps the last board.
  if (state.key !== key && state.status !== 'error') return { status: 'loading' };
  return state;
}
