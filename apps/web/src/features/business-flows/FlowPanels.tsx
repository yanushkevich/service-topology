import { useId, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ResolvedFlow } from '../../domain/businessFlow';
import type { BusinessFlow, FlowStep, FlowTransition, HealthStatus } from '../../domain/types';
import { typeLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { formatCount, formatMs, formatRate, STEP_THRESHOLDS, windowLabel } from '../../transit/board';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import { flowBudget, stages, type FlowFinding } from '../../transit/flows/flowModel';
import type { FlowStats } from '../../transit/flows/observed';
import type { StepStats } from '../../transit/types';
import { buttonClass, cx, fieldClass, kickerClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { KeyValueRow, SearchField, Kicker } from '../../shared/ui/primitives';
import { POLICY_STATE_LABEL } from '../transit-board/colors';
import { PolicyDiamond, SeverityMark } from '../transit-board/visuals';
import { FlowBadge } from './FlowBadge';
import { stripPageParams } from './flowVisuals';
import { patternLabel } from '../../domain/patterns';
import { ContractView } from '../contracts/ContractView';
import { useEndpointContract } from '../contracts/useEndpointContract';
import { StripScroller } from '../boards/StripScroller';
import type { StepLineRow } from '../../transit/flows/flowLines';
import { StepInside } from './FlowLines';

/**
 * The flow board's index bar (ADR-023): the catalog link, a flow picker, and a step search that
 * highlights matching steps on the swimlane.
 */
export function FlowPicker({
  fx,
  selectedId,
  query,
  onQuery,
  matchCount,
  warnings,
  search,
}: {
  fx: FlowBoardIndex;
  selectedId: string;
  query: string;
  onQuery: (q: string) => void;
  /** Steps matching the query, or null without one. */
  matchCount: number | null;
  warnings: Map<string, number>;
  search: string;
}) {
  const navigate = useNavigate();
  const pickerId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link to={{ pathname: '/flows', search: stripPageParams(search) }} className={buttonClass('ghost')}>
        <Icon name="flows" />
        All flows
      </Link>
      <label htmlFor={pickerId} className="text-sm text-fg-3">
        Flow
      </label>
      <select id={pickerId} className={cx(fieldClass, 'max-w-[320px]')} value={selectedId} onChange={(e) => navigate({ pathname: `/flows/${encodeURIComponent(e.target.value)}`, search: stripPageParams(search) })}>
        {fx.flows.map((flow) => (
          <option key={flow.id} value={flow.id}>
            {fx.codes.get(flow.id)} · {flow.name} · {flow.steps.length} steps{(warnings.get(flow.id) ?? 0) > 0 ? ' · has warnings' : ''}
          </option>
        ))}
      </select>
      <SearchField label="Find a step" placeholder="Find a step, service, or entry point" value={query} onChange={onQuery} className="min-w-[220px] flex-1 md:max-w-[360px]" />
      {matchCount !== null && (
        <span role="status" className="text-xs text-fg-3">
          {matchCount === 0 ? `No step matches “${query}”` : `${matchCount} matching step${matchCount === 1 ? '' : 's'} highlighted`}
        </span>
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
      <StripScroller label={`Stages of ${flow.name}, scrollable`}>
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
      </StripScroller>
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
  selectedStepLine,
  serviceName,
  onReplay,
  actions,
  stores = [],
}: {
  fx: FlowBoardIndex;
  flow: BusinessFlow;
  resolved: ResolvedFlow;
  stats: FlowStats | null;
  findings: FlowFinding[];
  focusedFinding: number | null;
  onFocusFinding: (i: number | null) => void;
  selectedStep: FlowStep | null;
  /** The selected step's line on its service's board, or why it has none (Milestone 13.2). */
  selectedStepLine?: StepLineRow | null;
  serviceName: (id: string) => string;
  onReplay?: (() => void) | undefined;
  actions?: ReactNode;
  /** The data stores the flow's steps use (ADR-027), with those steps. */
  stores?: readonly { store: { id: string; name: string; type: string; health?: HealthStatus | undefined }; stepIds: string[] }[];
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
      {selectedStep && <StepDetail flow={flow} step={selectedStep} line={selectedStepLine ?? null} stats={stats?.steps[selectedStep.id]} serviceName={serviceName} search={search} environmentId={resolved.environmentId} />}
      {budget && <FlowBudgetBar budget={budget} />}
      <dl className="m-0">
        <KeyValueRow label="Owner">{[flow.owner, flow.team].filter(Boolean).join(' / ') || '—'}</KeyValueRow>
        <KeyValueRow label="Trigger">{trigger}</KeyValueRow>
        <KeyValueRow label="Response-time target (p95)">{flow.target?.p95Ms ? formatMs(flow.target.p95Ms) : '—'}</KeyValueRow>
        <KeyValueRow label="Completion target (end to end)">{flow.target?.completionMs ? formatMs(flow.target.completionMs) : '—'}</KeyValueRow>
        {stats && <KeyValueRow label={`Transactions, ${windowLabel(stats.window)}`}>{formatCount(stats.transactions)}</KeyValueRow>}
        {stats && <KeyValueRow label="Completion p50 / p95 (end to end)">{`${formatMs(stats.completion.p50Ms)} / ${formatMs(stats.completion.p95Ms)}`}</KeyValueRow>}
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
      {stores.length > 0 && <DataStores flow={flow} stores={stores} search={search} />}
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

function StepDetail({ flow, step, line, stats, serviceName, search, environmentId }: { flow: BusinessFlow; step: FlowStep; line: StepLineRow | null; stats: StepStats | undefined; serviceName: (id: string) => string; search: string; environmentId: string }) {
  const id = useId();
  const compensation = step.compensatedBy ? flow.steps.find((s) => s.id === step.compensatedBy)?.name : undefined;
  const board = new URLSearchParams(stripPageParams(search));
  if (step.entryPoint) board.set('line', step.entryPoint);
  board.set('flow', flow.id);
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
      {line ? (
        <StepInside row={line} flowId={flow.id} />
      ) : (
        <Link to={{ pathname: `/services/${encodeURIComponent(step.serviceDefinitionId)}/transit`, search: `?${board.toString()}` }} className="mt-1.5 inline-block text-xs text-accent-fg underline">
          Open the {serviceName(step.serviceDefinitionId)} transit board
        </Link>
      )}
      <StepContract step={step} environmentId={environmentId} />
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
        Response-time budget
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
        {over && <SeverityMark severity="warn" />} The synchronous steps of the typical path may take up to {formatMs(budget.totalMs)} against the {formatMs(budget.targetMs)} response-time target (p95)
        {over ? `: ${formatMs(budget.overflowMs)} over.` : '.'}
      </p>
      <p className="m-0 text-xs text-fg-3">Waits and asynchronous hand-offs count toward the completion target, not this budget.</p>
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




/**
 * The data stores the flow touches (ADR-027): each store with its health and the steps whose
 * service uses it, linking to the store on the map. The topology knows stores per service, not per
 * operation, so this is "used by the step's service".
 */
function DataStores({ flow, stores, search }: { flow: BusinessFlow; stores: NonNullable<Parameters<typeof FlowCard>[0]['stores']>; search: string }) {
  const params = new URLSearchParams(stripPageParams(search));
  params.delete('window');
  return (
    <section aria-label="Data stores">
      <Kicker className="mb-1.5">Data stores</Kicker>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {stores.map(({ store, stepIds }) => {
          const to = new URLSearchParams(params);
          to.set('sel', `resource:${store.id}`);
          return (
            <li key={store.id} data-flow-store={store.id} className="flex flex-col">
              <span className="flex items-center gap-1.5">
                {store.health && <StatusShape health={store.health} />}
                <Link to={{ pathname: '/map', search: `?${to.toString()}` }} className="font-mono text-accent-fg underline">
                  {store.name}
                </Link>
                <span className="text-xs text-fg-3">{typeLabel(store.type).toLowerCase()}</span>
              </span>
              <span className="text-xs text-fg-3">used by {stepIds.map((id) => flow.steps.find((s) => s.id === id)?.name ?? id).join(', ')}</span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 mt-1.5 text-xs text-fg-3">From the topology: stores belong to services, so each is listed for every step its service runs.</p>
    </section>
  );
}

/** The step's entry point as an endpoint contract (ADR-029): OpenAPI for HTTP, a note otherwise. */
function StepContract({ step, environmentId }: { step: FlowStep; environmentId: string }) {
  const state = useEndpointContract(step.serviceDefinitionId, step.entryPoint, environmentId);
  return (
    <section aria-label={`Contract of ${step.name}`} className="mt-2.5 border-t border-accent-ring pt-2">
      <Kicker className="mb-1.5">Contract</Kicker>
      <ContractView state={state} compact />
    </section>
  );
}
