import { useContext, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import { businessFlowsIn } from '../../domain/businessFlow';
import type { ServiceDefinition } from '../../domain/types';
import { indexFlows, type FlowBoardIndex } from '../../transit/flows/flowIndex';
import { flowsOnService, type FlowOnService } from '../../transit/flows/flowModel';
import { DEFAULT_WINDOW, findLine, indexBoard, isUnobserved, isWindow, matchingLines, windowLabel, withTableFindings } from '../../transit/board';
import { computeMapGeometry } from '../../transit/layout';
import { TransitRepositoryContext } from '../../transit/repository';
import { applyLinks, linkDependencies, linksKey, type DependencyLink } from '../../transit/links';
import { useKeyed } from '../../shared/hooks/useKeyed';
import { divergence as divergenceOf, sampleTraces } from '../../transit/trace';
import type { Line, TraceDetail, TransitBoard, TransitWindow } from '../../transit/types';
import { boardPanelClass, buttonClass, cx } from '../../shared/ui/classes';
import { NARROW_QUERY, useMediaQuery } from '../../shared/hooks/useMediaQuery';
import { ignoreShortcut } from '../../shared/keyboard';
import { Segment, Segmented } from '../../shared/ui/primitives';
import { LoadState } from '../../shared/ui/LoadState';
import { useMotionReduced } from '../../state/motion';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { LineCard } from './LineCard';
import { LineIndex, LineSelect } from './LineIndex';
import { BoardFrame, BoardGrid, BoardHeader, BoardSkeleton } from '../boards/BoardLayout';
import { WindowSelect } from '../boards/WindowSelect';
import { createPlayback, playbackActions, usePlaybackClock, useReplayUrlTime, type Timeline } from '../boards/playback';
import { StopStrip } from './StopStrip';
import { TraceCard, TraceStrip, TrainMarker } from './TraceReplay';
import { MapLegend, TransitMap } from './TransitMap';
import { FlowRows, FlowsWithoutBoard, UsedByChips, UsedByFlows } from './FlowsOnService';
import { DependencyList } from './DependencyList';
import { useTraceDetail, useTraceList, useTransitBoard } from './useTransitBoard';

type Mode = 'typical' | 'trace';

/** Page-local view state in the URL (`line`, `mode`, `trace`, `t`, `window`, `flow`; kept by useUrlStateSync on this route). */
function useBoardParams() {
  const [params, setParams] = useSearchParams();
  const update = (change: (next: URLSearchParams) => void, replace = false) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace, preventScrollReset: true },
    );
  const windowParam = params.get('window');
  return {
    lineId: params.get('line'),
    mode: (params.get('mode') === 'trace' ? 'trace' : 'typical') as Mode,
    traceId: params.get('trace'),
    t: params.get('t'),
    flowId: params.get('flow'),
    window: isWindow(windowParam) ? windowParam : DEFAULT_WINDOW,
    update,
  };
}

/**
 * Transit board for one service (docs/TRANSIT_BOARD.md, PRODUCT_SPEC Revision 8 §O, ADR-021):
 * line index, perspective transit map, stop strip, and line card, in typical-route and
 * trace-replay modes. Example data until real sources are integrated.
 */
export function TransitBoardPage() {
  const { serviceId = '' } = useParams();
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  if (topology.status !== 'ready') {
    return (
      <BoardFrame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <LoadState state={topology} />
      </BoardFrame>
    );
  }
  const definition = topology.index.definitions.get(serviceId);
  if (!definition) {
    return (
      <BoardFrame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <Note>No service with ID “{serviceId}” exists in this data. Open a transit board from a service in the inspector.</Note>
      </BoardFrame>
    );
  }
  const environmentName = topology.index.environments.get(environmentId)?.name ?? environmentId;
  return <Board key={`${definition.id}\u0000${environmentId}`} definition={definition} environmentId={environmentId} environmentName={environmentName} />;
}

function Board({ definition, environmentId, environmentName }: { definition: ServiceDefinition; environmentId: string; environmentName: string }) {
  const [attempt, setAttempt] = useState(0);
  const url = useBoardParams();
  const state = useTransitBoard(definition.id, environmentId, url.window, attempt);
  const repository = useContext(TransitRepositoryContext);
  const board = state.status === 'ready' ? state.board : state.status === 'error' ? state.last : null;
  const line = board ? findLine(board.lines, url.lineId) : null;
  const mode: Mode = url.mode === 'trace' && line && !isUnobserved(line) ? 'trace' : 'typical';
  const setMode = (next: Mode) =>
    url.update((p) => {
      if (next === 'trace') p.set('mode', 'trace');
      else p.delete('mode');
      p.delete('t');
    });

  return (
    <BoardFrame>
      <BoardHeader
        breadcrumb={`${environmentName} / ${definition.name} /`}
        title="Transit board"
        modes={<ModeSwitch mode={mode} line={line} window={url.window} onMode={setMode} />}
        aside={
          <>
            <WindowSelect
              value={url.window}
              onChange={(w) =>
                url.update((p) => {
                  if (w === DEFAULT_WINDOW) p.delete('window');
                  else p.set('window', w);
                  p.delete('trace');
                  p.delete('t');
                })
              }
            />
            <span className="tag tag-simulated">
              {repository.sourceLabel} · {windowLabel(url.window)}
            </span>
          </>
        }
      />
      {state.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-crit px-3.5 py-2.5">
          <span>
            <b>Could not load the transit board.</b> <span className="font-mono text-crit-fg">{state.message}</span>
            {state.last && <span className="text-fg-2"> Showing the last board that loaded.</span>}
          </span>
          <button type="button" className={buttonClass('secondary', 'ml-auto')} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'loading' ? (
        <BoardSkeleton label="Loading the transit board" />
      ) : board === null ? (
        state.status === 'ready' && (
          <div className={cx(boardPanelClass, 'grid min-h-[320px] place-items-center p-6 text-center')}>
            <div className="max-w-[460px]">
              <h2 className="m-0 mb-1.5 text-lg font-semibold">No endpoints yet</h2>
              <p className="m-0 text-fg-2">
                No entry points are known for {definition.name} in {environmentName}. The board needs API specs (proto, OpenAPI, AsyncAPI) or scheduler config for its lines, and
                OpenTelemetry traces for its routes; see <code className="font-mono text-sm">docs/TRANSIT_BOARD.md</code> (“Data sources”). Only Payment Service has example data.
              </p>
              <NoBoardFlows definition={definition} />
            </div>
          </div>
        )
      ) : (
        <BoardView board={board} definition={definition} mode={mode} onMode={setMode} url={url} />
      )}
    </BoardFrame>
  );
}

function ModeSwitch({ mode, line, window, onMode }: { mode: Mode; line: Line | null; window: TransitWindow; onMode: (mode: Mode) => void }) {
  const noteId = useId();
  const reason = !line ? 'Select a line to replay one of its requests.' : isUnobserved(line) ? `No traces for line ${line.code} in the ${windowLabel(window)}, so there is nothing to replay.` : null;
  return (
    <div className="flex items-center gap-2">
      <Segmented aria-label="View">
        <Segment pressed={mode === 'typical'} onClick={() => onMode('typical')}>
          Typical route
        </Segment>
        <Segment
          pressed={mode === 'trace'}
          disabled={reason !== null}
          aria-describedby={reason ? noteId : undefined}
          title={reason ?? undefined}
          className="disabled:cursor-default disabled:opacity-50"
          onClick={() => onMode('trace')}
        >
          Trace replay
        </Segment>
      </Segmented>
      {reason && (
        <span id={noteId} className="sr-only">
          {reason}
        </span>
      )}
    </div>
  );
}

function BoardView({ board: loaded, definition, mode, onMode, url }: { board: TransitBoard; definition: ServiceDefinition; mode: Mode; onMode: (mode: Mode) => void; url: ReturnType<typeof useBoardParams> }) {
  // Dependencies take their names and health from the topology (ADR-027); geometry follows only real changes.
  const { board, links } = useLinkedBoard(loaded);
  const index = useMemo(() => indexBoard(board), [board]);
  const { fx, onService } = useFlowsOnService(definition, board.lines);
  const selectedFlow = onService.find((f) => f.flow.id === url.flowId) ?? null;
  const flowLines = useMemo(() => (selectedFlow ? new Set(selectedFlow.steps.flatMap((s) => (s.lineId ? [s.lineId] : []))) : null), [selectedFlow]);
  const selectFlow = (flowId: string | null) => url.update((p) => (flowId ? p.set('flow', flowId) : p.delete('flow')));
  const narrow = useMediaQuery(NARROW_QUERY);
  const reduced = useMotionReduced();
  // Computed once per data load (and per projection mode); selection, search, and playback never rebuild it.
  const geometry = useMemo(() => computeMapGeometry(index, { flat: narrow }), [index, narrow]);
  const { search } = useLocation();
  const line = findLine(index.lines, url.lineId);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ lineId: string; at: number } | null>(null);
  const matches = useMemo(() => matchingLines(index, query), [index, query]);
  const focusedFinding = mode === 'typical' && focus && line && focus.lineId === line.id ? focus.at : null;
  const focusStations = useMemo(() => new Set(focusedFinding !== null && line ? (line.findings[focusedFinding]?.stationIds ?? []) : []), [line, focusedFinding]);

  // Trace replay: samples for the line, the chosen (or first) trace, and a local playback clock.
  const traces = useTraceList(definition.id, line?.id ?? null, url.window, mode === 'trace');
  const samples = useMemo(() => (traces.status === 'ready' && line ? sampleTraces(traces.value, line) : []), [traces, line]);
  const traceId = mode === 'trace' ? (url.traceId ?? samples[0]?.trace.traceId ?? null) : null;
  const detail = useTraceDetail(definition.id, traceId);
  const trace: TraceDetail | null = detail.status === 'ready' ? detail.value : null;
  const traceError = detail.status === 'error' ? detail.message : detail.status === 'ready' && !detail.value && traceId ? `No trace with ID “${traceId}” for ${definition.name}.` : null;
  const divergence = useMemo(() => (trace && line ? divergenceOf(index, line, trace.steps) : null), [index, line, trace]);
  const [playback] = useState(() => createPlayback());
  const timeline: Timeline | null = useMemo(() => (trace ? { starts: trace.steps.map((s) => s.startMs), total: trace.summary.durationMs } : null), [trace]);
  usePlaybackClock(playback, timeline, reduced);
  useReplayUrlTime(playback, timeline, {
    linkedTime: url.t,
    enabled: mode === 'trace',
    writeTime: (value) => (url.t ?? null) !== value && url.update((p) => (value ? p.set('t', value) : p.delete('t')), true),
  });
  const actions = playbackActions(playback, timeline);

  // A line named by entry point (a flow step's drill-down) is rewritten to its ID.
  useEffect(() => {
    if (line && url.lineId !== line.id) url.update((p) => p.set('line', line.id), true);
  }, [line, url]);

  // A pasted trace of another line switches to that line.
  useEffect(() => {
    if (trace && line && trace.summary.lineId !== line.id) url.update((p) => p.set('line', trace.summary.lineId), true);
  }, [trace, line, url]);

  const select = (lineId: string | null) => {
    if ((lineId ?? null) === (line?.id ?? null)) return;
    setFocus(null);
    actions.reset();
    url.update((p) => {
      if (lineId) p.set('line', lineId);
      else {
        p.delete('line');
        p.delete('mode');
      }
      p.delete('trace');
      p.delete('t');
    });
  };
  const pickTrace = (id: string) => {
    actions.reset();
    url.update((p) => {
      p.set('trace', id);
      p.delete('t');
    });
  };
  const switchSample = (direction: -1 | 1) => {
    if (samples.length === 0) return;
    const at = samples.findIndex((s) => s.trace.traceId === traceId);
    const next = samples[(at + direction + samples.length) % samples.length];
    if (next) pickTrace(next.trace.traceId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && (line || selectedFlow)) {
      e.preventDefault();
      if (line) select(null);
      else selectFlow(null);
      return;
    }
    if (ignoreShortcut(e) || !line) return;
    if (e.key === 't' || e.key === 'T') {
      if (!isUnobserved(line)) onMode(mode === 'trace' ? 'typical' : 'trace');
    } else if (mode !== 'trace') {
      return;
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      actions.toggle();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      actions.step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === '[' || e.key === ']') {
      switchSample(e.key === ']' ? 1 : -1);
    }
  };

  return (
    <>
      <UsedByChips fx={fx} flows={onService} selectedFlowId={selectedFlow?.flow.id ?? null} onSelect={selectFlow} />
      <BoardGrid
        labels={{ index: 'Lines', map: 'Map', strip: 'Stop strip', card: 'Line card' }}
        onKeyDown={onKeyDown}
        narrowIndex={<LineSelect index={index} selectedId={line?.id ?? null} onSelect={select} />}
        index={
          <LineIndex
            index={index}
            query={query}
            onQuery={setQuery}
            matches={matches}
            selectedId={line?.id ?? null}
            onSelect={select}
            flows={<FlowRows fx={fx} flows={onService} selectedFlowId={selectedFlow?.flow.id ?? null} onSelect={selectFlow} />}
          />
        }
        map={
          <TransitMap
            index={index}
            geometry={geometry}
            serviceName={definition.name}
            selectedId={line?.id ?? null}
            matches={query.trim() ? matches : flowLines}
            focusStations={focusStations}
            showStepStats={mode === 'typical'}
            onSelect={select}
            links={links}
            overlay={mode === 'trace' && trace ? <TrainMarker geometry={geometry} trace={trace} playback={playback} reduced={reduced} /> : undefined}
          />
        }
        legend={<MapLegend className="max-md:hidden" />}
        strip={
          mode === 'trace' && line && trace ? (
            <TraceStrip line={line} trace={trace} playback={playback} divergence={divergence} onSeek={actions.seek} onJump={actions.jump} />
          ) : (
            <StopStrip index={index} line={line} focusStations={focusStations} />
          )
        }
        card={
          <>
            {mode === 'trace' && line ? (
              <TraceCard
                index={index}
                line={line}
                samples={samples}
                tracesStatus={traces.status}
                trace={trace}
                traceError={traceError}
                playback={playback}
                divergence={divergence}
                onPick={pickTrace}
                onOpenId={pickTrace}
                onPlay={actions.toggle}
                onStep={actions.step}
              />
            ) : (
              <LineCard
                index={index}
                line={line}
                focusedFinding={focusedFinding}
                onFocusFinding={(at) => setFocus(at === null || !line ? null : { lineId: line.id, at })}
                onReplay={line && !isUnobserved(line) ? () => onMode('trace') : undefined}
                usedBy={line && onService.length > 0 ? <UsedByFlows fx={fx} uses={usesOf(onService, line.id)} /> : undefined}
                dependsOn={line ? <DependencyList index={index} line={line} links={links} /> : undefined}
              />
            )}
            {line && (
              <p className="m-0 mt-4 text-xs">
                <Link to={{ pathname: '/map', search: search.replace(/([?&])line=[^&]*&?/, '$1') }} className="text-accent-fg underline">
                  Back to the service map
                </Link>
              </p>
            )}
          </>
        }
      />
    </>
  );
}

/** The business flows deployed in the environment that have a step on this service (ADR-023). */
function useFlowsOnService(definition: ServiceDefinition, lines: TransitBoard['lines']): { fx: FlowBoardIndex; onService: FlowOnService[] } {
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  const index = topology.status === 'ready' ? topology.index : null;
  return useMemo(() => {
    const flows = index ? businessFlowsIn(index, environmentId).map((r) => r.flow) : [];
    const fx = indexFlows(flows, (id) => index?.definitions.get(id)?.name ?? id);
    return { fx, onService: flowsOnService(fx.flows, definition.id, lines) };
  }, [index, environmentId, definition.id, lines]);
}

function usesOf(onService: readonly FlowOnService[], lineId: string) {
  return onService.flatMap(({ flow, steps }) => steps.filter((s) => s.lineId === lineId).map((s) => ({ flowId: flow.id, flowName: flow.name, stepId: s.step.id, stepName: s.step.name })));
}

/** The loaded board with its dependencies linked to the topology in the current environment. */
function useLinkedBoard(loaded: TransitBoard): { board: TransitBoard; links: ReadonlyMap<string, DependencyLink> } {
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  const index = topology.status === 'ready' ? topology.index : null;
  const checked = useMemo(() => withTableFindings(loaded), [loaded]);
  const fresh = useMemo(() => (index ? linkDependencies(checked, index, environmentId) : new Map<string, DependencyLink>()), [checked, index, environmentId]);
  const links = useKeyed(fresh, linksKey(fresh));
  const board = useMemo(() => applyLinks(checked, links), [checked, links]);
  return { board, links };
}

const NO_LINES: TransitBoard['lines'] = [];

/** A service without board data still shows the flows that run on it (ADR-027 §16). */
function NoBoardFlows({ definition }: { definition: ServiceDefinition }) {
  const { fx, onService } = useFlowsOnService(definition, NO_LINES);
  return <FlowsWithoutBoard fx={fx} flows={onService} />;
}
