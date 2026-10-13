import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { businessFlowsIn, resolveBusinessFlow, typicalPath } from '../../domain/businessFlow';
import { dataStoresOf, flowDataStores } from '../../domain/dataStores';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow, FlowStep } from '../../domain/types';
import { useTopology } from '../../data/topologyContext';
import { DEFAULT_WINDOW, isWindow, windowLabel } from '../../transit/board';
import { indexFlows, type FlowBoardIndex } from '../../transit/flows/flowIndex';
import { computeSwimlanes } from '../../transit/flows/swimlane';
import { flowFindings } from '../../transit/flows/flowModel';
import { sampleTransactions, txDivergence } from '../../transit/flows/observed';
import type { TransitWindow } from '../../transit/types';
import { ignoreShortcut } from '../../shared/keyboard';
import { Segment, Segmented } from '../../shared/ui/primitives';
import { LoadState } from '../../shared/ui/LoadState';
import { useMotionReduced } from '../../state/motion';
import { useFlowImpacts } from '../../state/useFlowImpacts';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { BoardFrame, BoardGrid, BoardHeader } from '../boards/BoardLayout';
import { createPlayback, playbackActions, usePlaybackClock, useReplayUrlTime, type Timeline } from '../boards/playback';
import { WindowSelect } from '../boards/WindowSelect';
import { useRepositoryRead } from '../transit-board/useTransitBoard';
import { FlowEditActions } from './FlowEditActions';
import { useBoardIndexes, useFlowBoards, useInnerAttempts } from './useFlowBoards';
import { FlowImpactBanner } from './FlowImpactPanels';
import { FlowSwimlane } from './FlowSwimlane';
import { SwimlaneLegend } from './SwimlaneParts';
import { FlowCard, FlowPicker, FlowStrip } from './FlowPanels';
import { TxCard, TxStrip } from './FlowReplay';
import { ProcessDiagram } from '../boards/ProcessDiagram';
import { EndpointContractPanel } from '../contracts/EndpointContractPanel';
import { StripSwitch } from '../boards/StripSwitch';
import { flowProcess } from '../../transit/process';

type Mode = 'typical' | 'replay';

// The 3D drill-down (ADR-026) is its own chunk: Three.js loads only when it is opened.
const FlowDrilldown3D = lazy(() => import('./drilldown/FlowDrilldown3D').then((m) => ({ default: m.FlowDrilldown3D })));

/**
 * Flow board (ADR-022, ADR-023; docs/BUSINESS_FLOWS.md §7 and Revision 2 §9): one flow as
 * swimlanes, with typical mode (stats, budget, findings) and business-transaction replay. Steps
 * drill down to the service's transit board.
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
  return <Board key={`${flow.id}\u0000${environmentId}`} index={topology.index} flow={flow} environmentId={environmentId} viewingHistory={topology.history !== null} />;
}

function Board({ index, flow, environmentId, viewingHistory }: { index: TopologyIndex; flow: BusinessFlow; environmentId: string; viewingHistory: boolean }) {
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
  const strip = params.get('strip') === 'process' ? 'process' : 'stages';
  // The map as swimlanes or as the 3D drill-down, and the service the 3D camera has entered.
  const scene = params.get('scene') === '3d' ? '3d' : '2d';
  const drill = params.get('drill');

  const serviceName = useCallback((id: string) => index.definitions.get(id)?.name ?? id, [index]);
  const eventName = useCallback((id: string) => index.eventTypes.get(id)?.name ?? id, [index]);
  const flowStores = useMemo(() => flowDataStores(index, flow, environmentId), [index, flow, environmentId]);
  const storesOf = useCallback((id: string) => dataStoresOf(index, id, environmentId).map((s) => ({ id: s.id, name: s.name, health: s.health })), [index, environmentId]);
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const flows = useMemo(() => {
    const deployed = businessFlowsIn(index, environmentId).map((r) => r.flow);
    return deployed.some((f) => f.id === flow.id) ? deployed : [...deployed, flow];
  }, [index, environmentId, flow]);
  const fx: FlowBoardIndex = useMemo(() => indexFlows(flows, (id) => index.definitions.get(id)?.name ?? id), [flows, index]);
  const reduced = useMotionReduced();
  // Computed once per flow; selection, search, and replay never rebuild it (ADR-023).
  const layout = useMemo(() => computeSwimlanes(flow, serviceName, eventName), [flow, serviceName, eventName]);
  const resolved = useMemo(() => resolveBusinessFlow(index, flow, environmentId), [index, flow, environmentId]);
  // Simulated failures mapped onto this flow (ADR-025); not while viewing history.
  const simulation = useFlowImpacts(viewingHistory ? null : index, environmentId);
  const impact = simulation.flows.find((f) => f.flowId === flow.id) ?? null;
  const simulatedSteps = useMemo(() => (impact ? new Map(impact.steps.map((s) => [s.stepId, s.effect])) : null), [impact]);

  const stats = useRepositoryRead(`${flow.id}\u0000${environmentId}\u0000${windowValue}`, (r, signal) => r.getFlowStats(flow, environmentId, windowValue, signal));
  const flowStats = stats.status === 'ready' ? stats.value : null;
  const shares = useMemo(() => new Map(Object.entries(flowStats?.transitions ?? {})), [flowStats]);
  const serviceBoards = useFlowBoards(flow, environmentId, windowValue);
  const inner = useInnerAttempts(flow, serviceBoards);
  const boardIndexes = useBoardIndexes(serviceBoards);
  const findings = useMemo(
    () =>
      flowFindings(flow, {
        eventName,
        serviceName,
        shares,
        innerAttempts: (step) => inner.get(`${step.serviceDefinitionId}\u0000${step.entryPoint ?? ''}`) ?? null,
        databasesOf: (id) => storesOf(id).flatMap((s) => (index.resources.get(s.id)?.type === 'database' ? [s.name] : [])),
      }),
    [flow, shares, inner, eventName, serviceName, storesOf, index],
  );
  const warnings = useMemo(() => new Map(fx.flows.map((f) => [f.id, f.id === flow.id ? findings.filter((x) => x.severity === 'warn').length : 0])), [fx, flow.id, findings]);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<number | null>(null);
  const focusSteps = useMemo(() => new Set(focus !== null && mode === 'typical' ? (findings[focus]?.stepIds ?? []) : []), [focus, findings, mode]);
  const mapView = useMemo(() => {
    const finding = focus !== null && mode === 'typical' ? findings[focus] : undefined;
    const q = query.trim().toLowerCase();
    const stepMatches = q ? new Set(flow.steps.filter((s) => `${s.name} ${serviceName(s.serviceDefinitionId)} ${s.entryPoint ?? ''}`.toLowerCase().includes(q)).map((s) => s.id)) : null;
    return { selectedStepId: stepId, focus: finding ? { steps: new Set(finding.stepIds), transitions: new Set(finding.transitionIds) } : null, matches: stepMatches, simulated: simulatedSteps };
  }, [focus, mode, findings, query, flow, serviceName, stepId, simulatedSteps]);
  const selectedStep: FlowStep | null = (stepId && flow.steps.find((s) => s.id === stepId)) || null;

  // Replay: samples, the chosen (or first) transaction, a local playback clock.
  const txList = useRepositoryRead(mode === 'replay' ? `${flow.id}\u0000${windowValue}` : null, (r, signal) => r.getTransactions(flow, windowValue, signal));
  const samples = useMemo(() => (txList.status === 'ready' ? sampleTransactions(txList.value, flowStats) : []), [txList, flowStats]);
  const chosenKey = mode === 'replay' ? (txKey ?? samples[0]?.tx.key ?? null) : null;
  const txRead = useRepositoryRead(chosenKey ? `${flow.id}\u0000${chosenKey}` : null, (r, signal) => r.getTransaction(flow, chosenKey ?? '', signal));
  const tx = txRead.status === 'ready' ? txRead.value : null;
  const txError = txRead.status === 'error' ? txRead.message : txRead.status === 'ready' && !txRead.value && chosenKey ? `No transaction “${chosenKey}” for ${flow.name}.` : null;
  const process = useMemo(() => flowProcess(flow, { serviceName, eventName, shares }), [flow, serviceName, eventName, shares]);
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
  const setScene = (next: '2d' | '3d') =>
    update((p) => {
      if (next === '3d') p.set('scene', '3d');
      else {
        p.delete('scene');
        p.delete('drill');
      }
    });
  const setDrill = (serviceId: string | null) => update((p) => (serviceId ? p.set('drill', serviceId) : p.delete('drill')));
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
          <>
            <Segmented aria-label="View">
              <Segment pressed={mode === 'typical'} onClick={() => setMode('typical')}>
                Typical
              </Segment>
              <Segment pressed={mode === 'replay'} onClick={() => setMode('replay')}>
                Transaction replay
              </Segment>
            </Segmented>
            <Segmented aria-label="Map view">
              <Segment pressed={scene === '2d'} onClick={() => setScene('2d')}>
                Swimlane
              </Segment>
              <Segment pressed={scene === '3d'} onClick={() => setScene('3d')}>
                3D
              </Segment>
            </Segmented>
          </>
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
      {impact && <FlowImpactBanner index={index} flow={flow} impact={impact} failures={simulation.failures} />}
      <BoardGrid
        labels={{ index: 'Flows', map: 'Map', strip: 'Step strip', card: 'Flow card' }}
        cardWidth={340}
        onKeyDown={onKeyDown}
        wideMap
        index={<FlowPicker fx={fx} selectedId={flow.id} query={query} onQuery={setQuery} matchCount={mapView.matches?.size ?? null} warnings={warnings} search={params.toString() ? `?${params.toString()}` : ''} />}
        map={
          scene === '3d' ? (
            <Suspense fallback={<p className="m-0 p-4 text-sm text-fg-2">Loading the 3D view…</p>}>
              <FlowDrilldown3D
                flow={flow}
                layout={layout}
                boards={boardIndexes}
                serviceName={serviceName}
                scope={drill}
                onScope={setDrill}
                selectedStepId={stepId}
                onSelectStep={(id) => selectStep(id === stepId ? null : id)}
                replay={mode === 'replay' && tx ? { steps: tx.steps, playback } : null}
                onExit={() => setScene('2d')}
              />
            </Suspense>
          ) : (
            <FlowSwimlane
              fx={fx}
              flow={flow}
              layout={layout}
              serviceName={serviceName}
              eventName={eventName}
              shares={shares}
              storesOf={storesOf}
              view={mapView}
              replay={mode === 'replay' && tx ? { tx, playback, divergence } : null}
              playback={playback}
              onSelectStep={(id) => selectStep(id === stepId ? null : id)}
            />
          )
        }
        legend={scene === '3d' ? undefined : <SwimlaneLegend className="max-md:hidden" />}
        strip={
          mode === 'replay' && tx ? (
            <TxStrip flow={flow} tx={tx} playback={playback} divergence={divergence} onSeek={actions.seek} onJump={actions.jump} />
          ) : (
            <>
              <StripSwitch
                label="Strip"
                options={[
                  { id: 'stages', label: 'Stages' },
                  { id: 'process', label: 'Process' },
                ]}
                value={strip}
                onChange={(v) => update((p) => (v === 'process' ? p.set('strip', 'process') : p.delete('strip')))}
              />
              {strip === 'process' ? (
                <ProcessDiagram process={process} label={`Process of ${flow.name}`} endpointPanel={EndpointContractPanel} />
              ) : (
                <FlowStrip flow={flow} stats={flowStats} selectedStep={stepId} focusSteps={focusSteps} onSelectStep={(id) => selectStep(id === stepId ? null : id)} serviceName={serviceName} eventName={eventName} />
              )}
            </>
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
              stores={flowStores}
            />
          )
        }
      />
    </BoardFrame>
  );
}
