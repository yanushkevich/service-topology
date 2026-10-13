import { useId, useState, type ReactNode } from 'react';
import { formatMs, formatRate, isUnobserved, lineStations, type BoardIndex } from '../../transit/board';
import type { MapGeometry } from '../../transit/layout';
import type { PolicyStop, Station } from '../../transit/types';
import { cx, floatClass } from '../../shared/ui/classes';
import { GlowFilter, MapChooser, MapGround, MapTooltip, RibbonLine, SelectedLine, StationLabel, type LineState } from '../boards/MapParts';
import { overlayPosition } from '../boards/overlay';
import { lineColor, policySummary, POLICY_STATE_LABEL } from './colors';
import { LineBadge, PolicyDiamond, ProvenanceTag } from './visuals';
import { patternLabel } from '../../domain/patterns';
import type { DependencyLink } from '../../transit/links';
import { linkSummary } from './linkText';

type Hover = { kind: 'station' | 'stop'; id: string; x: number; y: number };

/**
 * Perspective transit map (spec "Map rendering"). Geometry is computed once per data load by the
 * caller; selection, search, finding focus, and hover only change attributes here. The selected
 * line is redrawn on top in an overlay layer, and `overlay` (the replay's train) is drawn last.
 * The map is `role="img"`: the index and the strip carry the same information for keyboard and
 * screen-reader users, so the hover tooltips are a convenience, not the only way to a value.
 */
export function TransitMap({
  index,
  geometry,
  serviceName,
  selectedId,
  matches,
  focusStations,
  showStepStats,
  onSelect,
  overlay,
  links,
}: {
  index: BoardIndex;
  geometry: MapGeometry;
  serviceName: string;
  selectedId: string | null;
  /** Lines matching the search, or null when there is no query. */
  matches: Set<string> | null;
  /** Stations named by the focused finding. */
  focusStations: ReadonlySet<string>;
  /** Typical mode: station tooltips show the selected line's p50 and p99. */
  showStepStats: boolean;
  /** Dependencies resolved in the topology (ADR-027), for their tooltips. */
  links?: ReadonlyMap<string, DependencyLink> | undefined;
  onSelect: (lineId: string | null) => void;
  overlay?: ReactNode;
}) {
  const blurId = useId().replace(/:/g, '');
  const [chooser, setChooser] = useState<{ stationId: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
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
  const at = (x: number, y: number) => overlayPosition(x, y, geometry);

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
        <GlowFilter id={blurId} />
        <g aria-hidden="true">
          <rect data-ground x={0} y={0} width={geometry.width} height={geometry.height} fill="transparent" />
          <MapGround grid={geometry.grid} bands={geometry.bands} captions={!geometry.flat} />
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
                    <RibbonLine top={branch.top} shadow={branch.shadow} ribbons={branch.ribbons} color={color} state={state} dash={dash} blurId={blurId} />
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
              <g
                key={g.id}
                data-stop={g.id}
                opacity={stationLit(stop.clientId) ? 1 : 0.25}
                onPointerEnter={() => setHover({ kind: 'stop', id: g.id, x: g.x, y: g.y })}
                onPointerLeave={() => setHover(null)}
              >
                <rect x={g.x - 9} y={g.y - 9} width={18} height={18} fill="transparent" />
                <PolicyDiamond stop={stop} x={g.x} y={g.y} />
              </g>
            );
          })}
        </g>

        {/* Overlay: the selected line on top, wider, with a soft glow. */}
        <g data-layer="overlay" pointerEvents="none">
          {selected &&
            geometry.lines
              .filter((l) => l.lineId === selected.id)
              .flatMap((l) => l.branches)
              .map((branch, i) => (
                <SelectedLine key={i} d={branch.top} color={lineColor(index, selected.id)} dash={isUnobserved(selected) ? '10 7' : undefined} blurId={blurId} data={{ 'data-selected-line': selected.id }} />
              ))}
        </g>

        <g data-layer="stations">
          {geometry.stations.map((g) => {
            const station = index.stations.get(g.id);
            if (!station) return null;
            const lit = stationLit(g.id);
            const inferred = station.provenance.kind === 'inferred';
            // Labels that fit nowhere show when their line is selected; tooltips always name them.
            const showLabel = selected ? lit : !g.label.hidden;
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
                onPointerEnter={() => setHover({ kind: 'station', id: g.id, x: g.x, y: g.y })}
                onPointerLeave={() => setHover(null)}
              >
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
                  <StationLabel
                    label={g.label}
                    name={station.name}
                    sub={station.sub}
                    subFill={station.status === 'degraded' || station.status === 'down' ? 'var(--color-warn-text)' : undefined}
                    flat={geometry.flat}
                  />
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

      {selected && (
        <p data-endpoint={selected.id} className={cx(floatClass, 'top-3 left-3 m-0 flex max-w-[calc(100%-24px)] items-center gap-2 px-2.5 py-1.5 text-xs')}>
          <span className="text-fg-3">Endpoint</span>
          <LineBadge index={index} lineId={selected.id} code={selected.code} />
          <span className="truncate font-mono text-fg">{selected.signature}</span>
          <span className="shrink-0 text-fg-3">· from {selected.caller}</span>
        </p>
      )}
      {hover && !chooser && (
        <MapTooltip position={at(hover.x, hover.y)}>
          {hover.kind === 'station' ? (
            <StationTip index={index} station={index.stations.get(hover.id)} lineId={showStepStats ? (selected?.id ?? null) : null} link={links?.get(hover.id)} />
          ) : (
            <StopTip stop={index.board.policies.find((p) => p.id === hover.id)} />
          )}
        </MapTooltip>
      )}

      {chooser && (
        <MapChooser
          label={`Lines through ${index.stations.get(chooser.stationId)?.name ?? chooser.stationId}`}
          heading={
            <>
              {(index.linesByStation.get(chooser.stationId) ?? []).length} lines through <b className="font-medium text-fg">{index.stations.get(chooser.stationId)?.name}</b>
            </>
          }
          items={(index.linesByStation.get(chooser.stationId) ?? []).flatMap((id) => {
            const line = index.lineById.get(id);
            return line ? [{ id, badge: <LineBadge index={index} lineId={id} code={line.code} />, text: line.name, mono: true }] : [];
          })}
          position={at(chooser.x, chooser.y)}
          onPick={(id) => {
            setChooser(null);
            onSelect(id);
          }}
          onClose={() => setChooser(null)}
        />
      )}
    </div>
  );
}

/** Station tooltip (spec "Hover"): name, kind, provenance, and in typical mode p50 / p99 for the selected line. */
function StationTip({ index, station, lineId, link }: { index: BoardIndex; station: Station | undefined; lineId: string | null; link: DependencyLink | undefined }) {
  if (!station) return null;
  const stats = lineId ? index.lineById.get(lineId)?.stepStats?.[station.id] : undefined;
  return (
    <>
      <div className="flex items-center gap-2">
        <b className="font-semibold text-fg">{station.name}</b>
        <ProvenanceTag kind={station.provenance.kind} />
      </div>
      <div className="text-fg-3">
        {station.kind}
        {station.sub ? ` · ${station.sub}` : ''} · {station.provenance.detail}
      </div>
      {stats && (
        <div className="mt-1 font-mono text-fg-2">
          p50 {formatMs(stats.p50Ms)} · p99 {formatMs(stats.p99Ms)}
          {stats.errorRate > 0 ? ` · errors ${formatRate(stats.errorRate)}` : ''}
        </div>
      )}
      {link && <div className="mt-1 text-fg-2">{linkSummary(link)}</div>}
      {(index.tablesByStation.get(station.id) ?? []).map((t) => (
        <div key={t.id} className="font-mono text-fg-2">
          {t.name}
          {t.pattern ? ` · ${patternLabel(t.pattern).toLowerCase()}` : ''}
          {t.writes.length ? ` · written by ${t.writes.join(', ')}` : ''}
          {t.reads.length ? ` · read by ${t.reads.join(', ')}` : ''}
        </div>
      ))}
    </>
  );
}

/** Policy tooltip (spec "Hover"): the policy summary and the config it was read from. */
function StopTip({ stop }: { stop: PolicyStop | undefined }) {
  if (!stop) return null;
  return (
    <>
      <div className="font-mono font-medium text-fg">{policySummary(stop)}</div>
      <div className="text-fg-3">
        {patternLabel(stop.type)} · {POLICY_STATE_LABEL[stop.state]}
        {stop.stat ? ` · ${stop.stat}` : ''}
      </div>
      {stop.source && <div className="mt-1 font-mono text-fg-2">{stop.source}</div>}
    </>
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
