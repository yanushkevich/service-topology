import { useId, type ReactNode } from 'react';
import { budgetFor, formatCount, formatMs, formatRate, GROUP_LABELS, isUnobserved, type BoardIndex } from '../../transit/board';
import type { Finding, Line, SourceStatus } from '../../transit/types';
import { cx, kickerClass } from '../../shared/ui/classes';
import { LineBadge, ProvenanceTag, SeverityMark } from './visuals';

/**
 * Line card (spec "Screen layout", "Typical route mode"): with a line selected, its signature,
 * budget bar, stats, provenance, patterns, and findings; otherwise where the map comes from.
 */
export function LineCard({
  index,
  line,
  focusedFinding,
  onFocusFinding,
}: {
  index: BoardIndex;
  line: Line | null;
  focusedFinding: number | null;
  onFocusFinding: (finding: number | null) => void;
}) {
  const failed = index.board.sources.filter((s) => s.status === 'failed');
  if (!line) {
    return (
      <div className="flex flex-col gap-4">
        {failed.length > 0 && <DataGaps failed={failed} />}
        <Block title="Where the map comes from">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-2 text-sm">
            <Source tag="declared" title="Lines" text="Entry points from API specs (proto, OpenAPI, AsyncAPI) and the scheduler config" />
            <Source tag="observed" title="Routes and timings" text={`Built from traces, ${index.board.window}`} />
            <Source tag="declared" title="Policy stops" text="Resilience config and mesh rules; fire rates from spans" />
            <Source tag="inferred" title="Dashed stations and routes" text="From a code scan, because they emit no spans" />
          </dl>
        </Block>
        <Block title="How to read it">
          <p className="m-0 text-[12.5px] text-fg-2">
            Each endpoint, consumed event, or job is one line. Lines that run side by side share code. Diamonds are the policies a call passes before it reaches a dependency: solid when
            exercised, outlined when never exercised, dashed amber when an expected policy is missing, and grey with a question mark when its config could not be read.
          </p>
        </Block>
      </div>
    );
  }

  const unobserved = isUnobserved(line);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <LineBadge index={index} lineId={line.id} code={line.code} large />
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold">
            <span className="sr-only">Line {line.code}:</span>{' '}
            {line.name}
          </h2>
          <div className={kickerClass}>{GROUP_LABELS[line.group]}</div>
        </div>
      </div>
      <p className="m-0 -mt-2 font-mono text-[11.5px] break-words text-fg-2">{line.signature}</p>
      {failed.length > 0 && <DataGaps failed={failed} />}
      {unobserved && (
        <p className="m-0 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-fg-2">
          No traces in the {index.board.window}: this card lists declared steps only, and trace replay is not possible for this line.
        </p>
      )}
      <BudgetBar index={index} line={line} />
      <dl className="m-0">
        <Kv k="Caller" v={line.caller} />
        <Kv k="Deadline" v={line.deadlineMs ? formatMs(line.deadlineMs) : '—'} />
        <Kv k="p50 / p95" v={`${formatMs(line.stats.p50Ms)} / ${formatMs(line.stats.p95Ms)}`} />
        <Kv k="Errors" v={formatRate(line.stats.errorRate)} />
        <Kv k="Calls per day" v={line.stats.callsPerDay ? formatCount(line.stats.callsPerDay) : '—'} />
        <Kv k={`Traces, ${index.board.window}`} v={formatCount(line.stats.traces)} />
      </dl>
      <Block title="Where this line comes from">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-2 text-sm">
          <Source tag={line.provenance.entry.kind} text={`Entry point in ${line.provenance.entry.detail}`} />
          <Source tag={line.provenance.route.kind} text={line.provenance.route.kind === 'inferred' ? `Route from a ${line.provenance.route.detail}; no traces carry this work` : `Route in ${formatCount(line.stats.traces)} traces, ${index.board.window}`} />
          <Source tag="declared" text="Policies from resilience config" />
        </dl>
      </Block>
      <Block title="Patterns on this line">
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {line.patterns.map((p) => (
            <li key={p} className="inline-flex h-[22px] items-center rounded-full border border-line-strong px-2.5 text-[11px] text-fg-2">
              {p}
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Findings">
        {line.findings.length === 0 ? (
          <p className="m-0 text-sm text-fg-3">Nothing to review on this line.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {sorted(line.findings).map(({ finding, at }) => (
              <li key={at}>
                <button
                  type="button"
                  aria-pressed={focusedFinding === at}
                  onClick={() => onFocusFinding(focusedFinding === at ? null : at)}
                  className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3 aria-pressed:bg-surface-3 aria-pressed:shadow-[inset_0_0_0_1px_var(--color-warn)]"
                >
                  <SeverityMark severity={finding.severity} />
                  <span className="text-fg">{finding.text}</span>
                  {finding.fix && <span className="text-xs text-fg-2">Fix: {finding.fix}</span>}
                  <span className="sr-only">{focusedFinding === at ? 'Highlighted on the map and the strip.' : 'Highlight its stops on the map and the strip.'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <p className="m-0 text-xs text-fg-3">Trace replay is not available yet (planned for a later phase).</p>
    </div>
  );
}

const SEVERITY_ORDER: Record<Finding['severity'], number> = { warn: 0, info: 1, ok: 2 };

/** Findings in severity order, keeping their original position as a stable id. */
function sorted(findings: Finding[]) {
  return findings.map((finding, at) => ({ finding, at })).sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || a.at - b.at);
}

/** Deadline with downstream timeouts stacked in route order; overflow drawn past the end in amber. */
function BudgetBar({ index, line }: { index: BoardIndex; line: Line }) {
  const budget = budgetFor(index, line);
  const titleId = useId();
  if (!budget) return null;
  const scale = Math.max(budget.totalMs, budget.deadlineMs) || 1;
  const pct = (ms: number) => `${(ms / scale) * 100}%`;
  const over = budget.overflowMs > 0;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1.5">
      <h3 id={titleId} className={cx(kickerClass, 'm-0 font-normal')}>
        Timeout budget
      </h3>
      <div className="relative h-3 overflow-hidden rounded-sm bg-surface-3" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 border-r-2 border-fg" style={{ width: pct(budget.deadlineMs) }} />
        {budget.segments.reduce<{ left: number; nodes: ReactNode[] }>(
          (acc, s, i) => {
            const inside = Math.max(0, Math.min(s.ms, budget.deadlineMs - acc.left));
            acc.nodes.push(
              <div key={s.clientId} className="absolute inset-y-0.5 rounded-[2px]" style={{ left: pct(acc.left), width: pct(inside), background: `var(--transit-policy-${i % 2 ? 'bulkhead' : 'timeout'})` }} />,
            );
            if (s.ms > inside) {
              acc.nodes.push(
                <div
                  key={`${s.clientId}-over`}
                  className="absolute inset-y-0.5"
                  style={{ left: pct(acc.left + inside), width: pct(s.ms - inside), background: 'repeating-linear-gradient(135deg, var(--color-warn) 0 4px, transparent 4px 7px)' }}
                />,
              );
            }
            acc.left += s.ms;
            return acc;
          },
          { left: 0, nodes: [] },
        ).nodes}
      </div>
      <p className={cx('m-0 text-sm', over ? 'text-warn-fg' : 'text-fg-2')}>
        {over && <SeverityMark severity="warn" />} Downstream timeouts add up to {formatMs(budget.totalMs)} against a {formatMs(budget.deadlineMs)} deadline
        {over ? `: ${formatMs(budget.overflowMs)} over.` : '.'}
        {budget.uncounted > 0 && ` ${budget.uncounted} client${budget.uncounted === 1 ? '' : 's'} not counted: config not loaded.`}
      </p>
      <ol className="m-0 list-none p-0 font-mono text-[11px] text-fg-3">
        {budget.segments.map((s) => (
          <li key={s.clientId}>
            {s.name}: {formatMs(s.timeoutMs)}
            {s.attempts > 1 ? ` × ${s.attempts} attempts = ${formatMs(s.ms)}` : ''}
          </li>
        ))}
      </ol>
    </section>
  );
}

function DataGaps({ failed }: { failed: SourceStatus[] }) {
  return (
    <div className="rounded-lg border border-warn px-3 py-2 text-sm" role="note">
      <b className="text-warn-fg">Data gaps.</b> <span className="text-fg-2">Could not load: {failed.map((s) => s.label).join(', ')}. Policies from these sources show as unknown, not missing.</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={cx(kickerClass, 'm-0 mb-2 font-normal')}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-line py-[5px] text-sm">
      <dt className="text-fg-3">{k}</dt>
      <dd className="m-0 text-right font-mono tabular-nums">{v}</dd>
    </div>
  );
}

function Source({ tag, title, text }: { tag: 'declared' | 'observed' | 'inferred'; title?: string; text: string }) {
  return (
    <>
      <dt>
        <ProvenanceTag kind={tag} />
      </dt>
      <dd className="m-0">
        {title && <b className="block font-medium text-fg">{title}</b>}
        <span className="text-[11.5px] text-fg-3">{text}</span>
      </dd>
    </>
  );
}
