import { useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import type { ServiceDefinition } from '../../domain/types';
import { DEFAULT_WINDOW, indexBoard, isUnobserved, isWindow, matchingLines, windowLabel, WINDOWS } from '../../transit/board';
import { computeMapGeometry } from '../../transit/layout';
import { TransitRepositoryContext } from '../../transit/repository';
import { divergence as divergenceOf, sampleTraces, stepIndexAt, traceMsPerFrameMs } from '../../transit/trace';
import type { Line, TraceDetail, TransitBoard, TransitWindow } from '../../transit/types';
import { buttonClass, cx, fieldClass, segmentClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { LoadState } from '../../shared/ui/LoadState';
import { useMotionReduced } from '../../state/motion';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { LineCard } from './LineCard';
import { LineIndex, LineSelect } from './LineIndex';
import { createPlayback, usePlayback } from './playback';
import { StopStrip } from './StopStrip';
import { TraceCard, TraceStrip, TrainMarker } from './TraceReplay';
import { MapLegend, TransitMap } from './TransitMap';
import { useTraceDetail, useTraceList, useTransitBoard } from './useTransitBoard';

/** Below 760px the map is flat and the index is a select (spec "Responsive"). */
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

type Mode = 'typical' | 'trace';

/** Page-local view state in the URL (`line`, `mode`, `trace`, `t`, `window`; kept by useUrlStateSync on this route). */
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
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <LoadState state={topology} />
      </Frame>
    );
  }
  const definition = topology.index.definitions.get(serviceId);
  if (!definition) {
    return (
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <Note>No service with ID “{serviceId}” exists in this data. Open a transit board from a service in the inspector.</Note>
      </Frame>
    );
  }
  const environmentName = topology.index.environments.get(environmentId)?.name ?? environmentId;
  return <Board key={`${definition.id}\u0000${environmentId}`} definition={definition} environmentId={environmentId} environmentName={environmentName} />;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:px-3 max-md:pt-3">{children}</div>;
}

function Board({ definition, environmentId, environmentName }: { definition: ServiceDefinition; environmentId: string; environmentName: string }) {
  const [attempt, setAttempt] = useState(0);
  const url = useBoardParams();
  const state = useTransitBoard(definition.id, environmentId, url.window, attempt);
  const repository = useContext(TransitRepositoryContext);
  const board = state.status === 'ready' ? state.board : state.status === 'error' ? state.last : null;
  const line = (url.lineId && board?.lines.find((l) => l.id === url.lineId)) || null;
  const mode: Mode = url.mode === 'trace' && line && !isUnobserved(line) ? 'trace' : 'typical';
  const setMode = (next: Mode) =>
    url.update((p) => {
      if (next === 'trace') p.set('mode', 'trace');
      else p.delete('mode');
      p.delete('t');
    });
  const windowId = useId();

  return (
    <Frame>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <nav aria-label="Breadcrumb" className="text-[12.5px] text-fg-3">
          {environmentName} / {definition.name} /
        </nav>
        <h1 className="m-0 text-lg font-semibold">Transit board</h1>
        <ModeSwitch mode={mode} line={line} window={url.window} onMode={setMode} />
        <span className="flex-1" />
        <label htmlFor={windowId} className="text-xs text-fg-3">
          Window
        </label>
        <select
          id={windowId}
          className={cx(fieldClass, 'h-7.5 w-auto text-sm')}
          value={url.window}
          onChange={(e) =>
            url.update((p) => {
              if (e.target.value === DEFAULT_WINDOW) p.delete('window');
              else p.set('window', e.target.value);
              p.delete('trace');
              p.delete('t');
            })
          }
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <span className="tag tag-simulated">
          {repository.sourceLabel} · {windowLabel(url.window)}
        </span>
      </header>
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
        <Skeleton />
      ) : board === null ? (
        state.status === 'ready' && (
          <div className={cx(panelClass, 'grid min-h-[320px] place-items-center p-6 text-center')}>
            <div className="max-w-[460px]">
              <h2 className="m-0 mb-1.5 text-lg font-semibold">No endpoints yet</h2>
              <p className="m-0 text-fg-2">
                No entry points are known for {definition.name} in {environmentName}. The board needs API specs (proto, OpenAPI, AsyncAPI) or scheduler config for its lines, and
                OpenTelemetry traces for its routes; see <code className="font-mono text-sm">docs/TRANSIT_BOARD.md</code> (“Data sources”). Only Payment Service has example data.
              </p>
            </div>
          </div>
        )
      ) : (
        <BoardView board={board} definition={definition} mode={mode} onMode={setMode} url={url} />
      )}
    </Frame>
  );
}

function ModeSwitch({ mode, line, window, onMode }: { mode: Mode; line: Line | null; window: TransitWindow; onMode: (mode: Mode) => void }) {
  const noteId = useId();
  const reason = !line ? 'Select a line to replay one of its requests.' : isUnobserved(line) ? `No traces for line ${line.code} in the ${windowLabel(window)}, so there is nothing to replay.` : null;
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="View" className="flex gap-0.5 rounded-md border border-line p-0.5">
        <button type="button" aria-pressed={mode === 'typical'} className={segmentClass} onClick={() => onMode('typical')}>
          Typical route
        </button>
        <button
          type="button"
          aria-pressed={mode === 'trace'}
          disabled={reason !== null}
          aria-describedby={reason ? noteId : undefined}
          title={reason ?? undefined}
          className={cx(segmentClass, 'disabled:cursor-default disabled:opacity-50')}
          onClick={() => onMode('trace')}
        >
          Trace replay
        </button>
      </div>
      {reason && (
        <span id={noteId} className="sr-only">
          {reason}
        </span>
      )}
    </div>
  );
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

function BoardView({ board, definition, mode, onMode, url }: { board: TransitBoard; definition: ServiceDefinition; mode: Mode; onMode: (mode: Mode) => void; url: ReturnType<typeof useBoardParams> }) {
  const index = useMemo(() => indexBoard(board), [board]);
  const narrow = useNarrow();
  const reduced = useMotionReduced();
  // Computed once per data load (and per projection mode); selection, search, and playback never rebuild it.
  const geometry = useMemo(() => computeMapGeometry(index, { flat: narrow }), [index, narrow]);
  const { search } = useLocation();
  const line = url.lineId ? (index.lineById.get(url.lineId) ?? null) : null;
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ lineId: string; at: number } | null>(null);
  const [indexOpen, setIndexOpen] = useState(true);
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
  const playing = usePlayback(playback, (s) => s.playing);
  const pausedT = usePlayback(playback, (s) => (s.playing ? null : Math.round(s.t)));

  // A pasted trace of another line switches to that line.
  useEffect(() => {
    if (trace && line && trace.summary.lineId !== line.id) url.update((p) => p.set('line', trace.summary.lineId), true);
  }, [trace, line, url]);

  // A new trace starts paused at the start, or at `t` from a shared link.
  const startT = useRef(url.t);
  useEffect(() => {
    if (!trace) return;
    const requested = startT.current === null ? 0 : Number(startT.current);
    startT.current = null;
    const t = Number.isFinite(requested) ? Math.max(0, Math.min(requested, trace.summary.durationMs)) : 0;
    playback.set({ t, step: t > 0 ? stepIndexAt(trace.steps, t) : 0, playing: false });
  }, [trace, playback]);

  // `t` is written to the URL only while paused, to avoid flooding the history.
  useEffect(() => {
    if (mode !== 'trace' || !trace || pausedT === null) return;
    const value = pausedT > 0 ? String(pausedT) : null;
    if ((url.t ?? null) !== value) url.update((p) => (value ? p.set('t', value) : p.delete('t')), true);
  }, [mode, trace, pausedT, url]);

  // The clock (spec "Playback"): the whole trace in about 6 s at 1×, and every step on screen for at
  // least a moment (several steps can start at the same time); with reduced motion it moves one
  // step every 700 ms instead of animating.
  useEffect(() => {
    if (!playing || !trace) return;
    const { steps } = trace;
    const duration = trace.summary.durationMs;
    const last = steps.length - 1;
    if (reduced) {
      const timer = setInterval(() => {
        const { step } = playback.get();
        if (step >= last) playback.set({ t: duration, step: last, playing: false });
        else playback.set({ step: step + 1, t: steps[step + 1]?.startMs ?? duration });
      }, 700);
      return () => clearInterval(timer);
    }
    let frame = 0;
    let previous = 0;
    let changed = performance.now();
    const tick = (now: number) => {
      const { t, step, speed } = playback.get();
      const dt = previous ? now - previous : 16;
      previous = now;
      const advanced = Math.min(duration, t + dt * traceMsPerFrameMs(trace, speed));
      const next = steps[step + 1];
      if (next && next.startMs <= advanced) {
        if (now - changed >= 380 / speed) {
          changed = now;
          playback.set({ step: step + 1, t: Math.max(t, next.startMs) });
        } else playback.set({ t: Math.min(advanced, next.startMs) });
      } else if (!next && advanced >= duration) {
        playback.set({ t: duration, playing: false });
        return;
      } else playback.set({ t: advanced });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, trace, reduced, playback]);

  const select = (lineId: string | null) => {
    if ((lineId ?? null) === (line?.id ?? null)) return;
    setFocus(null);
    playback.set({ playing: false, t: 0, step: 0 });
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
    playback.set({ playing: false, t: 0, step: 0 });
    url.update((p) => {
      p.set('trace', id);
      p.delete('t');
    });
  };
  const seek = (t: number) => trace && playback.set({ t, step: t <= 0 ? 0 : stepIndexAt(trace.steps, t), playing: false });
  const jump = (step: number) => {
    const target = trace?.steps[step];
    if (target) playback.set({ step, t: target.startMs, playing: false });
  };
  const step = (direction: -1 | 1) => {
    if (!trace) return;
    const { step: at } = playback.get();
    if (direction > 0 && at >= trace.steps.length - 1) playback.set({ t: trace.summary.durationMs, playing: false });
    else jump(Math.max(0, at + direction));
  };
  const togglePlay = () => {
    if (!trace) return;
    const { t, playing: now } = playback.get();
    if (!now && t >= trace.summary.durationMs) playback.set({ t: 0, step: 0, playing: true });
    else playback.set({ playing: !now });
  };
  const switchSample = (direction: -1 | 1) => {
    if (samples.length === 0) return;
    const at = samples.findIndex((s) => s.trace.traceId === traceId);
    const next = samples[(at + direction + samples.length) % samples.length];
    if (next) pickTrace(next.trace.traceId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && line) {
      e.preventDefault();
      select(null);
      return;
    }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !line) return;
    if (e.key === 't' || e.key === 'T') {
      if (!isUnobserved(line)) onMode(mode === 'trace' ? 'typical' : 'trace');
    } else if (mode !== 'trace') {
      return;
    } else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === '[' || e.key === ']') {
      switchSample(e.key === ']' ? 1 : -1);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[auto_minmax(0,1fr)] min-[1180px]:grid-cols-[260px_minmax(0,1fr)_330px]" onKeyDown={onKeyDown}>
      <nav aria-label="Lines" className={cx(panelClass, 'self-start p-3.5 md:row-span-2 md:row-start-1', indexOpen ? 'md:w-[240px] min-[1180px]:w-auto' : 'md:w-auto')}>
        <button type="button" className={buttonClass('ghost', 'mb-2 max-md:hidden min-[1180px]:hidden')} aria-expanded={indexOpen} onClick={() => setIndexOpen((open) => !open)}>
          <Icon name={indexOpen ? 'chevronDown' : 'chevronRight'} />
          Lines
        </button>
        <div className="md:hidden">
          <LineSelect index={index} selectedId={line?.id ?? null} onSelect={select} />
        </div>
        <div className={cx('max-md:hidden', !indexOpen && 'md:max-[1179px]:hidden')}>
          <LineIndex index={index} query={query} onQuery={setQuery} matches={matches} selectedId={line?.id ?? null} onSelect={select} />
        </div>
      </nav>

      <section aria-label="Map" className={cx(panelClass, 'relative flex flex-col justify-center overflow-hidden bg-stage p-1.5 pb-12 max-md:pb-1.5 md:col-start-2 md:row-start-1')}>
        <TransitMap
          index={index}
          geometry={geometry}
          serviceName={definition.name}
          selectedId={line?.id ?? null}
          matches={query.trim() ? matches : null}
          focusStations={focusStations}
          showStepStats={mode === 'typical'}
          onSelect={select}
          overlay={mode === 'trace' && trace ? <TrainMarker geometry={geometry} trace={trace} playback={playback} reduced={reduced} /> : undefined}
        />
        <MapLegend className="max-md:hidden" />
      </section>

      <section aria-label="Stop strip" className={cx(panelClass, 'px-4 py-3 md:col-start-2 md:row-start-2 min-[1180px]:col-span-2')}>
        {mode === 'trace' && line && trace ? <TraceStrip line={line} trace={trace} playback={playback} divergence={divergence} onSeek={seek} onJump={jump} /> : <StopStrip index={index} line={line} focusStations={focusStations} />}
      </section>

      <aside
        aria-label="Line card"
        className={cx(panelClass, 'p-4 md:col-span-2 md:row-start-3 min-[1180px]:col-span-1 min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:max-h-[600px] min-[1180px]:overflow-auto')}
      >
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
            onPlay={togglePlay}
            onStep={step}
            onSpeed={(speed) => playback.set({ speed })}
          />
        ) : (
          <LineCard index={index} line={line} focusedFinding={focusedFinding} onFocusFinding={(at) => setFocus(at === null || !line ? null : { lineId: line.id, at })} onReplay={line && !isUnobserved(line) ? () => onMode('trace') : undefined} />
        )}
        {line && (
          <p className="m-0 mt-4 text-xs">
            <Link to={{ pathname: '/map', search: search.replace(/([?&])line=[^&]*&?/, '$1') }} className="text-accent-fg underline">
              Back to the service map
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[260px_minmax(0,1fr)]" role="status" aria-label="Loading the transit board">
      <div className={cx(panelClass, 'flex flex-col gap-2 p-3.5')}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-surface-3" />
        ))}
      </div>
      <div className={cx(panelClass, 'grid min-h-[320px] place-items-center bg-stage')}>
        <svg viewBox="0 0 400 120" className="w-2/3" aria-hidden="true">
          <path d="M20 60H380M120 60V20M120 60V100" stroke="var(--color-line-strong)" strokeWidth="6" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}

