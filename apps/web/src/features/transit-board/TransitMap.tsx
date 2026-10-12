import { useEffect, useId, useRef, useState } from 'react';
import type { BoardIndex } from '../../transit/board';
import type { MapGeometry } from '../../transit/layout';
import { cx, floatClass } from '../../shared/ui/classes';
import { lineColor, POLICY_STATE_LABEL } from './colors';
import { LineBadge, PolicyDiamond } from './visuals';
import { isUnobserved, lineStations } from '../../transit/board';

type LineState = 'normal' | 'dim' | 'hidden';

/**
 * Perspective transit map (spec "Map rendering"). Geometry is computed once per data load by the
 * caller; selection, search, and finding focus only change attributes here, and the selected line
 * is redrawn on top in a separate overlay layer. The map is `role="img"`: the index and the strip
 * carry the same information for keyboard and screen-reader users.
 */
export function TransitMap({
  index,
  geometry,
  serviceName,
  selectedId,
  matches,
  focusStations,
  onSelect,
}: {
  index: BoardIndex;
  geometry: MapGeometry;
  serviceName: string;
  selectedId: string | null;
  /** Lines matching the search, or null when there is no query. */
  matches: Set<string> | null;
  /** Stations named by the focused finding. */
  focusStations: ReadonlySet<string>;
  onSelect: (lineId: string | null) => void;
}) {
  const blurId = useId().replace(/:/g, '');
  const [chooser, setChooser] = useState<{ stationId: string; x: number; y: number } | null>(null);
  const selected = selectedId ? index.lineById.get(selectedId) : undefined;
  const onSelected = new Set(selected ? lineStations(selected) : []);
  const stateOf = (lineId: string): LineState => {
    if (selected) return lineId === selected.id ? 'hidden' : 'dim'; // the overlay draws the selected line
    if (matches && !matches.has(lineId)) return 'dim';
    return 'normal';
  };
  const stationLit = (id: string) => (selected ? onSelected.has(id) : !matches || (index.linesByStation.get(id) ?? []).some((l) => matches.has(l)));

  const clickStation = (stationId: string, x: number, y: number) => {
    const lines = index.linesByStation.get(stationId) ?? [];
    const [only] = lines;
    if (lines.length === 1 && only) onSelect(only);
    else if (lines.length > 1) setChooser({ stationId, x, y });
  };

  const lineCount = index.lines.length;
  const label = `Transit map of ${serviceName}: ${lineCount} line${lineCount === 1 ? '' : 's'} through ${index.board.stations.length} stations.${selected ? ` Line ${selected.code}, ${selected.name}, is highlighted.` : ''} Use the line list and the stop strip for details.`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full select-none"
        data-flat={geometry.flat || undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).hasAttribute('data-ground')) {
            setChooser(null);
            onSelect(null);
          }
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
              <path d={band.d} fill="var(--color-text-3)" fillOpacity={0.03} stroke="var(--color-line)" />
              {!geometry.flat && (
                <text x={band.x} y={band.y} fontFamily="var(--font-mono)" fontSize={10} letterSpacing={4} fill="var(--color-text-3)">
                  {band.label}
                </text>
              )}
            </g>
          ))}
        </g>

        {/* Static layer: every line, styled by state; paths never change after the data loads. */}
        <g data-layer="static">
          {geometry.lines.map((lineGeometry) => {
            const line = index.lineById.get(lineGeometry.lineId);
            if (!line) return null;
            const state = stateOf(line.id);
            const color = lineColor(index, line.id);
            const dash = isUnobserved(line) ? '10 7' : undefined;
            return (
              <g
                key={line.id}
                data-line={line.id}
                data-state={state}
                className="cursor-pointer"
                onClick={() => {
                  setChooser(null);
                  onSelect(line.id);
                }}
              >
                {lineGeometry.branches.map((branch, b) => (
                  <g key={b}>
                    <path d={branch.top} fill="none" stroke="transparent" strokeWidth={16} />
                    <path d={branch.shadow} fill="none" stroke="var(--transit-shadow)" strokeWidth={10} filter={`url(#${blurId})`} opacity={state === 'normal' ? 1 : 0} />
                    {branch.ribbons.map((d, r) => (
                      <path key={r} d={d} fill="none" stroke={color} strokeOpacity={state === 'normal' ? 0.2 : 0} strokeWidth={5} strokeLinejoin="round" strokeDasharray={dash} />
                    ))}
                    <path
                      d={branch.top}
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
                ))}
              </g>
            );
          })}
        </g>

        <g data-layer="stops">
          {geometry.stops.map((g) => {
            const stop = index.board.policies.find((p) => p.id === g.id);
            if (!stop) return null;
            return (
              <g key={g.id} opacity={stationLit(stop.clientId) ? 1 : 0.25}>
                <title>{`${stop.label} (${stop.type}) · ${POLICY_STATE_LABEL[stop.state]}${stop.config ? ` · ${Object.entries(stop.config).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}${stop.source ? ` · ${stop.source}` : ''}`}</title>
                <PolicyDiamond stop={stop} x={g.x} y={g.y} />
              </g>
            );
          })}
        </g>

        {/* Overlay: the selected line on top, wider, with a soft glow; then finding focus rings. */}
        <g data-layer="overlay" pointerEvents="none">
          {selected &&
            geometry.lines
              .filter((l) => l.lineId === selected.id)
              .flatMap((l) => l.branches)
              .map((branch, i) => (
                <g key={i}>
                  <path d={branch.top} fill="none" stroke={lineColor(index, selected.id)} strokeOpacity={0.35} strokeWidth={17} filter={`url(#${blurId})`} />
                  <path
                    d={branch.top}
                    data-selected-line={selected.id}
                    fill="none"
                    stroke={lineColor(index, selected.id)}
                    strokeWidth={7}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={isUnobserved(selected) ? '10 7' : undefined}
                  />
                </g>
              ))}
        </g>

        <g data-layer="stations">
          {geometry.stations.map((g) => {
            const station = index.stations.get(g.id);
            if (!station) return null;
            const lit = stationLit(g.id);
            const inferred = station.provenance.kind === 'inferred';
            const showLabel = !selected || lit;
            return (
              <g
                key={g.id}
                data-station={g.id}
                opacity={lit ? 1 : 0.3}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  clickStation(g.id, g.x, g.y);
                }}
              >
                <title>{`${station.name} · ${station.kind} · ${station.provenance.kind} (${station.provenance.detail})${station.stats ? ` · p50 ${station.stats.p50Ms} ms, p95 ${station.stats.p95Ms} ms` : ''}`}</title>
                <ellipse cx={g.x} cy={g.y + 4} rx={14} ry={5} fill="var(--transit-shadow)" />
                {g.capsule ? (
                  <rect x={g.x - 9} y={g.y - g.capsule / 2} width={18} height={g.capsule} rx={9} fill="var(--transit-station)" stroke="var(--transit-station-ring)" strokeWidth={3} />
                ) : (
                  <circle
                    cx={g.x}
                    cy={g.y}
                    r={g.radius}
                    fill={inferred ? 'var(--color-stage)' : 'var(--transit-station)'}
                    stroke={inferred ? 'var(--color-warn)' : 'var(--transit-station-ring)'}
                    strokeWidth={inferred ? 2 : 3}
                    strokeDasharray={inferred ? '3 2' : undefined}
                  />
                )}
                {focusStations.has(g.id) && <circle cx={g.x} cy={g.y} r={(g.capsule ?? 2 * g.radius) / 2 + 9} fill="none" stroke="var(--color-warn)" strokeWidth={2} />}
                {showLabel && (
                  <text
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
                    {g.label.withSub && station.sub && (
                      <tspan
                        x={g.label.x}
                        dy={14}
                        fontFamily="var(--font-mono)"
                        fontWeight={400}
                        fontSize={11.5}
                        fill={station.status === 'degraded' || station.status === 'down' ? 'var(--color-warn-text)' : 'var(--color-text-3)'}
                      >
                        {station.sub}
                      </tspan>
                    )}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {chooser && <StationChooser index={index} geometry={geometry} chooser={chooser} onPick={(id) => (setChooser(null), onSelect(id))} onClose={() => setChooser(null)} />}
    </div>
  );
}

/** A shared station is served by several lines: ask instead of guessing (spec "Selection"). */
function StationChooser({
  index,
  geometry,
  chooser,
  onPick,
  onClose,
}: {
  index: BoardIndex;
  geometry: MapGeometry;
  chooser: { stationId: string; x: number; y: number };
  onPick: (lineId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const station = index.stations.get(chooser.stationId);
  const lines = (index.linesByStation.get(chooser.stationId) ?? []).flatMap((id) => index.lineById.get(id) ?? []);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, [chooser.stationId]);
  if (!station) return null;
  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Lines through ${station.name}`}
      className={cx(floatClass, 'z-20 w-[220px] p-1.5')}
      style={{ left: `min(calc(${(chooser.x / geometry.width) * 100}% + 12px), calc(100% - 228px))`, top: `${(chooser.y / geometry.height) * 100}%` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="m-0 px-2 py-1 text-xs text-fg-3">
        {lines.length} lines through <b className="font-medium text-fg">{station.name}</b>
      </p>
      {lines.map((line) => (
        <button key={line.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => onPick(line.id)}>
          <LineBadge index={index} lineId={line.id} code={line.code} />
          <span className="truncate font-mono text-xs">{line.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Legend of the map's styles (spec: bottom-left of the map; hidden below 760px). */
export function MapLegend({ className }: { className?: string }) {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <div className={cx('pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-3', className)} aria-hidden="true">
      <span className={item}>
        <svg width="12" height="12">
          <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="var(--transit-policy-timeout)" />
        </svg>
        policy
      </span>
      <span className={item}>
        <svg width="12" height="12">
          <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="none" stroke="var(--transit-policy-timeout)" strokeWidth="1.5" />
        </svg>
        not exercised
      </span>
      <span className={item}>
        <svg width="12" height="12">
          <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="none" stroke="var(--color-warn)" strokeDasharray="2 2" />
        </svg>
        missing policy
      </span>
      <span className={item}>
        <svg width="12" height="12">
          <rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="none" stroke="var(--color-text-3)" />
        </svg>
        unknown (config not loaded)
      </span>
      <span className={item}>
        <svg width="14" height="12">
          <circle cx="7" cy="6" r="4.5" fill="none" stroke="var(--color-warn)" strokeDasharray="2 2" />
        </svg>
        inferred station
      </span>
      <span className={item}>
        <svg width="22" height="12">
          <path d="M1 6h20" stroke="var(--color-indigo)" strokeWidth="3" strokeDasharray="4 3" />
        </svg>
        route not observed
      </span>
    </div>
  );
}
