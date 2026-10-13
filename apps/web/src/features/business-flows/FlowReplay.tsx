import { Kicker } from '../../shared/ui/primitives';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import type { BusinessFlow } from '../../domain/types';
import { formatMs } from '../../transit/board';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import { isCompressed, type FlowTransaction, type TxSampleReason, type TxStep } from '../../transit/flows/observed';
import { buttonClass, cx, fieldClass, kickerClass } from '../../shared/ui/classes';
import { PlaybackControls } from '../boards/PlaybackControls';
import { usePlayback, type Playback } from '../boards/playback';
import { FlowBadge } from './FlowBadge';
import { stripPageParams } from './flowVisuals';

const WORD: Record<TxStep['status'], string> = { ok: 'ok', warn: 'warning', fail: 'failed' };
const color = (s: TxStep['status']) => (s === 'fail' ? 'var(--color-crit)' : s === 'warn' ? 'var(--color-warn)' : 'var(--color-accent)');

/**
 * The transaction timeline (spec §5): a slider to scrub and one button per step. Waits are
 * compressed with their real duration labelled; uncorrelated steps are dashed gaps; redeliveries,
 * dead-letter parking, compensation, and the divergence point are named.
 */
export function TxStrip({ flow, tx, playback, divergence, onSeek, onJump }: { flow: BusinessFlow; tx: FlowTransaction; playback: Playback; divergence: { stepIndex: number } | null; onSeek: (t: number) => void; onJump: (i: number) => void }) {
  const current = usePlayback(playback, (s) => s.step);
  const t = usePlayback(playback, (s) => s.t);
  const total = Math.max(...tx.steps.map((s) => s.displayStartMs + s.displayDurationMs), 1);
  const sliderId = useId();
  const list = useRef<HTMLOListElement>(null);
  const { search } = useLocation();
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  const name = (id: string) => flow.steps.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Kicker as="h2" mono>
          {flow.name} · {tx.key} · {formatMs(tx.durationMs)} end to end
        </Kicker>
        <Kicker as="span" mono>waits compressed, real time labelled</Kicker>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={sliderId} className="text-xs whitespace-nowrap text-fg-3">
          Replay position
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={total}
          step={1}
          value={Math.min(t, total)}
          aria-valuetext={`${tx.steps[current]?.label ?? ''} (step ${current + 1} of ${tx.steps.length})`}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-fg-2 tabular-nums">
          step {current + 1} / {tx.steps.length}
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <ol ref={list} aria-label={`Steps of ${tx.key}`} className="m-0 flex min-w-max list-none gap-1 p-0">
          {tx.steps.map((step, i) => {
            const isCurrent = i === current;
            const drill = step.trace;
            const boardSearch = new URLSearchParams(stripPageParams(search));
            if (drill) {
              boardSearch.set('line', drill.lineId);
              boardSearch.set('mode', 'trace');
              boardSearch.set('trace', drill.traceId);
            }
            return (
              <li key={i} className="flex w-[160px] flex-none flex-col gap-1">
                <button
                  type="button"
                  aria-current={isCurrent ? 'step' : undefined}
                  data-divergence={divergence?.stepIndex === i || undefined}
                  data-correlated={step.correlated ? undefined : 'false'}
                  onClick={() => onJump(i)}
                  className={cx(
                    'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left text-xs',
                    !step.correlated ? 'border-dashed border-warn' : step.compensation ? 'border-dashed border-line-strong' : 'border-line',
                    isCurrent ? 'bg-surface-3 shadow-[inset_0_0_0_2px_var(--color-accent)]' : i <= current ? 'bg-surface-2' : 'bg-transparent',
                  )}
                >
                  <span className="flex items-center gap-1.5 font-mono text-2xs">
                    <svg width="8" height="8" aria-hidden="true">
                      <circle cx="4" cy="4" r="4" fill={color(step.status)} />
                    </svg>
                    <span className="text-fg-2">{WORD[step.status]}</span>
                    <span className="ml-auto text-fg-3 tabular-nums">+{formatMs(step.startMs)}</span>
                  </span>
                  {step.label !== name(step.stepId) && <span className="text-fg-3">{name(step.stepId)}</span>}
                  <span className="line-clamp-3 text-fg">{step.label}</span>
                  <span className="flex flex-wrap gap-1 font-mono text-2xs text-fg-3">
                    {step.durationMs > 0 && <span>{formatMs(step.durationMs)}{isCompressed(step) ? ' (compressed)' : ''}</span>}
                    {step.attempt && <span>attempt {step.attempt}</span>}
                    {step.redelivery && <span>redelivery {step.redelivery}</span>}
                    {step.deadLetter && <span className="text-warn-fg">{step.deadLetter === 'parked' ? 'parked on dead-letter queue' : 'dropped: no dead-letter queue'}</span>}
                    {step.compensation && <span>undo</span>}
                    {step.parallel && <span>in parallel</span>}
                    {!step.correlated && <span className="text-warn-fg">not correlated</span>}
                    {divergence?.stepIndex === i && <span className="text-warn-fg">diverges from typical</span>}
                  </span>
                </button>
                {drill && (
                  <Link to={{ pathname: `/services/${drill.serviceDefinitionId}/transit`, search: `?${boardSearch.toString()}` }} className="px-1 text-[11px] text-accent-fg underline">
                    Open this step’s trace
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

const time = (iso: string) => `${iso.slice(11, 16)} UTC`;

/** The flow card in replay mode: samples, a business-key field, controls, the active step, and the difference from typical. */
export function TxCard({
  fx,
  flow,
  samples,
  loading,
  tx,
  txError,
  playback,
  divergence,
  onPick,
  onPlay,
  onStep,
}: {
  fx: FlowBoardIndex;
  flow: BusinessFlow;
  samples: { tx: FlowTransaction; reasons: TxSampleReason[] }[];
  loading: boolean;
  tx: FlowTransaction | null;
  txError: string | null;
  playback: Playback;
  divergence: { text: string } | null;
  onPick: (key: string) => void;
  onPlay: () => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const [typed, setTyped] = useState('');
  const keyId = useId();
  const current = usePlayback(playback, (s) => s.step);
  const ended = usePlayback(playback, (s) => (tx ? s.step >= tx.steps.length - 1 && !s.playing && s.t > 0 : false));
  const step = tx?.steps[current];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) onPick(typed.trim());
  };
  const outcome = tx && flow.outcomes.find((o) => o.id === tx.outcomeId);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <FlowBadge fx={fx} flowId={flow.id} large />
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold">{flow.name}</h2>
          <div className={kickerClass}>Transaction replay</div>
        </div>
      </div>
      <section aria-label="Sample transactions">
        <Kicker className="mb-1.5">Sample transactions</Kicker>
        {loading ? (
          <p className="m-0 text-sm text-fg-3" role="status">
            Loading transactions…
          </p>
        ) : samples.length === 0 ? (
          <p className="m-0 text-sm text-fg-3">No transactions in the window. Choose a longer window or enter a business key.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {samples.map(({ tx: sample, reasons }) => (
              <li key={sample.key}>
                <button
                  type="button"
                  aria-pressed={tx?.key === sample.key}
                  onClick={() => onPick(sample.key)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-3 aria-pressed:bg-accent-soft aria-pressed:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono">{sample.key}</span>
                    <span className="block truncate text-fg-3">
                      {reasons.join(' · ')} · {flow.outcomes.find((o) => o.id === sample.outcomeId)?.name} · {time(sample.startedAt)}
                    </span>
                  </span>
                  <span className="font-mono text-fg-2 tabular-nums">{formatMs(sample.durationMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <label htmlFor={keyId} className="sr-only">
            Business key
          </label>
          <input id={keyId} className={cx(fieldClass, 'flex-1 font-mono text-xs')} placeholder="Business key, e.g. order 4486" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className={buttonClass('secondary')}>
            Open
          </button>
        </form>
        {txError && (
          <p className="m-0 mt-1.5 text-sm text-crit-fg" role="alert">
            {txError}
          </p>
        )}
      </section>
      {tx && (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-xs">{tx.key}</span>
              <span className="font-mono text-xs text-fg-2">
                {outcome?.name} · {formatMs(tx.durationMs)}
              </span>
            </div>
            <PlaybackControls playback={playback} ended={ended} onPlay={onPlay} onStep={onStep} />
          </div>
          {step && (
            <section aria-label="Active step" aria-live="polite">
              <Kicker className="mb-1.5">Active step</Kicker>
              <p className="m-0 text-sm text-fg">{step.label}</p>
              <p className="m-0 mt-1 font-mono text-xs text-fg-2">
                {WORD[step.status]} · +{formatMs(step.startMs)} · {formatMs(step.durationMs)}
                {isCompressed(step) ? ' (shown compressed)' : ''}
                {step.attempt ? ` · attempt ${step.attempt}` : ''}
                {step.redelivery ? ` · redelivery ${step.redelivery}` : ''}
                {step.correlated ? '' : ' · not correlated'}
              </p>
            </section>
          )}
          <section aria-label="Compared with typical">
            <Kicker className="mb-1.5">Compared with typical</Kicker>
            <p className={cx('m-0 text-sm', divergence ? 'text-fg' : 'text-fg-2')}>{divergence ? divergence.text : 'This transaction followed the typical path without retries or failures.'}</p>
            {tx.steps.some((s) => !s.correlated) && <p className="m-0 mt-1.5 text-xs text-warn-fg">Some steps are not correlated: no trace carries the business key there, so the gap is shown, not bridged.</p>}
            {tx.compensated && <p className="m-0 mt-1.5 text-xs text-fg-2">Compensation ran along the undo track (dashed on the map).</p>}
          </section>
        </>
      )}
      <p className="m-0 text-xs text-fg-3">Keys: T switches mode · Space plays or pauses · Left and Right step · [ and ] switch sample.</p>
    </div>
  );
}
