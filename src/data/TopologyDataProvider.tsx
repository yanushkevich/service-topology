import { useContext, useEffect, useState, type ReactNode } from 'react';
import { buildTopologyIndex } from '../domain/topologyIndex';
import { validateTopology } from '../domain/validation';
import type { TopologyRepository } from './repositories/TopologyRepository';
import { RepositoryContext, TopologyContext, type TopologyState } from './topologyContext';

export function RepositoryProvider({ repository, children }: { repository: TopologyRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

/** Loads topology once from the active repository, validates it, and exposes an index. */
export function TopologyDataProvider({ children }: { children: ReactNode }) {
  const repository = useContext(RepositoryContext);
  const [state, setState] = useState<TopologyState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    repository
      .getTopology(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const issues = validateTopology(data);
        if (issues.length > 0) console.warn('Topology validation issues', issues);
        setState({
          status: 'ready',
          index: buildTopologyIndex(data),
          issues,
          sourceLabel: repository.sourceLabel,
          isMock: repository.isMock,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [repository]);

  return <TopologyContext.Provider value={state}>{children}</TopologyContext.Provider>;
}
