import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { businessFlowsIn, resolveBusinessFlow } from '../../domain/businessFlow';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow, FlowStep } from '../../domain/types';
import { useTopology } from '../../data/topologyContext';
import { DEFAULT_WINDOW, isWindow, windowLabel } from '../../transit/board';
import { computeFlowGeometry, indexFlows, type FlowBoardIndex } from '../../transit/flows/flowLayout';
import { flowFindings, flowSearchText, typicalPath } from '../../transit/flows/flowModel';
import { sampleTransactions, txDivergence, txStepAt } from '../../transit/flows/observed';
import type { TransitWindow } from '../../transit/types';
import { PLAYBACK_SECONDS } from '../../transit/trace';
import { buttonClass, cx, segmentClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { LoadState } from '../../shared/ui/LoadState';
import { useMotionReduced } from '../../state/motion';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { createPlayback, usePlayback } from '../transit-board/playback';
import { useRepositoryRead } from '../transit-board/useTransitBoard';
import { FlowEditActions } from './FlowEditActions';
import { FlowLegend, FlowMap } from './FlowMap';
import { FlowCard, FlowList, FlowStrip, WindowSelect } from './FlowPanels';
import { TxCard, TxStrip, TxTrain } from './FlowReplay';

const NARROW = '(max-width: 760px)';
function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(NARROW);
      query?.addEventListener?.('change', notify);
      return () => query?.removeEventListener?.('change', notify);
    },
    () => Boolean(window.matchMedia?.(NARROW).matches),
  );
}

const panelClass = 'min-w-0 rounded-2xl border border-line bg-surface-1';
type Mode = 'typical' | 'replay';

/**
 * Flow board (ADR-022, docs/BUSINESS_FLOWS.md §7): business flows as a transit network, the
 * selected flow highlighted, with typical mode (stats, budget, findings) and business-transaction
 * replay. Steps drill down to the service's transit board.
 */
export function FlowBoardPage() {
  const { flowId = '' } = useParams();
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  if (topology.status !== 'ready') {
    return (
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Business flow</h1>
        <LoadState state={topology} />
      </Frame>
    );
  }
  const flow = topology.index.businessFlows.get(flowId);
  if (!flow) {
    return (
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Business flow</h1>
        <Note>No business flow with ID “{flowId}” exists in this data. Choose one from the Business flows catalog.</Note>
      </Frame>
    );
  }
  return <Board key={`${flow.id}\u0000${environmentId}`} index={topology.index} flow={flow} environmentId={environmentId} />;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:px-3 max-md:pt-3">{children}</div>;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

function Board({ index, flow, environmentId }: { index: TopologyIndex; flow: BusinessFlow; environmentId: string }) {
  const [params, setParams] = useSearchParams();
  const update = (change: (p: URLSearchParams) => void, replace = false) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace, preventScrollReset: true },
    );
  const windowParam = params.get('window');
  const windowValue: TransitWindow = isWindow(windowParam) ? windowParam : DEFAULT_WINDOW;
  const mode: Mode = params.get('mode') === 'replay' ? 'replay' : 'typical';
  const stepId = params.get('step');
  const txKey = params.get('tx');

  const serviceName = (id: string) => index.definitions.get(id)?.name ?? id;
  const eventName = (id: string) => index.eventTypes.get(id)?.name ?? id;
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const flows = useMemo(() => {
    const deployed = businessFlowsIn(index, environmentId).map((r) => r.flow);
    return deployed.some((f) => f.id === flow.id) ? deployed : [...deployed, flow];
  }, [index, environmentId, flow]);
  const fx: FlowBoardIndex = useMemo(() => indexFlows(flows, (id) => index.definitions.get(id)?.name ?? id), [flows, index]);
  const narrow = useNarrow();
  const reduced = useMotionReduced();
  // Computed once per data load; selection, search, and replay never rebuild it.
  const geometry = useMemo(() => computeFlowGeometry(fx, { flat: narrow }), [fx, narrow]);
  const resolved = useMemo(() => resolveBusinessFlow(index, flow, environmentId), [index, flow, environmentId]);

  const stats = useRepositoryRead(`${flow.id}\u0000${environmentId}\u0000${windowValue}`, (r, signal) => r.getFlowStats(flow, environmentId, windowValue, signal));
  const flowStats = stats.status === 'ready' ? stats.value : null;
  const shares = useMemo(() => new Map(Object.entries(flowStats?.transitions ?? {})), [flowStats]);
  const inner = useInnerAttempts(flow, environmentId, windowValue);
  const findings = useMemo(
    () => flowFindings(flow, { eventName, serviceName, shares, innerAttempts: (step) => inner.get(`${step.serviceDefinitionId}\u0000${step.entryPoint ?? ''}`) ?? null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow, shares, inner],
  );
  const warnings = useMemo(() => new Map(fx.flows.map((f) => [f.id, f.id === flow.id ? findings.filter((x) => x.severity === 'warn').length : 0])), [fx, flow.id, findings]);
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return new Set(fx.flows.filter((f) => !q || flowSearchText(f, serviceName, eventName).includes(q)).map((f) => f.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, query]);
  const [focus, setFocus] = useState<number | null>(null);
  const focusSteps = useMemo(() => new Set(focus !== null && mode === 'typical' ? (findings[focus]?.stepIds ?? []) : []), [focus, findings, mode]);
  const selectedStep: FlowStep | null = (stepId && flow.steps.find((s) => s.id === stepId)) || null;
  const [indexOpen, setIndexOpen] = useState(true);

  // Replay: samples, the chosen (or first) transaction, a local playback clock.
  const txList = useRepositoryRead(mode === 'replay' ? `${flow.id}\u0000${windowValue}` : null, (r, signal) => r.getTransactions(flow, windowValue, signal));
  const samples = useMemo(() => (txList.status === 'ready' ? sampleTransactions(txList.value, flowStats) : []), [txList, flowStats]);
  const chosenKey = mode === 'replay' ? (txKey ?? samples[0]?.tx.key ?? null) : null;
  const txRead = useRepositoryRead(chosenKey ? `${flow.id}\u0000${chosenKey}` : null, (r, signal) => r.getTransaction(flow, chosenKey ?? '', signal));
  const tx = txRead.status === 'ready' ? txRead.value : null;
  const txError = txRead.status === 'error' ? txRead.message : txRead.status === 'ready' && !txRead.value && chosenKey ? `No transaction “${chosenKey}” for ${flow.name}.` : null;
  const typical = useMemo(() => typicalPath(flow, shares).steps, [flow, shares]);
  const divergence = useMemo(() => (tx ? txDivergence(flow, tx, typical) : null), [flow, tx, typical]);
  const [playback] = useState(() => createPlayback());
  const playing = usePlayback(playback, (s) => s.playing);
  const pausedT = usePlayback(playback, (s) => (s.playing ? null : Math.round(s.t)));
  const total = tx ? Math.max(...tx.steps.map((s) => s.displayStartMs + s.displayDurationMs), 1) : 0;

  const startT = useRef(params.get('t'));
  useEffect(() => {
    if (!tx) return;
    const requested = startT.current === null ? 0 : Number(startT.current);
    startT.current = null;
    const t = Number.isFinite(requested) ? Math.max(0, Math.min(requested, Math.max(...tx.steps.map((s) => s.displayStartMs + s.displayDurationMs)))) : 0;
    playback.set({ t, step: t > 0 ? txStepAt(tx.steps, t) : 0, playing: false });
  }, [tx, playback]);

  useEffect(() => {
    if (mode !== 'replay' || !tx || pausedT === null) return;
    const value = pausedT > 0 ? String(pausedT) : null;
    if ((params.get('t') ?? null) !== value) update((p) => (value ? p.set('t', value) : p.delete('t')), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tx, pausedT]);

  // The replay clock: about 6 s per transaction at 1×, every step on screen for a moment; with
  // reduced motion one step every 700 ms.
  useEffect(() => {
    if (!playing || !tx) return;
    const steps = tx.steps;
    const last = steps.length - 1;
    if (reduced) {
      const timer = setInterval(() => {
        const { step } = playback.get();
        if (step >= last) playback.set({ t: total, step: last, playing: false });
        else playback.set({ step: step + 1, t: steps[step + 1]?.displayStartMs ?? total });
      }, 700);
      return () => clearInterval(timer);
    }
    let frame = 0;
    let previous = 0;
    let changed = performance.now();
    const rate = total / (PLAYBACK_SECONDS * 1000);
    const tick = (now: number) => {
      const { t, step, speed } = playback.get();
      const dt = previous ? now - previous : 16;
      previous = now;
      const advanced = Math.min(total, t + dt * rate * speed);
      const next = steps[step + 1];
      if (next && next.displayStartMs <= advanced) {
        if (now - changed >= 420 / speed) {
          changed = now;
          playback.set({ step: step + 1, t: Math.max(t, next.displayStartMs) });
        } else playback.set({ t: Math.min(advanced, next.displayStartMs) });
      } else if (!next && advanced >= total) {
        playback.set({ t: total, playing: false });
        return;
      } else playback.set({ t: advanced });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, tx, reduced, playback, total]);

  const setMode = (next: Mode) =>
    update((p) => {
      if (next === 'replay') p.set('mode', 'replay');
      else p.delete('mode');
      p.delete('t');
    });
  const selectStep = (id: string | null) =>
    update((p) => {
      if (id) p.set('step', id);
      else p.delete('step');
    });
  const pickTx = (key: string) => {
    playback.set({ playing: false, t: 0, step: 0 });
    update((p) => {
      p.set('tx', key);
      p.delete('t');
    });
  };
  const seek = (t: number) => tx && playback.set({ t, step: t <= 0 ? 0 : txStepAt(tx.steps, t), playing: false });
  const jump = (i: number) => {
    const s = tx?.steps[i];
    if (s) playback.set({ step: i, t: s.displayStartMs, playing: false });
  };
  const step = (direction: -1 | 1) => {
    if (!tx) return;
    const { step: at } = playback.get();
    if (direction > 0 && at >= tx.steps.length - 1) playback.set({ t: total, playing: false });
    else jump(Math.max(0, at + direction));
  };
  const togglePlay = () => {
    if (!tx) return;
    const { t, playing: now } = playback.get();
    if (!now && t >= total) playback.set({ t: 0, step: 0, playing: true });
    else playback.set({ playing: !now });
  };
  const switchSample = (direction: -1 | 1) => {
    if (samples.length === 0) return;
    const at = samples.findIndex((s) => s.tx.key === chosenKey);
    const next = samples[(at + direction + samples.length) % samples.length];
    if (next) pickTx(next.tx.key);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && stepId) {
      e.preventDefault();
      selectStep(null);
      return;
    }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') setMode(mode === 'replay' ? 'typical' : 'replay');
    else if (mode !== 'replay') return;
    else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === '[' || e.key === ']') switchSample(e.key === ']' ? 1 : -1);
  };

  return (
    <Frame>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <nav aria-label="Breadcrumb" className="text-[12.5px] text-fg-3">
          {environmentName} / Business flows /
        </nav>
        <h1 className="m-0 text-lg font-semibold">{flow.name}</h1>
        <div role="group" aria-label="View" className="flex gap-0.5 rounded-md border border-line p-0.5">
          <button type="button" aria-pressed={mode === 'typical'} className={segmentClass} onClick={() => setMode('typical')}>
            Typical
          </button>
          <button type="button" aria-pressed={mode === 'replay'} className={segmentClass} onClick={() => setMode('replay')}>
            Transaction replay
          </button>
        </div>
        <span className="flex-1" />
        <WindowSelect
          value={windowValue}
          onChange={(w) =>
            update((p) => {
              if (w === DEFAULT_WINDOW) p.delete('window');
              else p.set('window', w);
              p.delete('tx');
              p.delete('t');
            })
          }
        />
        <span className="tag tag-simulated">
          {flowStats?.isExample === false ? 'Observed' : 'Example data'} · {windowLabel(windowValue)}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[auto_minmax(0,1fr)] min-[1180px]:grid-cols-[260px_minmax(0,1fr)_340px]" onKeyDown={onKeyDown}>
        <nav aria-label="Flows" className={cx(panelClass, 'self-start p-3.5 md:row-span-2 md:row-start-1', indexOpen ? 'md:w-[240px] min-[1180px]:w-auto' : 'md:w-auto')}>
          <button type="button" className={buttonClass('ghost', 'mb-2 max-md:hidden min-[1180px]:hidden')} aria-expanded={indexOpen} onClick={() => setIndexOpen((open) => !open)}>
            <Icon name={indexOpen ? 'chevronDown' : 'chevronRight'} />
            Flows
          </button>
          <div className={cx(!indexOpen && 'md:max-[1179px]:hidden')}>
            <FlowList fx={fx} selectedId={flow.id} query={query} onQuery={setQuery} matches={matches} warnings={warnings} search={params.toString() ? `?${params.toString()}` : ''} />
          </div>
        </nav>
        <section aria-label="Map" className={cx(panelClass, 'relative flex flex-col justify-center overflow-hidden bg-stage p-1.5 pb-12 max-md:pb-1.5 md:col-start-2 md:row-start-1')}>
          <FlowMap
            fx={fx}
            geometry={geometry}
            selectedFlowId={flow.id}
            selectedStation={selectedStep ? fx.stationOf(flow.id, selectedStep.id) : null}
            matches={query.trim() ? matches : null}
            onSelectFlow={() => undefined}
            onSelectStation={(key, flowId) => {
              const ref = fx.stations.get(key)?.refs.find((r) => r.flowId === flowId);
              if (ref && flowId === flow.id && flow.steps.some((s) => s.id === ref.id)) selectStep(ref.id);
            }}
            overlay={mode === 'replay' && tx ? <TxTrain fx={fx} geometry={geometry} tx={tx} playback={playback} reduced={reduced} /> : undefined}
          />
          <FlowLegend className="max-md:hidden" />
        </section>
        <section aria-label="Step strip" className={cx(panelClass, 'px-4 py-3 md:col-start-2 md:row-start-2 min-[1180px]:col-span-2')}>
          {mode === 'replay' && tx ? (
            <TxStrip flow={flow} tx={tx} playback={playback} divergence={divergence} onSeek={seek} onJump={jump} />
          ) : (
            <FlowStrip flow={flow} stats={flowStats} selectedStep={stepId} focusSteps={focusSteps} onSelectStep={(id) => selectStep(id === stepId ? null : id)} serviceName={serviceName} eventName={eventName} />
          )}
        </section>
        <aside
          aria-label="Flow card"
          className={cx(panelClass, 'p-4 md:col-span-2 md:row-start-3 min-[1180px]:col-span-1 min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:max-h-[640px] min-[1180px]:overflow-auto')}
        >
          {mode === 'replay' ? (
            <TxCard
              fx={fx}
              flow={flow}
              samples={samples}
              loading={txList.status === 'loading'}
              tx={tx}
              txError={txError}
              playback={playback}
              divergence={divergence}
              onPick={pickTx}
              onPlay={togglePlay}
              onStep={step}
              onSpeed={(speed) => playback.set({ speed })}
            />
          ) : (
            <FlowCard
              fx={fx}
              flow={flow}
              resolved={resolved}
              stats={flowStats}
              findings={findings}
              focusedFinding={focus}
              onFocusFinding={setFocus}
              selectedStep={selectedStep}
              serviceName={serviceName}
              onReplay={() => setMode('replay')}
              actions={<FlowEditActions flow={flow} />}
            />
          )}
        </aside>
      </div>
    </Frame>
  );
}

/**
 * Retries inside each step, read from the service's transit board (the clients of the line that
 * implements the step): used to multiply retries across levels in the findings.
 */
function useInnerAttempts(flow: BusinessFlow, environmentId: string, window: TransitWindow): Map<string, { attempts: number; what: string }> {
  const services = [...new Set(flow.steps.map((s) => s.serviceDefinitionId))].sort();
  const boards = useRepositoryRead(`${services.join(',')}\u0000${environmentId}\u0000${window}`, (r, signal) => Promise.all(services.map((id) => r.getBoard(id, environmentId, window, signal))));
  return useMemo(() => {
    const out = new Map<string, { attempts: number; what: string }>();
    if (boards.status !== 'ready') return out;
    for (const board of boards.value) {
      if (!board) continue;
      for (const step of flow.steps.filter((s) => s.serviceDefinitionId === board.serviceDefinitionId && s.entryPoint)) {
        const entry = (step.entryPoint ?? '').toLowerCase();
        const line = board.lines.find((l) => l.name.toLowerCase() === entry || l.signature.toLowerCase() === entry);
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
