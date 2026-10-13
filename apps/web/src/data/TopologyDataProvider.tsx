import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TopologySnapshot } from '../domain/snapshot';
import { buildTopologyIndex } from '../domain/topologyIndex';
import type { TopologyData } from '../domain/types';
import { validateTopology, type ValidationIssue } from '../domain/validation';
import { useSimulationStore } from '../state/simulationStore';
import { useUiStore } from '../state/uiStore';
import type { TopologyRepository } from './repositories/TopologyRepository';
import { useSnapshotRepository } from './snapshots/snapshotContext';
import { RepositoryContext, TopologyContext, TopologyEditingContext, type TopologyEditing, type TopologyState } from './topologyContext';

export function RepositoryProvider({ repository, children }: { repository: TopologyRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; baseline: TopologyData; issues: readonly ValidationIssue[] };

/**
 * Loads topology once from the active repository, starts the simulation from it, and exposes one
 * index for every view: the current (simulated) state, or a snapshot while browsing history.
 */
export function TopologyDataProvider({ children }: { children: ReactNode }) {
  const repository = useContext(RepositoryContext);
  const snapshots = useSnapshotRepository();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const sim = useSimulationStore((s) => s.sim);
  const asOf = useUiStore((s) => s.asOf);
  const [history, setHistory] = useState<{ id: string; snapshot: TopologySnapshot | null } | null>(null);
  // Reloads after an edit (ADR-020): bump the version; waiters settle when that load finishes.
  const [version, setVersion] = useState(0);
  const waiters = useRef<{ resolve: () => void; reject: (error: unknown) => void }[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const settle = (error?: unknown) => {
      const pending = waiters.current;
      waiters.current = [];
      for (const w of pending) {
        if (error === undefined) w.resolve();
        else w.reject(error);
      }
    };
    repository
      .getTopology(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const issues = validateTopology(data);
        if (issues.length > 0) console.warn('Topology validation issues', issues);
        useSimulationStore.getState().initialize(data);
        loaded.current = true;
        setLoad({ status: 'loaded', baseline: data, issues });
        settle();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A failed reload keeps the data on screen; only the first load turns into an error page.
        if (!loaded.current) setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        settle(error);
      });
    return () => controller.abort();
  }, [repository, version]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        waiters.current.push({ resolve, reject });
        setVersion((v) => v + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!asOf) return;
    let cancelled = false;
    snapshots
      .get(asOf)
      .then((snapshot) => {
        if (!cancelled) setHistory({ id: asOf, snapshot });
      })
      .catch(() => {
        if (!cancelled) setHistory({ id: asOf, snapshot: null });
      });
    return () => {
      cancelled = true;
    };
  }, [asOf, snapshots]);

  const baseline = load.status === 'loaded' ? load.baseline : null;
  const historyReady = asOf !== null && history?.id === asOf;
  const snapshot = historyReady ? history.snapshot : null;
  const current = baseline && sim?.baseline === baseline ? sim.data : baseline;
  const data = snapshot ? snapshot.data : current;
  const index = useMemo(() => (data ? buildTopologyIndex(data) : null), [data]);

  let state: TopologyState;
  if (load.status === 'error') state = { status: 'error', message: load.message };
  else if (load.status === 'loading' || !index || (asOf !== null && !historyReady)) state = { status: 'loading' };
  else {
    state = {
      status: 'ready',
      index,
      issues: load.issues,
      sourceLabel: repository.sourceLabel,
      isMock: repository.isMock,
      history:
        asOf === null
          ? null
          : snapshot
            ? { status: 'ready', summary: { id: snapshot.id, label: snapshot.label, takenAt: snapshot.takenAt, source: snapshot.source, isSimulated: snapshot.isSimulated } }
            : { status: 'missing', id: asOf },
    };
  }

  const editing = useMemo<TopologyEditing>(
    () => ({ writer: repository.writer ?? null, baseline, reload, sandbox: repository.sandbox ?? null }),
    [repository, baseline, reload],
  );

  return (
    <TopologyContext.Provider value={state}>
      <TopologyEditingContext.Provider value={editing}>{children}</TopologyEditingContext.Provider>
    </TopologyContext.Provider>
  );
}
