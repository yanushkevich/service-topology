import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { businessFlowsIn, resolveBusinessFlow } from '../../domain/businessFlow';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow, FlowStep } from '../../domain/types';
import { useTopology } from '../../data/topologyContext';
import { DEFAULT_WINDOW, isWindow, windowLabel } from '../../transit/board';
import { computeFlowGeometry, indexFlows, type FlowBoardIndex } from '../../transit/flows/flowLayout';
import { flowFindings, flowSearchText, typicalPath } from '../../transit/flows/flowModel';
import { sampleTransactions, txDivergence } from '../../transit/flows/observed';
import type { TransitWindow } from '../../transit/types';
import { NARROW_QUERY, useMediaQuery } from '../../shared/hooks/useMediaQuery';
import { ignoreShortcut } from '../../shared/keyboard';
import { Segment, Segmented } from '../../shared/ui/primitives';
import { LoadState } from '../../shared/ui/LoadState';
import { useMotionReduced } from '../../state/motion';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { BoardFrame, BoardGrid, BoardHeader } from '../boards/BoardLayout';
import { createPlayback, playbackActions, usePlaybackClock, useReplayUrlTime, type Timeline } from '../boards/playback';
import { WindowSelect } from '../boards/WindowSelect';
import { useRepositoryRead } from '../transit-board/useTransitBoard';
import { FlowEditActions } from './FlowEditActions';
import { FlowLegend, FlowMap } from './FlowMap';
import { FlowCard, FlowList, FlowStrip } from './FlowPanels';
import { TxCard, TxStrip, TxTrain } from './FlowReplay';

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
      <BoardFrame>
        <h1 className="m-0 text-xl font-semibold">Business flow</h1>
        <LoadState state={topology} />
      </BoardFrame>
    );
  }
  const flow = topology.index.businessFlows.get(flowId);
  if (!flow) {
    return (
      <BoardFrame>
        <h1 className="m-0 text-xl font-semibold">Business flow</h1>
        <Note>No business flow with ID “{flowId}” exists in this data. Choose one from the Business flows catalog.</Note>
      </BoardFrame>
    );
  }
  return <Board key={`${flow.id}\u0000${environmentId}`} index={topology.index} flow={flow} environmentId={environmentId} />;
}

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
  const narrow = useMediaQuery(NARROW_QUERY);
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
  const timeline: Timeline | null = useMemo(() => (tx ? { starts: tx.steps.map((s) => s.displayStartMs), total: Math.max(...tx.steps.map((s) => s.displayStartMs + s.displayDurationMs), 1) } : null), [tx]);
  usePlaybackClock(playback, timeline, reduced);
  useReplayUrlTime(playback, timeline, {
    linkedTime: params.get('t'),
    enabled: mode === 'replay',
    writeTime: (value) => (params.get('t') ?? null) !== value && update((p) => (value ? p.set('t', value) : p.delete('t')), true),
  });
  const actions = playbackActions(playback, timeline);

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
    actions.reset();
    update((p) => {
      p.set('tx', key);
      p.delete('t');
    });
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
    if (ignoreShortcut(e)) return;
    if (e.key === 't' || e.key === 'T') setMode(mode === 'replay' ? 'typical' : 'replay');
    else if (mode !== 'replay') return;
    else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      actions.toggle();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      actions.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === '[' || e.key === ']') switchSample(e.key === ']' ? 1 : -1);
  };

  return (
    <BoardFrame>
      <BoardHeader
        breadcrumb={`${environmentName} / Business flows /`}
        title={flow.name}
        modes={
          <Segmented aria-label="View">
            <Segment pressed={mode === 'typical'} onClick={() => setMode('typical')}>
              Typical
            </Segment>
            <Segment pressed={mode === 'replay'} onClick={() => setMode('replay')}>
              Transaction replay
            </Segment>
          </Segmented>
        }
        aside={
          <>
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
          </>
        }
      />
      <BoardGrid
        labels={{ index: 'Flows', map: 'Map', strip: 'Step strip', card: 'Flow card' }}
        cardWidth={340}
        onKeyDown={onKeyDown}
        index={<FlowList fx={fx} selectedId={flow.id} query={query} onQuery={setQuery} matches={matches} warnings={warnings} search={params.toString() ? `?${params.toString()}` : ''} />}
        map={
          <FlowMap
            fx={fx}
            geometry={geometry}
            selectedFlowId={flow.id}
            selectedStation={selectedStep ? fx.stationOf(flow.id, selectedStep.id) : null}
            matches={query.trim() ? matches : null}
            onSelectStation={(key, flowId) => {
              const ref = fx.stations.get(key)?.refs.find((r) => r.flowId === flowId);
              if (ref && flowId === flow.id && flow.steps.some((s) => s.id === ref.id)) selectStep(ref.id);
            }}
            overlay={mode === 'replay' && tx ? <TxTrain fx={fx} geometry={geometry} tx={tx} playback={playback} reduced={reduced} /> : undefined}
          />
        }
        legend={<FlowLegend className="max-md:hidden" />}
        strip={
          mode === 'replay' && tx ? (
            <TxStrip flow={flow} tx={tx} playback={playback} divergence={divergence} onSeek={actions.seek} onJump={actions.jump} />
          ) : (
            <FlowStrip flow={flow} stats={flowStats} selectedStep={stepId} focusSteps={focusSteps} onSelectStep={(id) => selectStep(id === stepId ? null : id)} serviceName={serviceName} eventName={eventName} />
          )
        }
        card={
          mode === 'replay' ? (
            <TxCard fx={fx} flow={flow} samples={samples} loading={txList.status === 'loading'} tx={tx} txError={txError} playback={playback} divergence={divergence} onPick={pickTx} onPlay={actions.toggle} onStep={actions.step} />
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
          )
        }
      />
    </BoardFrame>
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
