import type { ReactNode } from 'react';
import { formatCount, formatMs, formatRate, isUnobserved, stepTint, windowLabel, type BoardIndex, tablesOfLine } from '../../transit/board';
import type { Line, PolicyStop, Station } from '../../transit/types';
import { cx } from '../../shared/ui/classes';
import { lineColor, POLICY_STATE_LABEL } from './colors';
import { KeyValueRow, Kicker } from '../../shared/ui/primitives';
import { PolicyDiamond } from './visuals';
import { patternLabel } from '../../domain/patterns';
import { StripScroller } from '../boards/StripScroller';

type StripItem = { station: Station } | { stop: PolicyStop };

/** The stops of one branch in order: stations, and after each client the policies on its lane. */
function stripItems(index: BoardIndex, line: Line, branch: number): StripItem[] {
  const ids = (line.route[branch]?.stations ?? []).slice(branch === 0 ? 0 : 1);
  return ids.flatMap((id) => {
    const station = index.stations.get(id);
    if (!station) return [];
    const stops = station.kind === 'client' ? (index.policiesByClient.get(id) ?? []) : [];
    return [{ station }, ...stops.map((stop) => ({ stop }))];
  });
}

/**
 * Stop strip (spec "Screen layout", "Typical route mode"): the selected line as an ordered list of
 * steps with text for every stat, branches on their own row; with no selection, a network summary.
 */
export function StopStrip({ index, line, focusStations }: { index: BoardIndex; line: Line | null; focusStations: ReadonlySet<string> }) {
  if (!line) return <NetworkSummary index={index} />;
  const color = lineColor(index, line.id);
  const dashed = isUnobserved(line);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Kicker as="h2" mono>
          Line {line.code} · {dashed ? 'declared route (no traces in this window)' : `typical route, ${windowLabel(index.board.window)}`}
        </Kicker>
        <Kicker as="span" mono>stat under each stop</Kicker>
      </div>
      <StripScroller label={`Stops of line ${line.code}`}>
        {line.route.map((branch, b) => {
          const fork = b > 0 ? index.stations.get(branch.stations[0] ?? '') : undefined;
          const label = b === 0 ? `Stops on line ${line.code}` : `Branch of line ${line.code} from ${fork?.name ?? branch.stations[0]}`;
          return (
            <div key={b} className={cx(b > 0 && 'mt-1.5 flex items-start')}>
              {b > 0 && (
                <p className="m-0 w-[118px] flex-none pt-6 pr-2 text-right font-mono text-[10.5px] text-fg-3">
                  from {fork?.name}
                  {branch.kind === 'alternative' && <span className="block text-warn-fg">{branch.share !== undefined ? `on ${Math.round(branch.share * 100)}% of requests` : 'on some requests'}</span>}
                </p>
              )}
              <ol aria-label={`${label}${branch.kind === 'alternative' ? ', taken only on some requests' : ''}`} className="m-0 flex min-w-max list-none p-0">
                {stripItems(index, line, b).map((item, i, all) => (
                  <StripStop key={'station' in item ? item.station.id : item.stop.id} index={index} line={line} item={item} first={i === 0} last={i === all.length - 1} color={color} dashed={dashed || branch.kind === 'alternative'} focused={'station' in item && focusStations.has(item.station.id)} />
                ))}
              </ol>
            </div>
          );
        })}
      </StripScroller>
    </div>
  );
}

function StripStop({ index, line, item, first, last, color, dashed, focused }: { index: BoardIndex; line: Line; item: StripItem; first: boolean; last: boolean; color: string; dashed: boolean; focused: boolean }) {
  const track = (
    <span
      aria-hidden="true"
      className="absolute top-[29px] h-0"
      style={{ left: first ? '50%' : 0, right: last ? '50%' : 0, borderTop: `6px ${dashed ? 'dashed' : 'solid'} ${color}` }}
    />
  );
  let name: ReactNode;
  let marker: ReactNode;
  let stat: ReactNode;
  let hidden: string;
  if ('station' in item) {
    const { station } = item;
    const inferred = station.provenance.kind === 'inferred';
    const shared = (index.linesByStation.get(station.id)?.length ?? 0) >= 3 || station.kind === 'gate';
    name = <span className="font-semibold text-fg">{station.name}</span>;
    marker = (
      <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true">
        {shared ? (
          <rect x="2" y="1.5" width="16" height="21" rx="8" fill="var(--transit-station)" stroke="var(--transit-station-ring)" strokeWidth="3" />
        ) : (
          <circle cx="10" cy="12" r="7" fill={inferred ? 'var(--color-stage)' : 'var(--transit-station)'} stroke={inferred ? 'var(--color-warn)' : 'var(--transit-station-ring)'} strokeWidth={inferred ? 2 : 3} strokeDasharray={inferred ? '3 2' : undefined} />
        )}
      </svg>
    );
    const degraded = station.status === 'degraded' || station.status === 'down';
    const touched = tableUses(index, line, station.id);
    const stats = isUnobserved(line) ? undefined : line.stepStats?.[station.id];
    if (stats) {
      // Per-step stats (spec "Typical route mode"): tinted by the configured thresholds, always with a word.
      const tint = stepTint(index, line, station.id, stats);
      const extra = [stats.share < 1 ? `on ${formatRate(stats.share)}` : '', stats.errorRate > 0 ? `err ${formatRate(stats.errorRate)}` : '', stats.retryRate > 0 ? `retry ${formatRate(stats.retryRate)}` : ''].filter(Boolean);
      stat = (
        <span className={tint === 'errors' ? 'text-crit-fg' : tint === 'slow' || degraded ? 'text-warn-fg' : 'text-fg-3'} data-tint={tint ?? undefined}>
          p99 {formatMs(stats.p99Ms)}
          {tint && ` · ${tint === 'errors' ? 'errors' : 'slow'}`}
          {/* Health (from the topology when linked, ADR-027) is never hidden behind the line's stats. */}
          {degraded && ` · ${station.status}`}
          {extra.length > 0 && <span className="block">{extra.join(' · ')}</span>}
          {touched && <span className="block text-fg-2" data-tables>{touched}</span>}
        </span>
      );
      hidden = ` (${station.kind}, ${station.provenance.kind}${inferred ? ' from a code scan' : ''}${degraded ? `, ${station.status}` : ''}${touched ? `; ${touched}` : ''}; visited by ${formatRate(stats.share)} of requests, p50 ${formatMs(stats.p50Ms)}, p99 ${formatMs(stats.p99Ms)}, errors ${formatRate(stats.errorRate)}, retries ${formatRate(stats.retryRate)})`;
    } else {
      const text = station.stats ? `p95 ${station.stats.p95Ms} ms${degraded ? ` · ${station.status}` : ''}` : (station.sub ?? '');
      stat = (
        <span className={degraded ? 'text-warn-fg' : 'text-fg-3'}>
          {text}
          {touched && <span className="block text-fg-2" data-tables>{touched}</span>}
        </span>
      );
      hidden = ` (${station.kind}, ${station.provenance.kind}${inferred ? ' from a code scan' : ''})`;
    }
  } else {
    const { stop } = item;
    const absent = stop.state === 'missing' || stop.state === 'unknown';
    name = <span className={absent && stop.state === 'missing' ? 'text-warn-fg' : 'text-fg-2'}>{stop.label}</span>;
    marker = (
      <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden="true">
        <PolicyDiamond stop={stop} x={10} y={12} size={11} />
      </svg>
    );
    stat = <span className={stop.state === 'missing' ? 'text-warn-fg' : 'text-fg-3'}>{stop.state === 'missing' ? 'missing' : stop.state === 'unknown' ? 'unknown' : stop.stat}</span>;
    hidden = ` (${patternLabel(stop.type)} policy, ${POLICY_STATE_LABEL[stop.state]})`;
  }
  return (
    <li data-focused={focused || undefined} className={cx('relative flex w-[118px] flex-none flex-col items-center gap-0.5 px-1 text-center', focused && 'rounded-lg shadow-[inset_0_0_0_2px_var(--color-warn)]')}>
      {track}
      <span className="flex h-[22px] items-end text-xs leading-tight">
        <span className="line-clamp-2">
          {name}
          <span className="sr-only">{hidden}</span>
        </span>
      </span>
      <span className="relative z-1 grid h-6 place-items-center">{marker}</span>
      <span className="font-mono text-[10px] leading-tight">{stat}</span>
    </li>
  );
}

function NetworkSummary({ index }: { index: BoardIndex }) {
  const { lines, board } = index;
  const busiest = [...index.linesByStation.entries()]
    .flatMap(([id, ids]) => {
      const station = index.stations.get(id);
      return station && station.kind !== 'caller' ? [{ station, count: ids.length }] : [];
    })
    .sort((a, b) => b.count - a.count || a.station.name.localeCompare(b.station.name))
    .slice(0, 3);
  const observed = lines.filter((l) => !isUnobserved(l)).length;
  const inferred = board.stations.filter((s) => s.provenance.kind === 'inferred').length;
  const traces = lines.reduce((sum, l) => sum + l.stats.traces, 0);
  const warned = lines.filter((l) => l.findings.some((f) => f.severity === 'warn'));
  const missing = board.policies.filter((p) => p.state === 'missing').length;
  const unknown = board.policies.filter((p) => p.state === 'unknown').length;
  const kv = (k: string, v: ReactNode) => (
    <KeyValueRow key={k} label={k} className="py-1.5">
      {v}
    </KeyValueRow>
  );
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-5">
      <div className="min-w-0">
        <Kicker as="h2">Network</Kicker>
        <p className="m-0 mt-1.5 text-lg font-semibold">
          {lines.length} line{lines.length === 1 ? '' : 's'} through this service
        </p>
        <p className="m-0 mt-1 text-[12.5px] text-fg-2">Bundles are code paths shared by several entry points. Pick a line to follow it stop by stop.</p>
      </div>
      <div>
        <Kicker as="h2">Busiest stations</Kicker>
        <dl className="m-0 mt-1.5">{busiest.map((b) => kv(b.station.name, `${b.count} lines`))}</dl>
      </div>
      <div>
        <Kicker as="h2">Route coverage</Kicker>
        <dl className="m-0 mt-1.5">
          {kv('observed in traces', `${observed} of ${lines.length}`)}
          {kv('inferred stations', inferred)}
          {kv(`traces, ${windowLabel(board.window)}`, formatCount(traces))}
        </dl>
      </div>
      <div>
        <Kicker as="h2">Needs review</Kicker>
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0 text-sm">
          <li>{warned.length ? `Warnings on ${warned.map((l) => l.code).join(', ')}` : 'No warnings'}</li>
          <li>
            {missing} missing polic{missing === 1 ? 'y' : 'ies'}
          </li>
          {unknown > 0 && <li>{unknown} policies unknown (config not loaded)</li>}
        </ul>
      </div>
    </div>
  );
}

/** What the line does with the tables at a database stop, e.g. "writes payment_outbox (outbox)". */
function tableUses(index: BoardIndex, line: Line, stationId: string): string | null {
  const uses = tablesOfLine(index, line).filter((u) => u.table.stationId === stationId);
  if (uses.length === 0) return null;
  return uses.map(({ table, writes, reads }) => `${writes && reads ? 'reads + writes' : writes ? 'writes' : 'reads'} ${table.name}${table.pattern ? ` (${patternLabel(table.pattern).toLowerCase()})` : ''}`).join(' · ');
}
