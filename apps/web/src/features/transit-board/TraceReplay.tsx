import { Kicker } from '../../shared/ui/primitives';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { formatMs, type BoardIndex } from '../../transit/board';
import type { MapGeometry } from '../../transit/layout';
import { activeSteps, type Divergence, type SampleReason } from '../../transit/trace';
import type { Line, TraceDetail, TraceStep, TraceSummary } from '../../transit/types';
import { buttonClass, cx, fieldClass, kickerClass } from '../../shared/ui/classes';
import { PlaybackControls } from '../boards/PlaybackControls';
import { usePlayback, type Playback } from '../boards/playback';
import { LineBadge } from './visuals';
import { StripScroller } from '../boards/StripScroller';

const STATUS_WORD: Record<TraceStep['status'], string> = { ok: 'ok', warn: 'warning', fail: 'failed' };
const TRACE_WORD: Record<TraceSummary['status'], string> = { ok: 'ok', slow: 'slow', failed: 'failed' };
const statusColor = (status: TraceStep['status'] | TraceSummary['status']) =>
  status === 'fail' || status === 'failed' ? 'var(--color-crit)' : status === 'warn' || status === 'slow' ? 'var(--color-warn)' : 'var(--color-accent)';
const statusText = (status: TraceStep['status'] | TraceSummary['status']) =>
  status === 'fail' || status === 'failed' ? 'text-crit-fg' : status === 'warn' || status === 'slow' ? 'text-warn-fg' : 'text-ok-fg';

/** Where a step sits on the map: its station or policy stop; null for off-map spans. */
function pointOf(geometry: MapGeometry, step: TraceStep): { x: number; y: number } | null {
  if (step.offMap) return null;
  return geometry.stations.find((s) => s.id === step.at) ?? geometry.stops.find((s) => s.id === step.at) ?? null;
}

/**
 * The train (spec "Playback"): a marker per running step that moves along the selected line. It
 * bounces back to the retry diamond on retries, takes the spur on a fallback, and turns red and
 * stops on an error. With reduced motion it jumps from step to step instead of gliding.
 */
export function TrainMarker({ geometry, trace, playback, reduced }: { geometry: MapGeometry; trace: TraceDetail; playback: Playback; reduced: boolean }) {
  const active = usePlayback(playback, (s) =>
    activeSteps(trace.steps, s.t, s.step)
      .map((step) => trace.steps.indexOf(step))
      .join(','),
  );
  const steps = active
    .split(',')
    .filter(Boolean)
    .map((i) => trace.steps[Number(i)])
    .filter((s): s is TraceStep => Boolean(s));
  return (
    <>
      {steps.map((step, slot) => {
        const p = pointOf(geometry, step);
        if (!p) return null;
        const color = statusColor(step.status);
        return (
          <g
            key={slot}
            data-train={step.at}
            data-status={step.status}
            style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: reduced ? 'none' : 'transform 220ms ease-out' }}
          >
            <circle r={18} fill="none" stroke={color} strokeWidth={2} opacity={0.8} />
            <circle r={6} fill={color} stroke="var(--color-stage)" strokeWidth={2} />
          </g>
        );
      })}
    </>
  );
}

/**
 * The strip as a timeline (spec "Scrubbing"): one button per step (click to jump), a slider to
 * scrub, retries as repeated steps with attempt numbers, fan-out as stacked steps, off-map spans
 * flagged, lost context drawn as a dashed gap, and the divergence point marked.
 */
export function TraceStrip({
  line,
  trace,
  playback,
  divergence,
  onSeek,
  onJump,
}: {
  line: Line;
  trace: TraceDetail;
  playback: Playback;
  divergence: Divergence | null;
  onSeek: (t: number) => void;
  onJump: (step: number) => void;
}) {
  const current = usePlayback(playback, (s) => s.step);
  const t = usePlayback(playback, (s) => s.t);
  const sliderId = useId();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const element = list.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  // Consecutive parallel steps share one column (a fork).
  const columns: { indexes: number[] }[] = [];
  trace.steps.forEach((step, i) => {
    const last = columns.at(-1);
    const previous = trace.steps[i - 1];
    if (last && step.parallel && previous?.parallel === step.parallel && step.startMs === previous.startMs) last.indexes.push(i);
    else columns.push({ indexes: [i] });
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Kicker as="h2" mono>
          Line {line.code} · trace {trace.summary.traceId}
          {trace.summary.businessKey ? ` · ${trace.summary.businessKey}` : ''}
        </Kicker>
        <Kicker as="span" mono>timings from this request</Kicker>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={sliderId} className="text-xs whitespace-nowrap text-fg-3">
          Playback position
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={trace.summary.durationMs}
          step={1}
          value={Math.min(t, trace.summary.durationMs)}
          aria-valuetext={`${formatMs(t)} of ${formatMs(trace.summary.durationMs)}: ${trace.steps[current]?.label ?? ''}`}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-fg-2 tabular-nums">
          {formatMs(t)} / {formatMs(trace.summary.durationMs)}
        </span>
      </div>
      <StripScroller label={`Steps of trace ${trace.summary.traceId}, scrollable`}>
        <ol ref={list} aria-label={`Steps of trace ${trace.summary.traceId}`} className="m-0 flex min-w-max list-none gap-1 p-0">
          {columns.map((column) => (
            <li key={column.indexes.join('-')} className={cx('flex flex-col gap-1', column.indexes.length > 1 && 'rounded-lg border border-dashed border-line-strong p-1')}>
              {column.indexes.length > 1 && <span className="px-1 font-mono text-2xs text-fg-3 uppercase">in parallel</span>}
              {column.indexes.map((i) => {
                const step = trace.steps[i];
                if (!step) return null;
                const isCurrent = i === current;
                const done = i <= current;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-current={isCurrent ? 'step' : undefined}
                    data-divergence={divergence?.stepIndex === i || undefined}
                    onClick={() => onJump(i)}
                    className={cx(
                      'flex w-[150px] flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left text-xs',
                      step.contextLost ? 'border-dashed border-warn' : step.offMap ? 'border-dashed border-line-strong' : 'border-line',
                      isCurrent ? 'bg-surface-3 shadow-[inset_0_0_0_2px_var(--color-accent)]' : done ? 'bg-surface-2' : 'bg-transparent',
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-2xs">
                      <svg width="8" height="8" aria-hidden="true">
                        <circle cx="4" cy="4" r="4" fill={statusColor(step.status)} />
                      </svg>
                      <span className="text-fg-2">{STATUS_WORD[step.status]}</span>
                      <span className="ml-auto text-fg-3 tabular-nums">+{formatMs(step.startMs)}</span>
                    </span>
                    <span className="line-clamp-2 text-fg">{step.label}</span>
                    <span className="flex flex-wrap gap-1 font-mono text-2xs text-fg-3">
                      {step.durationMs > 0 && <span>{formatMs(step.durationMs)}</span>}
                      {step.attempt && <span>attempt {step.attempt}</span>}
                      {step.offMap && <span className="text-fg-2">off-map span</span>}
                      {step.contextLost && <span className="text-warn-fg">context lost</span>}
                      {divergence?.stepIndex === i && <span className="text-warn-fg">diverges from typical</span>}
                    </span>
                  </button>
                );
              })}
            </li>
          ))}
        </ol>
      </StripScroller>
    </div>
  );
}

const time = (iso: string) => `${iso.slice(11, 16)} UTC`;

/**
 * Line card in trace mode (spec "Picking a trace", "Playback", "Divergence"): sample requests, a
 * trace-id field, playback controls, the active step's attributes, and how this trace differs
 * from the typical route.
 */
export function TraceCard({
  index,
  line,
  samples,
  tracesStatus,
  trace,
  traceError,
  playback,
  divergence,
  onPick,
  onOpenId,
  onPlay,
  onStep,
}: {
  index: BoardIndex;
  line: Line;
  samples: { trace: TraceSummary; reasons: SampleReason[] }[];
  tracesStatus: 'loading' | 'ready' | 'error';
  trace: TraceDetail | null;
  traceError: string | null;
  playback: Playback;
  divergence: Divergence | null;
  onPick: (traceId: string) => void;
  onOpenId: (traceId: string) => void;
  onPlay: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const [pasted, setPasted] = useState('');
  const pasteId = useId();
  const ended = usePlayback(playback, (s) => (trace ? s.t >= trace.summary.durationMs : false));
  const progress = usePlayback(playback, (s) => (trace ? Math.min(100, Math.round((s.t / Math.max(1, trace.summary.durationMs)) * 1000) / 10) : 0));
  const current = usePlayback(playback, (s) => s.step);
  const step = trace?.steps[current];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pasted.trim()) onOpenId(pasted.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <LineBadge index={index} lineId={line.id} code={line.code} large />
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold">
            <span className="sr-only">Line {line.code}:</span> {line.name}
          </h2>
          <div className={kickerClass}>Trace replay</div>
        </div>
      </div>

      <section aria-label="Sample requests">
        <Kicker className="mb-1.5">Sample requests</Kicker>
        {tracesStatus === 'loading' ? (
          <p className="m-0 text-sm text-fg-3" role="status">
            Loading traces…
          </p>
        ) : samples.length === 0 ? (
          <p className="m-0 text-sm text-fg-3">No traces for this line in the window. Choose a longer window or paste a trace ID.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {samples.map(({ trace: summary, reasons }) => (
              <li key={summary.traceId}>
                <button
                  type="button"
                  aria-pressed={trace?.summary.traceId === summary.traceId}
                  onClick={() => onPick(summary.traceId)}
                  className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3 aria-pressed:bg-accent-soft aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]"
                >
                  <span className="rounded-full border px-1.5 font-mono text-2xs text-fg" style={{ borderColor: statusColor(summary.status) }}>
                    {TRACE_WORD[summary.status]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono">{summary.businessKey ?? summary.traceId}</span>
                    <span className="block truncate text-fg-3">
                      {reasons.join(' · ')} · {time(summary.startedAt)}
                    </span>
                  </span>
                  <span className="font-mono text-fg-2 tabular-nums">{formatMs(summary.durationMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <label htmlFor={pasteId} className="sr-only">
            Trace ID
          </label>
          <input id={pasteId} className={cx(fieldClass, 'flex-1 font-mono text-xs')} placeholder="Paste a trace ID" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button type="submit" className={buttonClass('secondary')}>
            Open
          </button>
        </form>
        {traceError && (
          <p className="m-0 mt-1.5 text-sm text-crit-fg" role="alert">
            {traceError}
          </p>
        )}
      </section>

      {trace && (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs">{trace.summary.traceId}</span>
              <span className={cx('font-mono text-xs whitespace-nowrap', statusText(trace.summary.status))}>
                {TRACE_WORD[trace.summary.status]} · {formatMs(trace.summary.durationMs)}
                {line.deadlineMs ? ` / ${formatMs(line.deadlineMs)} deadline` : ''}
              </span>
            </div>
            <PlaybackControls playback={playback} ended={ended} onPlay={onPlay} onStep={onStep}>
              <div className="h-1 min-w-[60px] flex-1 overflow-hidden rounded-sm bg-line-strong" aria-hidden="true">
                <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            </PlaybackControls>
          </div>

          {step && (
            <section aria-label="Active step" aria-live="polite">
              <Kicker className="mb-1.5">Active step</Kicker>
              <p className="m-0 text-sm text-fg">{step.label}</p>
              <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
                {[
                  ['status', STATUS_WORD[step.status]],
                  ['started', `+${formatMs(step.startMs)}`],
                  ['duration', formatMs(step.durationMs)],
                  ...(step.attempt ? [['attempt', String(step.attempt)]] : []),
                  ...Object.entries(step.attributes ?? {}),
                  ['span', step.spanId],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-3">{k}</dt>
                    <dd className={cx('m-0 break-all', k === 'status' && statusText(step.status))}>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section aria-label="Compared with typical">
            <Kicker className="mb-1.5">Compared with typical</Kicker>
            <p className={cx('m-0 text-sm', divergence ? 'text-fg' : 'text-fg-2')}>{divergence ? divergence.text : 'This request followed the typical route without retries or fallbacks.'}</p>
            {trace.steps.some((s) => s.offMap) && <p className="m-0 mt-1.5 text-xs text-fg-2">Some spans are on no station of the map; they are flagged “off-map” so the station catalogue can be extended.</p>}
            {trace.steps.some((s) => s.contextLost) && <p className="m-0 mt-1.5 text-xs text-warn-fg">Trace context was lost on the way: the gap is shown as dashed, not bridged.</p>}
          </section>
        </>
      )}

      <p className="m-0 text-xs text-fg-3">Keys: T switches mode · Space plays or pauses · Left and Right step · [ and ] switch sample.</p>
    </div>
  );
}
