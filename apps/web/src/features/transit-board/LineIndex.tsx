import { useId, useRef } from 'react';
import { dependenciesOf, GROUP_LABELS, GROUP_ORDER, hasWarnings, isUnobserved, type BoardIndex } from '../../transit/board';
import { cx, fieldClass, kickerClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { LineBadge } from './visuals';

const rowClass =
  'flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[12.5px] text-fg-2 hover:bg-surface-3 hover:text-fg aria-[current=true]:bg-accent-soft aria-[current=true]:text-fg aria-[current=true]:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]';

/**
 * Line index (spec "Screen layout"): search, "All lines", lines grouped by kind. A real list of
 * buttons, so everything on the map is reachable without it; Up/Down move between rows.
 */
export function LineIndex({
  index,
  query,
  onQuery,
  matches,
  selectedId,
  onSelect,
}: {
  index: BoardIndex;
  query: string;
  onQuery: (q: string) => void;
  matches: Set<string>;
  selectedId: string | null;
  onSelect: (lineId: string | null) => void;
}) {
  const searchId = useId();
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('button[data-row]') ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[at === -1 ? 0 : next]?.focus();
  };
  const listed = index.lines.filter((l) => matches.has(l.id));

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <label htmlFor={searchId} className="flex h-9 items-center gap-2 rounded-md border border-control bg-surface-0 px-2.5 text-fg-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Icon name="search" />
        <span className="sr-only">Find a line</span>
        <input
          id={searchId}
          type="search"
          className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-3 focus-visible:outline-none"
          placeholder="Find an endpoint, job, or station"
          autoComplete="off"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </label>
      <div ref={list} className="flex flex-col gap-1">
        <button type="button" data-row className={rowClass} aria-current={selectedId === null} onClick={() => onSelect(null)}>
          <span className="h-5 w-7 flex-none rounded-[5px]" style={{ background: 'linear-gradient(90deg, var(--transit-line-1), var(--transit-line-2), var(--transit-line-3), var(--transit-line-7))' }} aria-hidden="true" />
          <span className="min-w-0 flex-1">All lines</span>
          <span className="text-[10.5px] text-fg-3">network</span>
        </button>
        {GROUP_ORDER.map((group) => {
          const lines = listed.filter((l) => l.group === group);
          if (lines.length === 0) return null;
          return (
            <section key={group} aria-label={`${GROUP_LABELS[group]}, ${lines.length}`}>
              <h3 className={cx(kickerClass, 'm-0 px-2 pt-1.5 pb-1 font-mono font-normal')} aria-hidden="true">
                {GROUP_LABELS[group]} · {lines.length}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {lines.map((line) => {
                  const deps = dependenciesOf(index, line).length;
                  const warn = hasWarnings(line);
                  return (
                    <li key={line.id}>
                      <button type="button" data-row className={rowClass} aria-current={selectedId === line.id} onClick={() => onSelect(line.id)}>
                        <LineBadge index={index} lineId={line.id} code={line.code} />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          <span className="sr-only">{line.code}:</span>{' '}
                          {line.name}
                        </span>
                        <span className="text-[10.5px] whitespace-nowrap text-fg-3 tabular-nums">
                          {isUnobserved(line) ? (
                            <span className="rounded border border-line-strong px-1">no traffic</span>
                          ) : (
                            `${deps} dep${deps === 1 ? '' : 's'}`
                          )}
                          {warn && (
                            <span className="ml-1 font-semibold text-warn-fg" title="Has findings">
                              !{' '}<span className="sr-only">has warnings</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {listed.length === 0 && (
          <p className="m-0 p-2 text-sm text-fg-3" role="status">
            No line matches “{query}”. Try an endpoint name, a caller such as “Admin”, a transport such as “kafka”, or a station such as “ledger”.
          </p>
        )}
      </div>
    </div>
  );
}

/** Below 760px the index becomes a select at the top (spec "Responsive"). */
export function LineSelect({ index, selectedId, onSelect }: { index: BoardIndex; selectedId: string | null; onSelect: (lineId: string | null) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={kickerClass}>
        Line
      </label>
      <select id={id} className={fieldClass} value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
        <option value="">All lines</option>
        {GROUP_ORDER.map((group) => {
          const lines = index.lines.filter((l) => l.group === group);
          return lines.length ? (
            <optgroup key={group} label={GROUP_LABELS[group]}>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
    </div>
  );
}
