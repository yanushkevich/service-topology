import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BusinessFlow, FlowPolicy } from '../../domain/types';
import type { FlowBoardIndex, FlowGeometry } from '../../transit/flows/flowLayout';
import { cx, floatClass } from '../../shared/ui/classes';
import { policySummary, POLICY_STATE_LABEL } from '../transit-board/colors';
import { PolicyDiamond } from '../transit-board/visuals';
import { flowColor, isUndoTransition } from './flowVisuals';
import { FlowBadge } from './FlowBadge';

type Hover = { kind: 'station' | 'stop'; id: string; x: number; y: number };

/**
 * Flow board map (ADR-022): business flows as lines, steps as stations in service bands, decision
 * outcomes as termini, policies as diamonds at the start of each transition, and compensation as
 * dashed undo tracks. Geometry is computed once per data load by the caller; selection, search, and
 * replay change attributes only. `role="img"`: the flow list and the step strip carry the content.
 */
export function FlowMap({
  fx,
  geometry,
  selectedFlowId,
  selectedStation,
  matches,
  onSelectFlow,
  onSelectStation,
  overlay,
}: {
  fx: FlowBoardIndex;
  geometry: FlowGeometry;
  selectedFlowId: string | null;
  selectedStation: string | null;
  /** Flows matching the search, or null without a query. */
  matches: Set<string> | null;
  onSelectFlow: (flowId: string) => void;
  onSelectStation: (stationKey: string, flowId: string) => void;
  overlay?: ReactNode;
}) {
  const blurId = useId().replace(/:/g, '');
  const [hover, setHover] = useState<Hover | null>(null);
  const [chooser, setChooser] = useState<{ station: string; x: number; y: number } | null>(null);
  const selected = selectedFlowId ? fx.flowById.get(selectedFlowId) : undefined;
  const onSelected = new Set(selected ? [...fx.stations.values()].filter((s) => s.refs.some((r) => r.flowId === selected.id)).map((s) => s.key) : []);
  const stateOf = (flowId: string) => (selected ? (flowId === selected.id ? 'hidden' : 'dim') : matches && !matches.has(flowId) ? 'dim' : 'normal');
  const lit = (key: string) => (selected ? onSelected.has(key) : !matches || (fx.flowsByStation.get(key) ?? []).some((f) => matches.has(f)));
  const at = (x: number, y: number) => ({ left: `${(x / geometry.width) * 100}%`, top: `${(y / geometry.height) * 100}%` });
  const clickStation = (key: string, x: number, y: number) => {
    const flows = fx.flowsByStation.get(key) ?? [];
    if (selected && flows.includes(selected.id)) onSelectStation(key, selected.id);
    else if (flows.length === 1 && flows[0]) onSelectStation(key, flows[0]);
    else if (flows.length > 1) setChooser({ station: key, x, y });
  };
  const label = `Business flows map: ${fx.flows.length} flow${fx.flows.length === 1 ? '' : 's'} through ${fx.stations.size} steps and outcomes in ${fx.bands.length} services.${selected ? ` ${selected.name} is highlighted.` : ''} Use the flow list and the step strip for details.`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full select-none"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).hasAttribute('data-ground')) setChooser(null);
        }}
      >
        <defs>
          <filter id={blurId}>
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <g aria-hidden="true">
          <rect data-ground x={0} y={0} width={geometry.width} height={geometry.height} fill="transparent" />
          {geometry.grid.map((d, i) => (
            <path key={i} d={d} stroke="var(--color-line)" strokeOpacity={0.5} fill="none" pointerEvents="none" />
          ))}
          {geometry.bands.map((band) => (
            <g key={band.label} pointerEvents="none">
              <path d={band.d} fill="var(--color-text-3)" fillOpacity={0.035} stroke="var(--color-line)" />
              <text x={band.x} y={band.y} fontFamily="var(--font-mono)" fontSize={geometry.flat ? 9 : 10} letterSpacing={geometry.flat ? 1 : 3} fill="var(--color-text-3)">
                {band.label}
              </text>
            </g>
          ))}
        </g>

        <g data-layer="static">
          {geometry.lines.map((line) => {
            const flow = fx.flowById.get(line.flowId);
            if (!flow) return null;
            const state = stateOf(flow.id);
            const color = flowColor(fx, flow.id);
            return (
              <g key={flow.id} data-flow={flow.id} data-state={state} className="cursor-pointer" onClick={() => onSelectFlow(flow.id)}>
                {line.transitions.map((t) => {
                  const undo = isUndoTransition(flow, t.transitionId);
                  const dash = undo ? '9 6' : undefined;
                  return (
                    <g key={t.transitionId} data-transition={t.transitionId}>
                      <path d={t.top} fill="none" stroke="transparent" strokeWidth={16} />
                      <path d={t.shadow} fill="none" stroke="var(--transit-shadow)" strokeWidth={10} filter={`url(#${blurId})`} opacity={state === 'normal' ? 1 : 0} />
                      {t.ribbons.map((d, r) => (
                        <path key={r} d={d} fill="none" stroke={color} strokeOpacity={state === 'normal' ? 0.2 : 0} strokeWidth={5} strokeDasharray={dash} />
                      ))}
                      <path
                        d={t.top}
                        data-top
                        fill="none"
                        stroke={state === 'normal' ? color : 'var(--transit-dim)'}
                        strokeOpacity={state === 'normal' ? 1 : state === 'dim' ? 0.22 : 0}
                        strokeWidth={state === 'normal' ? 5 : 3}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        strokeDasharray={dash}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>

        <g data-layer="stops">
          {geometry.stops.map((g) => {
            const policy = policyAt(fx, g.flowId, g.transitionId, g.policy);
            if (!policy) return null;
            const on = !selected || selected.id === g.flowId;
            return (
              <g key={g.id} data-stop={g.id} opacity={on ? 1 : 0.2} onPointerEnter={() => setHover({ kind: 'stop', id: g.id, x: g.x, y: g.y })} onPointerLeave={() => setHover(null)}>
                <rect x={g.x - 9} y={g.y - 9} width={18} height={18} fill="transparent" />
                <PolicyDiamond stop={policy} x={g.x} y={g.y} size={11} />
              </g>
            );
          })}
        </g>

        <g data-layer="overlay" pointerEvents="none">
          {selected &&
            geometry.lines
              .filter((l) => l.flowId === selected.id)
              .flatMap((l) => l.transitions)
              .map((t) => (
                <g key={t.transitionId}>
                  <path d={t.top} fill="none" stroke={flowColor(fx, selected.id)} strokeOpacity={0.35} strokeWidth={17} filter={`url(#${blurId})`} />
                  <path
                    d={t.top}
                    data-selected-flow={selected.id}
                    fill="none"
                    stroke={flowColor(fx, selected.id)}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={isUndoTransition(selected, t.transitionId) ? '9 6' : undefined}
                  />
                </g>
              ))}
        </g>

        <g data-layer="stations">
          {geometry.stations.map((g) => {
            const station = fx.stations.get(g.id);
            if (!station) return null;
            const on = lit(g.id);
            const showLabel = selected ? on : !g.label.hidden;
            const isSelected = selectedStation === g.id;
            const outcome = station.kind === 'outcome';
            const outcomeColor = station.outcomeKind === 'success' ? 'var(--color-ok)' : station.outcomeKind === 'failed' ? 'var(--color-crit)' : 'var(--color-warn)';
            return (
              <g
                key={g.id}
                data-station={g.id}
                opacity={on ? 1 : 0.3}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  clickStation(g.id, g.x, g.y);
                }}
                onPointerEnter={() => setHover({ kind: 'station', id: g.id, x: g.x, y: g.y })}
                onPointerLeave={() => setHover(null)}
              >
                <ellipse cx={g.x} cy={g.y + 4} rx={14} ry={5} fill="var(--transit-shadow)" />
                {outcome ? (
                  <rect x={g.x - 5} y={g.y - 12} width={10} height={24} rx={2} fill={outcomeColor} stroke="var(--transit-station-ring)" strokeWidth={2} />
                ) : g.capsule ? (
                  <rect x={g.x - 9} y={g.y - g.capsule / 2} width={18} height={g.capsule} rx={9} fill="var(--transit-station)" stroke="var(--transit-station-ring)" strokeWidth={3} />
                ) : station.kind === 'decision' ? (
                  <rect x={g.x - 7} y={g.y - 7} width={14} height={14} transform={`rotate(45 ${g.x} ${g.y})`} fill="var(--transit-station)" stroke="var(--transit-station-ring)" strokeWidth={3} />
                ) : (
                  <circle
                    cx={g.x}
                    cy={g.y}
                    r={g.radius}
                    fill={station.kind === 'wait' || station.kind === 'compensation' ? 'var(--color-stage)' : 'var(--transit-station)'}
                    stroke="var(--transit-station-ring)"
                    strokeWidth={3}
                    strokeDasharray={station.kind === 'compensation' ? '3 2' : undefined}
                  />
                )}
                {isSelected && <circle cx={g.x} cy={g.y} r={(g.capsule ?? 2 * g.radius) / 2 + 9} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
                {showLabel && (
                  <text
                    data-label
                    x={g.label.x}
                    y={g.label.y}
                    textAnchor={g.label.anchor}
                    fontFamily="var(--font-sans)"
                    fontWeight={600}
                    fontSize={geometry.flat ? 13 : 15}
                    fill="var(--color-text)"
                    stroke="var(--color-stage)"
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {station.name}
                    {g.label.withSub && (
                      <tspan x={g.label.x} dy={14} fontFamily="var(--font-mono)" fontWeight={400} fontSize={11.5} fill="var(--color-text-3)">
                        {station.sub}
                      </tspan>
                    )}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {overlay && (
          <g data-layer="train" pointerEvents="none">
            {overlay}
          </g>
        )}
      </svg>

      {hover && !chooser && (
        <div role="tooltip" className={cx(floatClass, 'pointer-events-none z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+14px)] px-3 py-2 text-xs')} style={at(hover.x, hover.y)}>
          {hover.kind === 'station' ? <StationTip fx={fx} stationKey={hover.id} /> : <StopTip fx={fx} stopId={hover.id} />}
        </div>
      )}

      {chooser && (
        <FlowChooser
          fx={fx}
          station={chooser.station}
          style={at(chooser.x, chooser.y)}
          onPick={(flowId) => {
            setChooser(null);
            onSelectStation(chooser.station, flowId);
          }}
          onClose={() => setChooser(null)}
        />
      )}
    </div>
  );
}

function policyAt(fx: FlowBoardIndex, flowId: string, transitionId: string, i: number): FlowPolicy | undefined {
  return fx.flowById.get(flowId)?.transitions.find((t) => t.id === transitionId)?.policies[i];
}

function StationTip({ fx, stationKey }: { fx: FlowBoardIndex; stationKey: string }) {
  const station = fx.stations.get(stationKey);
  if (!station) return null;
  const flows = (fx.flowsByStation.get(stationKey) ?? []).map((id) => fx.flowById.get(id)?.name).filter(Boolean);
  const ref = station.refs[0];
  const step = ref ? fx.flowById.get(ref.flowId)?.steps.find((s) => s.id === ref.id) : undefined;
  return (
    <>
      <b className="font-semibold text-fg">{station.name}</b>
      <div className="text-fg-3">
        {station.kind === 'outcome' ? `outcome · ${station.outcomeKind ?? ''}` : `${station.kind} · ${station.sub}`}
        {step?.entryPoint ? ` · ${step.entryPoint}` : ''}
      </div>
      {step?.deadlineMs !== undefined && <div className="font-mono text-fg-2">deadline {step.deadlineMs >= 60_000 ? `${step.deadlineMs / 60_000} min` : `${step.deadlineMs / 1000} s`}</div>}
      <div className="mt-1 text-fg-2">In {flows.join(', ')}</div>
    </>
  );
}

function StopTip({ fx, stopId }: { fx: FlowBoardIndex; stopId: string }) {
  const [flowId = '', transitionId = '', index = '0'] = stopId.split(':');
  const flow = fx.flowById.get(flowId);
  const transition = flow?.transitions.find((t) => t.id === transitionId);
  const policy = transition?.policies[Number(index)];
  if (!policy || !transition) return null;
  return (
    <>
      <div className="font-mono font-medium text-fg">{policySummary(policy)}</div>
      <div className="text-fg-3">
        {policy.type} · {POLICY_STATE_LABEL[policy.state ?? 'idle']}
        {policy.stat ? ` · ${policy.stat}` : ''}
      </div>
      <div className="mt-1 text-fg-2">on “{transitionLabel(flow, transition.id)}”</div>
    </>
  );
}

function transitionLabel(flow: BusinessFlow | undefined, id: string): string {
  const t = flow?.transitions.find((x) => x.id === id);
  if (!flow || !t) return id;
  const name = (sid: string) => flow.steps.find((s) => s.id === sid)?.name ?? flow.outcomes.find((o) => o.id === sid)?.name ?? sid;
  return `${name(t.from)} → ${name(t.to)}`;
}

function FlowChooser({ fx, station, style, onPick, onClose }: { fx: FlowBoardIndex; station: string; style: { left: string; top: string }; onPick: (flowId: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const name = fx.stations.get(station)?.name ?? station;
  const flows = (fx.flowsByStation.get(station) ?? []).flatMap((id) => fx.flowById.get(id) ?? []);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, [station]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Flows through ${name}`}
      className={cx(floatClass, 'z-20 w-[220px] p-1.5')}
      style={{ left: `min(calc(${style.left} + 12px), calc(100% - 228px))`, top: style.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="m-0 px-2 py-1 text-xs text-fg-3">
        {flows.length} flows through <b className="font-medium text-fg">{name}</b>
      </p>
      {flows.map((flow) => (
        <button key={flow.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => onPick(flow.id)}>
          <FlowBadge fx={fx} flowId={flow.id} />
          <span className="truncate text-xs">{flow.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Legend of the flow map's styles. */
export function FlowLegend({ className }: { className?: string }) {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <div className={cx('pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-3', className)} aria-hidden="true">
      <span className={item}>
        <svg width="14" height="14">
          <rect x="3" y="3" width="8" height="8" transform="rotate(45 7 7)" fill="var(--transit-station)" stroke="var(--transit-station-ring)" strokeWidth="2" />
        </svg>
        decision
      </span>
      <span className={item}>
        <svg width="14" height="14">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--transit-station-ring)" strokeWidth="2" />
        </svg>
        wait
      </span>
      <span className={item}>
        <svg width="12" height="14">
          <rect x="3" y="1" width="6" height="12" rx="1" fill="var(--color-ok)" />
        </svg>
        outcome
      </span>
      <span className={item}>
        <svg width="22" height="12">
          <path d="M1 6h20" stroke="var(--color-indigo)" strokeWidth="3" strokeDasharray="5 4" />
        </svg>
        undo (compensation)
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
