import { useMemo } from 'react';
import type { BusinessFlow } from '../../domain/types';
import { indexBoard, type BoardIndex } from '../../transit/board';
import { lineForStep } from '../../transit/flows/flowModel';
import type { TransitBoard, TransitWindow } from '../../transit/types';
import { useRepositoryRead } from '../transit-board/useTransitBoard';

/** The transit boards of a flow's services in the environment, read once for the board (null: no board). */
export function useFlowBoards(flow: BusinessFlow, environmentId: string, window: TransitWindow): (TransitBoard | null)[] | null {
  const services = [...new Set(flow.steps.map((s) => s.serviceDefinitionId))].sort();
  const boards = useRepositoryRead(`${services.join(',')}\u0000${environmentId}\u0000${window}`, (r, signal) => Promise.all(services.map((id) => r.getBoard(id, environmentId, window, signal))));
  return boards.status === 'ready' ? boards.value : null;
}

/** The boards indexed by service, as the 3D drill-down needs them (ADR-026). */
export function useBoardIndexes(boards: readonly (TransitBoard | null)[] | null): Map<string, BoardIndex | null> {
  return useMemo(() => new Map((boards ?? []).flatMap((b) => (b ? [[b.serviceDefinitionId, indexBoard(b)] as const] : []))), [boards]);
}

/**
 * Retries inside each step, read from the service's transit board (the clients of the line that
 * implements the step): used to multiply retries across levels in the findings.
 */
export function useInnerAttempts(flow: BusinessFlow, boards: readonly (TransitBoard | null)[] | null): Map<string, { attempts: number; what: string }> {
  return useMemo(() => {
    const out = new Map<string, { attempts: number; what: string }>();
    for (const board of boards ?? []) {
      if (!board) continue;
      for (const step of flow.steps.filter((s) => s.serviceDefinitionId === board.serviceDefinitionId)) {
        const line = lineForStep(board.lines, step);
        if (!line) continue;
        let best: { attempts: number; what: string } | null = null;
        for (const id of new Set(line.route.flatMap((b) => b.stations))) {
          const station = board.stations.find((s) => s.id === id);
          if (station?.kind !== 'client') continue;
          const retry = board.policies.find((p) => p.clientId === id && p.type === 'retry' && p.state !== 'missing' && p.state !== 'unknown');
          const attempts = Number(retry?.config?.maxAttempts ?? 1);
          if (Number.isFinite(attempts) && attempts > (best?.attempts ?? 1)) best = { attempts, what: `the ${station.name}` };
        }
        if (best) out.set(`${step.serviceDefinitionId}\u0000${step.entryPoint ?? ''}`, best);
      }
    }
    return out;
  }, [boards, flow]);
}
