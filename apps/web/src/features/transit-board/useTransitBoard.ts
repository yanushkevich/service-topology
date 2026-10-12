import { useContext, useEffect, useState } from 'react';
import { TransitRepositoryContext, type TransitRepository } from '../../transit/repository';
import type { TraceDetail, TraceSummary, TransitBoard, TransitWindow } from '../../transit/types';

export type TransitBoardState =
  | { status: 'loading' }
  | { status: 'ready'; board: TransitBoard | null }
  /** The last good board stays on screen under an error banner (spec "States": Error). */
  | { status: 'error'; message: string; last: TransitBoard | null };

/** Loads the board for a service in an environment and window; `attempt` changes to retry. */
export function useTransitBoard(serviceDefinitionId: string, environmentId: string, window: TransitWindow, attempt: number): TransitBoardState {
  const repository = useContext(TransitRepositoryContext);
  const [state, setState] = useState<TransitBoardState & { key: string }>({ status: 'loading', key: '' });
  const key = `${serviceDefinitionId}\u0000${environmentId}\u0000${window}\u0000${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    repository.getBoard(serviceDefinitionId, environmentId, window, controller.signal).then(
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
  }, [repository, serviceDefinitionId, environmentId, window, key]);

  // A request for a different board is loading until it settles; an error keeps the last board.
  if (state.key !== key && state.status !== 'error') return { status: 'loading' };
  return state;
}

export type Loaded<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; message: string };

/** One repository read keyed by `key` (null = nothing to load). */
function useRepositoryRead<T>(key: string | null, read: (repository: TransitRepository, signal: AbortSignal) => Promise<T>): Loaded<T> {
  const repository = useContext(TransitRepositoryContext);
  const [state, setState] = useState<{ key: string | null; loaded: Loaded<T> }>({ key: null, loaded: { status: 'loading' } });
  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    read(repository, controller.signal).then(
      (value) => controller.signal.aborted || setState({ key, loaded: { status: 'ready', value } }),
      (error: unknown) => controller.signal.aborted || setState({ key, loaded: { status: 'error', message: error instanceof Error ? error.message : String(error) } }),
    );
    return () => controller.abort();
    // `read` is recreated every render; `key` identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, key]);
  return state.key === key ? state.loaded : { status: 'loading' };
}

/** Traces of a line in the window, newest first (trace mode only). */
export function useTraceList(serviceDefinitionId: string, lineId: string | null, window: TransitWindow, enabled: boolean): Loaded<TraceSummary[]> {
  return useRepositoryRead(enabled && lineId ? `${serviceDefinitionId}\u0000${lineId}\u0000${window}` : null, (r, signal) => r.getTraces(serviceDefinitionId, lineId ?? '', window, signal));
}

/** One trace with its steps. */
export function useTraceDetail(serviceDefinitionId: string, traceId: string | null): Loaded<TraceDetail | null> {
  return useRepositoryRead(traceId ? `${serviceDefinitionId}\u0000${traceId}` : null, (r, signal) => r.getTrace(serviceDefinitionId, traceId ?? '', signal));
}
