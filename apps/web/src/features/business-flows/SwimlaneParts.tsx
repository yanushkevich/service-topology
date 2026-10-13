import { BaseEdge, EdgeLabelRenderer, Handle, Position, type EdgeProps, type NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { patternLabel } from '../../domain/patterns';
import type { FlowOutcomeKind, FlowStepKind } from '../../domain/types';
import { formatMs } from '../../transit/board';
import { cx, kickerClass } from '../../shared/ui/classes';
import { POLICY_STATE_LABEL, policySummary } from '../transit-board/colors';
import { StatusShape } from '../../shared/ui/StatusShape';
import { PolicyDiamond } from '../transit-board/visuals';
import { stripPageParams } from './flowVisuals';
import type { SwimlaneLane } from '../../transit/flows/swimlane';
import type { LaneNode, OutcomeNode, RoutedEdge, StepNode } from './swimlaneAdapter';

/**
 * Nodes and the edge of the flow swimlane (ADR-023). State is in data attributes (`data-emphasis`,
 * `data-train`, `data-divergence`), which style the elements and serve as test hooks.
 */

const hidden = 'pointer-events-none !min-h-0 !min-w-0 !border-0 !bg-transparent opacity-0';

/** A service lane: a band with a rule underneath. Its caption is in the frozen column (LaneCaptions). */
export const LaneView = memo(function LaneView({ data }: NodeProps<LaneNode>) {
  const outcomes = data.lane.id === '__outcomes__';
  return <div data-lane={data.lane.id} className={cx('h-full border-b border-line', outcomes && 'bg-surface-0/60')} style={{ width: data.width }} />;
});

/**
 * Lane captions in a column frozen to the left edge: they follow the canvas's vertical pan and
 * zoom, and stay visible however far the flow is panned sideways.
 */
export function LaneCaptions({ lanes, transform }: { lanes: readonly SwimlaneLane[]; transform: readonly [number, number, number] }) {
  const [, ty, zoom] = transform;
  return (
    <ol className="pointer-events-none absolute inset-y-0 left-0 z-5 m-0 w-[104px] list-none overflow-hidden border-r border-line bg-stage p-0 max-md:w-[84px]" aria-hidden="true">
      {lanes.map((lane) => (
        <li key={lane.id} data-lane-caption={lane.id} className={cx(kickerClass, 'absolute inset-x-0 border-b border-line px-2.5 pt-2 leading-snug')} style={{ top: ty + lane.y * zoom, height: lane.height * zoom }}>
          {lane.label}
        </li>
      ))}
    </ol>
  );
}

const KIND_GLYPH: Record<FlowStepKind, string> = { task: '', decision: '◆', wait: '◷', compensation: '↺', manual: '✋' };
const TRAIN_RING: Record<'ok' | 'warn' | 'fail', string> = { ok: 'border-accent', warn: 'border-warn', fail: 'border-crit' };

/** A business step: name, kind, deadline, service and entry point, and the flows it is shared with. */
export const StepView = memo(function StepView({ data }: NodeProps<StepNode>) {
  const { step, serviceName, alsoIn, stores, emphasis, selected, train, divergence } = data;
  return (
    <div
      data-step={step.id}
      data-kind={step.kind}
      data-emphasis={emphasis}
      data-selected={selected || undefined}
      data-train={train ? step.id : undefined}
      data-status={train?.status}
      data-divergence={divergence || undefined}
      className={cx(
        'relative flex h-full w-full cursor-pointer flex-col justify-center gap-px rounded-lg border bg-surface-1 px-2.5 text-left shadow-sm transition-opacity',
        selected ? 'border-accent shadow-[0_0_0_2px_var(--color-accent)]' : 'border-line-strong hover:border-fg-3',
        step.kind === 'compensation' && 'border-dashed',
        step.kind === 'wait' && 'bg-surface-0',
        emphasis === 'dim' && 'opacity-35',
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className={hidden} />
      <div className="flex min-w-0 items-center gap-1.5">
        {KIND_GLYPH[step.kind] && (
          <span aria-hidden="true" className="text-[11px] text-fg-2">
            {KIND_GLYPH[step.kind]}
          </span>
        )}
        <span className="truncate text-[13.5px] font-semibold text-fg">{step.name}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5 font-mono text-[10.5px] text-fg-3">
        <span className="truncate">
          {serviceName}
          {step.entryPoint ? ` · ${step.entryPoint}` : ''}
        </span>
        {step.deadlineMs !== undefined && <span className="ml-auto shrink-0">≤ {formatMs(step.deadlineMs)}</span>}
      </div>
      {(stores.length > 0 || alsoIn.length > 0) && (
        <div className="flex min-w-0 items-center gap-2 text-[10.5px] text-fg-3">
          {stores.length > 0 && (
            <span className="flex min-w-0 items-center gap-1 truncate font-mono" data-stores title="Data stores of this step's service (topology)">
              {stores.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-0.5" data-store={s.id}>
                  {s.health && <StatusShape health={s.health} />}
                  {s.name}
                </span>
              ))}
            </span>
          )}
          {alsoIn.length > 0 && <AlsoIn alsoIn={alsoIn} />}
        </div>
      )}

      {train && <span aria-hidden="true" className={cx('pointer-events-none absolute -inset-1.5 rounded-xl border-2', TRAIN_RING[train.status], !train.correlated && 'border-dashed')} />}
      {divergence && (
        <span className="absolute -top-2.5 right-2 rounded-sm bg-warn px-1 text-[10px] font-semibold text-on-accent" data-divergence-tag>
          diverged
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className={hidden} />
    </div>
  );
});

const OUTCOME_GLYPH: Record<FlowOutcomeKind, string> = { success: '✓', cancelled: '⊘', failed: '✕', compensated: '↺' };
const OUTCOME_TONE: Record<FlowOutcomeKind, string> = { success: 'border-ok text-ok-fg', cancelled: 'border-warn text-warn-fg', failed: 'border-crit text-crit-fg', compensated: 'border-indigo text-fg-2' };

/** An outcome: shape, name, and kind in words (never colour alone). */
export const OutcomeView = memo(function OutcomeView({ data }: NodeProps<OutcomeNode>) {
  const { outcome, emphasis, train } = data;
  return (
    <div
      data-outcome={outcome.id}
      data-emphasis={emphasis}
      data-train={train ? outcome.id : undefined}
      className={cx('relative flex h-full w-full items-center gap-2 rounded-full border-2 bg-surface-1 px-3', OUTCOME_TONE[outcome.kind], emphasis === 'dim' && 'opacity-35')}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className={hidden} />
      <span aria-hidden="true" className="font-semibold">
        {OUTCOME_GLYPH[outcome.kind]}
      </span>
      <span className="truncate text-[13.5px] font-semibold text-fg">{outcome.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-fg-3">{outcome.kind}</span>
      {train && <span aria-hidden="true" className={cx('pointer-events-none absolute -inset-1.5 rounded-full border-2', TRAIN_RING[train.status])} />}
    </div>
  );
});

/**
 * A routed transition: the precomputed orthogonal path, policy diamonds with tooltips, and its
 * condition, event, and share as a label. Compensation is dashed.
 */
export const RoutedEdgeView = memo(function RoutedEdgeView({ id, data, markerEnd }: EdgeProps<RoutedEdge>) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data) return null;
  const { flowId, route, transition, label, undo, color, emphasis, divergence, title, policyStores } = data;
  const strong = emphasis === 'focus' || emphasis === 'traversed';
  const stroke = divergence ? 'var(--color-warn)' : emphasis === 'dim' ? 'var(--transit-dim)' : color;
  const hovered = hover !== null ? transition.policies[hover] : undefined;
  const at = hover !== null ? route.policies[hover] : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={route.path}
        {...(markerEnd ? { markerEnd } : {})}
        interactionWidth={10}
        style={{ stroke, strokeWidth: strong ? 3.5 : 2.25, strokeDasharray: undo ? '7 5' : undefined, opacity: emphasis === 'dim' ? 0.45 : 1 }}
      />
      <g data-transition={id} data-emphasis={emphasis} data-undo={undo || undefined} data-divergence={divergence || undefined} opacity={emphasis === 'dim' ? 0.4 : 1}>
        {route.policies.map((pt, i) => {
          const policy = transition.policies[i];
          if (!policy) return null;
          return (
            <g key={i} data-stop={`${flowId}:${id}:${i}`} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className="pointer-events-auto">
              <rect x={pt.x - 8} y={pt.y - 8} width={16} height={16} fill="transparent" />
              <PolicyDiamond stop={policy} x={pt.x} y={pt.y} size={10} />
            </g>
          );
        })}
      </g>
      <EdgeLabelRenderer>
        {/* Dimmed edges are context: their labels are dropped rather than drawn faint (contrast). */}
        {label && emphasis !== 'dim' && (
          <div
            data-edge-label={id}
            className="pointer-events-none absolute rounded-sm bg-surface-1/90 px-1 font-mono text-[10.5px] whitespace-nowrap text-fg-2"
            style={{ transform: `translate(-100%, -100%) translate(${route.label.x}px, ${route.label.y}px)` }}
          >
            {label}
          </div>
        )}
        {hovered && at && (
          <div role="tooltip" className="pointer-events-none absolute z-20 w-max max-w-[260px] rounded-lg border border-line bg-float px-3 py-2 text-xs shadow-float" style={{ transform: `translate(-50%, calc(-100% - 10px)) translate(${at.x}px, ${at.y}px)` }}>
            <div className="font-mono font-medium text-fg">{policySummary(hovered)}</div>
            <div className="text-fg-3">
              {patternLabel(hovered.type)} · {POLICY_STATE_LABEL[hovered.state ?? 'idle']}
              {hovered.stat ? ` · ${hovered.stat}` : ''}
            </div>
            {policyStores[hover ?? -1] && <div className="text-fg-2">in {policyStores[hover ?? -1]}</div>}
            <div className="mt-1 text-fg-2">on “{title}”</div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

/** Legend of the swimlane's shapes and line styles. */
export function SwimlaneLegend({ className }: { className?: string }) {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <div className={cx('pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-3', className)} aria-hidden="true">
      <span className={item}>◆ decision</span>
      <span className={item}>◷ wait</span>
      <span className={item}>↺ compensation</span>
      <span className={item}>✋ manual</span>
      <span className={item}>
        <svg width="22" height="12">
          <path d="M1 6h20" stroke="var(--color-indigo)" strokeWidth="2.5" strokeDasharray="5 4" />
        </svg>
        undo track
      </span>
      <span className={item}>
        <svg width="12" height="12">
          <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="none" stroke="var(--color-warn)" strokeDasharray="2 2" />
        </svg>
        missing policy
      </span>
    </div>
  );
}

/** "also in Refund": the other flows that run this step, as links. */
function AlsoIn({ alsoIn }: { alsoIn: StepNode['data']['alsoIn'] }) {
  const { search } = useLocation();
  return (
    <span className="ml-auto min-w-0 truncate" data-also-in>
      also in{' '}
      {alsoIn.map((f, i) => (
        <span key={f.id}>
          {i > 0 && ', '}
          <Link to={`/flows/${f.id}${stripPageParams(search)}`} className="text-accent-fg underline" onClick={(e) => e.stopPropagation()}>
            {f.name}
          </Link>
        </span>
      ))}
    </span>
  );
}
