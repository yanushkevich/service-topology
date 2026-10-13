import { useId, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { ResolvedFlow } from '../../domain/businessFlow';
import type { BusinessFlow, FlowStep, FlowTransition } from '../../domain/types';
import { formatCount, formatMs, formatRate, STEP_THRESHOLDS, windowLabel } from '../../transit/board';
import type { FlowBoardIndex } from '../../transit/flows/flowLayout';
import { flowBudget, stages, type FlowFinding } from '../../transit/flows/flowModel';
import type { FlowStats } from '../../transit/flows/observed';
import type { StepStats } from '../../transit/types';
import { buttonClass, cx, kickerClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { KeyValueRow, SearchField, Kicker } from '../../shared/ui/primitives';
import { POLICY_STATE_LABEL } from '../transit-board/colors';
import { PolicyDiamond, SeverityMark } from '../transit-board/visuals';
import { FlowBadge } from './FlowBadge';
import { stripPageParams } from './flowVisuals';
import { patternLabel } from '../../domain/patterns';

const rowClass =
  'flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[12.5px] text-fg-2 hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-accent-soft aria-[current=page]:text-fg aria-[current=page]:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]';

/** Flow index: search and one row per flow (links: each flow has its own board URL). */
export function FlowList({
  fx,
  selectedId,
  query,
  onQuery,
  matches,
  warnings,
  search,
}: {
  fx: FlowBoardIndex;
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  matches: Set<string>;
  warnings: Map<string, number>;
  search: string;
}) {
  const listed = fx.flows.filter((f) => matches.has(f.id));
  return (
    <div className="flex flex-col gap-3">
      <SearchField label="Find a flow" placeholder="Find a flow, step, service, or event" value={query} onChange={onQuery} />
      <Link to={{ pathname: '/flows', search: stripPageParams(search) }} className={rowClass}>
        <Icon name="flows" />
        <span className="min-w-0 flex-1">All flows</span>
        <span className="text-[10.5px] text-fg-3">catalog</span>
      </Link>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Business flows">
        {listed.map((flow) => (
          <li key={flow.id}>
            <Link to={{ pathname: `/flows/${encodeURIComponent(flow.id)}`, search: stripPageParams(search) }} className={rowClass} aria-current={flow.id === selectedId ? 'page' : undefined}>
              <FlowBadge fx={fx} flowId={flow.id} />
              <span className="min-w-0 flex-1 truncate">{flow.name}</span>
              <span className="text-[10.5px] whitespace-nowrap text-fg-3 tabular-nums">
                {flow.steps.length} steps
                {(warnings.get(flow.id) ?? 0) > 0 && (
                  <span className="ml-1 font-semibold text-warn-fg">
                    !{' '}<span className="sr-only">has warnings</span>
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {listed.length === 0 && (
        <p className="m-0 p-2 text-sm text-fg-3" role="status">
          No flow matches “{query}”. Try a step such as “Capture”, a service, or an event such as “OrderPlaced”.
        </p>
      )}
    </div>
  );
}

const stepTintOf = (step: FlowStep, stats: StepStats | undefined): 'errors' | 'slow' | null => {
  if (!stats) return null;
  if (stats.errorRate > STEP_THRESHOLDS.errorRate) return 'errors';
  if (step.deadlineMs !== undefined && stats.p99Ms > step.deadlineMs) return 'slow';
  return null;
};

/**
 * Flow strip (typical mode): the flow's stages in order (step rank), each with its steps and the
 * transitions leaving them, their conditions, shares, and policies. An ordered list with text for
 * every value: the accessible equivalent of the map.
 */
export function FlowStrip({
  flow,
  stats,
  selectedStep,
  focusSteps,
  onSelectStep,
  serviceName,
  eventName,
}: {
  flow: BusinessFlow;
  stats: FlowStats | null;
  selectedStep: string | null;
  focusSteps: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  serviceName: (id: string) => string;
  eventName: (id: string) => string;
}) {
  const columns = stages(flow);
  const name = (id: string) => flow.steps.find((s) => s.id === id)?.name ?? flow.outcomes.find((o) => o.id === id)?.name ?? id;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Kicker as="h2" mono>
          {flow.name} · {stats ? `typical, ${windowLabel(stats.window)}` : 'declared'}
        </Kicker>
        <Kicker as="span" mono>p99 · share · errors · retries under each step</Kicker>
      </div>
      <div className="overflow-x-auto pb-1">
        <ol aria-label={`Stages of ${flow.name}`} className="m-0 flex min-w-max list-none gap-2 p-0">
          {columns.map((column) => (
            <li key={column.rank} className="flex w-[210px] flex-none flex-col gap-1.5">
              <Kicker as="span" mono>Stage {column.rank + 1}</Kicker>
              {column.steps.map((step) => {
                const s = stats?.steps[step.id];
                const tint = stepTintOf(step, s);
                const out = flow.transitions.filter((t) => t.from === step.id);
                return (
                  <div
                    key={step.id}
                    data-focused={focusSteps.has(step.id) || undefined}
                    className={cx('rounded-lg border px-2 py-1.5', step.kind === 'compensation' ? 'border-dashed border-line-strong' : 'border-line', focusSteps.has(step.id) && 'shadow-[inset_0_0_0_2px_var(--color-warn)]')}
                  >
                    <button
                      type="button"
                      aria-pressed={selectedStep === step.id}
                      onClick={() => onSelectStep(step.id)}
                      className="block w-full rounded text-left aria-pressed:bg-accent-soft"
                    >
                      <span className="block text-xs font-semibold text-fg">{step.name}</span>
                      <span className="block text-[11px] text-fg-3">
                        {serviceName(step.serviceDefinitionId)} · {step.kind}
                        {step.deadlineMs !== undefined ? ` · ≤ ${formatMs(step.deadlineMs)}` : ''}
                      </span>
                      {s && (
                        <span className={cx('block font-mono text-[10.5px]', tint === 'errors' ? 'text-crit-fg' : tint === 'slow' ? 'text-warn-fg' : 'text-fg-2')} data-tint={tint ?? undefined}>
                          p99 {formatMs(s.p99Ms)} · {formatRate(s.share)}
                          {s.errorRate > 0 ? ` · err ${formatRate(s.errorRate)}` : ''}
                          {s.retryRate > 0 ? ` · retry ${formatRate(s.retryRate)}` : ''}
                          {tint ? ` · ${tint}` : ''}
                        </span>
                      )}
                    </button>
                    {out.length > 0 && (
                      <ul className="m-0 mt-1 flex list-none flex-col gap-1 border-t border-line p-0 pt-1" aria-label={`Leaving ${step.name}`}>
                        {out.map((t) => (
                          <TransitionRow key={t.id} t={t} to={name(t.to)} share={stats?.transitions[t.id]} eventName={eventName} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {column.outcomes.map((o) => (
                <div key={o.id} className="rounded-lg border border-line px-2 py-1.5 text-xs">
                  <span className="font-semibold text-fg">⊣ {o.name}</span>
                  <span className="block text-[11px] text-fg-3">
                    outcome · {o.kind}
                    {stats?.outcomes[o.id] !== undefined ? ` · ${formatRate(stats.outcomes[o.id] ?? 0)} of transactions` : ''}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TransitionRow({ t, to, share, eventName }: { t: FlowTransition; to: string; share: number | undefined; eventName: (id: string) => string }) {
  const via = t.via.kind === 'event' ? eventName(t.via.eventTypeId) : t.via.kind === 'call' ? 'call' : 'in-service';
  return (
    <li className="text-[11px] text-fg-2">
      <span className="text-fg">→ {to}</span> <span className="font-mono text-fg-3">{via}</span>
      {t.condition && <span className="text-fg-3"> · if {t.condition}</span>}
      {share !== undefined && <span className="font-mono text-fg-3"> · {formatRate(share)}</span>}
      {t.policies.length > 0 && (
        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
          {t.policies.map((p, i) => (
            <span key={i} className={cx('inline-flex items-center gap-1 font-mono text-[10.5px]', p.state === 'missing' ? 'text-warn-fg' : 'text-fg-3')}>
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <PolicyDiamond stop={p} x={6} y={6} size={7} />
              </svg>
              {p.label}
              <span className="sr-only"> ({patternLabel(p.type)}, {POLICY_STATE_LABEL[p.state ?? 'idle']})</span>
              {p.state === 'missing' && ' · missing'}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/** Flow card (typical mode): what the flow is, its target and budget, outcomes, findings, and the selected step. */
export function FlowCard({
  fx,
  flow,
  resolved,
  stats,
  findings,
  focusedFinding,
  onFocusFinding,
  selectedStep,
  serviceName,
  onReplay,
  actions,
}: {
  fx: FlowBoardIndex;
  flow: BusinessFlow;
  resolved: ResolvedFlow;
  stats: FlowStats | null;
  findings: FlowFinding[];
  focusedFinding: number | null;
  onFocusFinding: (i: number | null) => void;
  selectedStep: FlowStep | null;
  serviceName: (id: string) => string;
  onReplay?: (() => void) | undefined;
  actions?: ReactNode;
}) {
  const { search } = useLocation();
  const shares = new Map(Object.entries(stats?.transitions ?? {}));
  const budget = flowBudget(flow, shares);
  const gaps = resolved.transitions.filter((t) => t.backing.status === 'unbacked' || t.backing.status === 'not-deployed');
  const trigger = flow.trigger.kind === 'call' ? `call from ${flow.trigger.ref ? serviceName(flow.trigger.ref) : 'a client'}` : flow.trigger.kind === 'event' ? `event ${flow.trigger.ref ?? ''}` : flow.trigger.kind;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <FlowBadge fx={fx} flowId={flow.id} large />
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold">{flow.name}</h2>
          <div className={kickerClass}>Business flow</div>
        </div>
      </div>
      {flow.description && <p className="m-0 -mt-2 text-sm text-fg-2">{flow.description}</p>}
      <p className="m-0 -mt-2 text-xs text-fg-3">
        {flow.source.kind === 'imported' ? (
          <>
            Imported from <span className="font-mono">{flow.source.ref}</span> ({flow.source.format}); read-only here.
          </>
        ) : (
          'Authored in this app.'
        )}
      </p>
      {actions}
      {selectedStep && <StepDetail flow={flow} step={selectedStep} stats={stats?.steps[selectedStep.id]} serviceName={serviceName} search={search} />}
      {budget && <FlowBudgetBar budget={budget} />}
      <dl className="m-0">
        <KeyValueRow label="Owner">{[flow.owner, flow.team].filter(Boolean).join(' / ') || '—'}</KeyValueRow>
        <KeyValueRow label="Trigger">{trigger}</KeyValueRow>
        <KeyValueRow label="Target p95">{flow.target?.p95Ms ? formatMs(flow.target.p95Ms) : '—'}</KeyValueRow>
        <KeyValueRow label="Completion target">{flow.target?.completionMs ? formatMs(flow.target.completionMs) : '—'}</KeyValueRow>
        {stats && <KeyValueRow label={`Transactions, ${windowLabel(stats.window)}`}>{formatCount(stats.transactions)}</KeyValueRow>}
        {stats && <KeyValueRow label="Completion p50 / p95">{`${formatMs(stats.completion.p50Ms)} / ${formatMs(stats.completion.p95Ms)}`}</KeyValueRow>}
      </dl>
      <section aria-label="Outcomes">
        <Kicker className="mb-1.5">Outcomes</Kicker>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {flow.outcomes.map((o) => (
            <li key={o.id} className="flex justify-between gap-2">
              <span>
                {o.name} <span className="text-fg-3">({o.kind})</span>
              </span>
              <span className="font-mono text-fg-2">{stats?.outcomes[o.id] !== undefined ? formatRate(stats.outcomes[o.id] ?? 0) : '—'}</span>
            </li>
          ))}
        </ul>
      </section>
      {gaps.length > 0 && (
        <div role="note" className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-fg-2">
          <b className="text-fg">In {resolved.environmentId}:</b>{' '}
          {gaps
            .map((g) => (g.backing.status === 'not-deployed' ? `${flow.steps.find((s) => s.id === g.transition.to)?.name ?? g.transition.to} not deployed (${g.backing.serviceDefinitionIds.map(serviceName).join(', ')})` : g.backing.status === 'unbacked' ? g.backing.reason : ''))
            .filter(Boolean)
            .join('; ')}
          .
        </div>
      )}
      <section aria-label="Findings">
        <Kicker className="mb-1.5">Findings</Kicker>
        {findings.length === 0 ? (
          <p className="m-0 text-sm text-fg-3">Nothing to review on this flow.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {findings.map((f, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={focusedFinding === i}
                  onClick={() => onFocusFinding(focusedFinding === i ? null : i)}
                  className="flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3 aria-pressed:bg-surface-3 aria-pressed:shadow-[inset_0_0_0_1px_var(--color-warn)]"
                >
                  <SeverityMark severity={f.severity} />
                  <span className="text-fg">{f.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {onReplay && (
        <button type="button" className={buttonClass('primary', 'self-start')} onClick={onReplay}>
          Replay a business transaction
        </button>
      )}
    </div>
  );
}

function StepDetail({ flow, step, stats, serviceName, search }: { flow: BusinessFlow; step: FlowStep; stats: StepStats | undefined; serviceName: (id: string) => string; search: string }) {
  const id = useId();
  const compensation = step.compensatedBy ? flow.steps.find((s) => s.id === step.compensatedBy)?.name : undefined;
  const board = new URLSearchParams(stripPageParams(search));
  if (step.entryPoint) board.set('line', step.entryPoint);
  return (
    <section aria-labelledby={id} className="rounded-lg border border-accent-ring bg-accent-soft px-3 py-2">
      <h3 id={id} className="m-0 text-sm font-semibold">
        Step: {step.name}
      </h3>
      <p className="m-0 text-xs text-fg-2">
        {serviceName(step.serviceDefinitionId)} · {step.kind}
        {step.entryPoint ? ` · ${step.entryPoint}` : ''}
        {step.deadlineMs !== undefined ? ` · deadline ${formatMs(step.deadlineMs)}` : ''}
        {compensation ? ` · undone by ${compensation}` : ''}
      </p>
      {stats && (
        <p className="m-0 mt-1 font-mono text-xs text-fg-2">
          p50 {formatMs(stats.p50Ms)} · p99 {formatMs(stats.p99Ms)} · {formatRate(stats.share)} of transactions · errors {formatRate(stats.errorRate)} · retries {formatRate(stats.retryRate)}
        </p>
      )}
      <Link to={{ pathname: `/services/${encodeURIComponent(step.serviceDefinitionId)}/transit`, search: `?${board.toString()}` }} className="mt-1.5 inline-block text-xs text-accent-fg underline">
        Open the {serviceName(step.serviceDefinitionId)} transit board
      </Link>
    </section>
  );
}

function FlowBudgetBar({ budget }: { budget: NonNullable<ReturnType<typeof flowBudget>> }) {
  const id = useId();
  const scale = Math.max(budget.totalMs, budget.targetMs) || 1;
  const pct = (ms: number) => `${(ms / scale) * 100}%`;
  const over = budget.overflowMs > 0;
  const starts = budget.segments.map((_, i) => budget.segments.slice(0, i).reduce((n, x) => n + x.ms, 0));
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5">
      <Kicker id={id}>
        Flow budget
      </Kicker>
      <div className="relative h-3 overflow-hidden rounded-sm bg-surface-3" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 border-r-2 border-fg" style={{ width: pct(budget.targetMs) }} />
        {budget.segments.map((s, i) => {
          const start = starts[i] ?? 0;
          const inside = Math.max(0, Math.min(s.ms, budget.targetMs - start));
          return (
            <span key={s.stepId}>
              <span className="absolute inset-y-0.5 rounded-[2px]" style={{ left: pct(start), width: pct(inside), background: `var(--transit-policy-${i % 2 ? 'bulkhead' : 'timeout'})` }} />
              {s.ms > inside && (
                <span className="absolute inset-y-0.5" style={{ left: pct(start + inside), width: pct(s.ms - inside), background: 'repeating-linear-gradient(135deg, var(--color-warn) 0 4px, transparent 4px 7px)' }} />
              )}
            </span>
          );
        })}
      </div>
      <p className={cx('m-0 text-sm', over ? 'text-warn-fg' : 'text-fg-2')}>
        {over && <SeverityMark severity="warn" />} The typical path may take {formatMs(budget.totalMs)} against a {formatMs(budget.targetMs)} p95 target{over ? `: ${formatMs(budget.overflowMs)} over.` : '.'}
      </p>
      <ol className="m-0 list-none p-0 font-mono text-[11px] text-fg-3">
        {budget.segments.map((s) => (
          <li key={s.stepId}>
            {s.name}: {formatMs(s.ms)} ({s.basis})
          </li>
        ))}
      </ol>
    </section>
  );
}



