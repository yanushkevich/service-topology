import { useContext, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import type { ServiceDefinition } from '../../domain/types';
import { indexBoard, matchingLines } from '../../transit/board';
import { computeMapGeometry } from '../../transit/layout';
import { TransitRepositoryContext } from '../../transit/repository';
import type { TransitBoard } from '../../transit/types';
import { buttonClass, cx, segmentClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { LoadState } from '../../shared/ui/LoadState';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { LineCard } from './LineCard';
import { LineIndex, LineSelect } from './LineIndex';
import { StopStrip } from './StopStrip';
import { MapLegend, TransitMap } from './TransitMap';
import { useTransitBoard } from './useTransitBoard';

/** Below 760px the map is flat and the index is a select (spec "Responsive"). */
const NARROW = '(max-width: 760px)';

function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(NARROW);
      query?.addEventListener?.('change', notify);
      return () => query?.removeEventListener?.('change', notify);
    },
    () => Boolean(window.matchMedia?.(NARROW).matches),
  );
}

const panelClass = 'min-w-0 rounded-2xl border border-line bg-surface-1';

/**
 * Transit board for one service (docs/TRANSIT_BOARD.md, PRODUCT_SPEC Revision 8 §O, ADR-021):
 * line index, perspective transit map, stop strip, and line card. Spec Phase 1: example data.
 */
export function TransitBoardPage() {
  const { serviceId = '' } = useParams();
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  if (topology.status !== 'ready') {
    return (
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <LoadState state={topology} />
      </Frame>
    );
  }
  const definition = topology.index.definitions.get(serviceId);
  if (!definition) {
    return (
      <Frame>
        <h1 className="m-0 text-xl font-semibold">Transit board</h1>
        <Note>No service with ID “{serviceId}” exists in this data. Open a transit board from a service in the inspector.</Note>
      </Frame>
    );
  }
  const environmentName = topology.index.environments.get(environmentId)?.name ?? environmentId;
  return <Board key={`${definition.id}\u0000${environmentId}`} definition={definition} environmentId={environmentId} environmentName={environmentName} />;
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:px-3 max-md:pt-3">{children}</div>;
}

function Board({ definition, environmentId, environmentName }: { definition: ServiceDefinition; environmentId: string; environmentName: string }) {
  const [attempt, setAttempt] = useState(0);
  const state = useTransitBoard(definition.id, environmentId, attempt);
  const repository = useContext(TransitRepositoryContext);
  const board = state.status === 'ready' ? state.board : state.status === 'error' ? state.last : null;

  return (
    <Frame>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
        <nav aria-label="Breadcrumb" className="text-[12.5px] text-fg-3">
          {environmentName} / {definition.name} /
        </nav>
        <h1 className="m-0 text-lg font-semibold">Transit board</h1>
        <ModeSwitch />
        <span className="flex-1" />
        <span className="tag tag-simulated">
          {repository.sourceLabel}
          {board ? ` · ${board.window}` : ''}
        </span>
      </header>
      {state.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-crit px-3.5 py-2.5">
          <span>
            <b>Could not load the transit board.</b> <span className="font-mono text-crit-fg">{state.message}</span>
            {state.last && <span className="text-fg-2"> Showing the last board that loaded.</span>}
          </span>
          <button type="button" className={buttonClass('secondary', 'ml-auto')} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}
      {state.status === 'loading' ? (
        <Skeleton />
      ) : board === null ? (
        state.status === 'ready' && (
          <div className={cx(panelClass, 'grid min-h-[320px] place-items-center p-6 text-center')}>
            <div className="max-w-[460px]">
              <h2 className="m-0 mb-1.5 text-lg font-semibold">No endpoints yet</h2>
              <p className="m-0 text-fg-2">
                No entry points are known for {definition.name} in {environmentName}. The board needs API specs (proto, OpenAPI, AsyncAPI) or scheduler config for its lines, and
                OpenTelemetry traces for its routes; see <code className="font-mono text-sm">docs/TRANSIT_BOARD.md</code> (“Data sources”). Only Payment Service has example data.
              </p>
            </div>
          </div>
        )
      ) : (
        <BoardView board={board} serviceName={definition.name} />
      )}
    </Frame>
  );
}

function ModeSwitch() {
  const noteId = useId();
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="View" className="flex gap-0.5 rounded-md border border-line p-0.5">
        <button type="button" aria-pressed="true" className={segmentClass}>
          Typical route
        </button>
        <button type="button" aria-pressed="false" disabled aria-describedby={noteId} className={cx(segmentClass, 'disabled:cursor-default disabled:opacity-50')}>
          Trace replay
        </button>
      </div>
      <span id={noteId} className="sr-only">
        Trace replay is not available yet; it comes in a later phase.
      </span>
    </div>
  );
}

function BoardView({ board, serviceName }: { board: TransitBoard; serviceName: string }) {
  const index = useMemo(() => indexBoard(board), [board]);
  const narrow = useNarrow();
  // Computed once per data load (and per projection mode); selection and search never rebuild it.
  const geometry = useMemo(() => computeMapGeometry(index, { flat: narrow }), [index, narrow]);
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  const requested = params.get('line');
  const line = requested ? (index.lineById.get(requested) ?? null) : null;
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<{ lineId: string; at: number } | null>(null);
  const [indexOpen, setIndexOpen] = useState(true);
  const matches = useMemo(() => matchingLines(index, query), [index, query]);
  const focusedFinding = focus && line && focus.lineId === line.id ? focus.at : null;
  const focusStations = useMemo(() => new Set(focusedFinding !== null && line ? (line.findings[focusedFinding]?.stationIds ?? []) : []), [line, focusedFinding]);

  const select = (lineId: string | null) => {
    if ((lineId ?? null) === (line?.id ?? null)) return;
    setFocus(null);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (lineId) next.set('line', lineId);
        else next.delete('line');
        return next;
      },
      { preventScrollReset: true },
    );
  };

  return (
    <div
      className="grid grid-cols-1 gap-3.5 md:grid-cols-[auto_minmax(0,1fr)] min-[1180px]:grid-cols-[260px_minmax(0,1fr)_330px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && line) {
          e.preventDefault();
          select(null);
        }
      }}
    >
      <nav aria-label="Lines" className={cx(panelClass, 'self-start p-3.5 md:row-span-2 md:row-start-1', indexOpen ? 'md:w-[240px] min-[1180px]:w-auto' : 'md:w-auto')}>
        <button
          type="button"
          className={buttonClass('ghost', 'mb-2 max-md:hidden min-[1180px]:hidden')}
          aria-expanded={indexOpen}
          onClick={() => setIndexOpen((open) => !open)}
        >
          <Icon name={indexOpen ? 'chevronDown' : 'chevronRight'} />
          Lines
        </button>
        <div className="md:hidden">
          <LineSelect index={index} selectedId={line?.id ?? null} onSelect={select} />
        </div>
        <div className={cx('max-md:hidden', !indexOpen && 'md:max-[1179px]:hidden')}>
          <LineIndex index={index} query={query} onQuery={setQuery} matches={matches} selectedId={line?.id ?? null} onSelect={select} />
        </div>
      </nav>

      <section aria-label="Map" className={cx(panelClass, 'relative flex flex-col justify-center overflow-hidden bg-stage p-1.5 pb-12 max-md:pb-1.5 md:col-start-2 md:row-start-1')}>
        <TransitMap index={index} geometry={geometry} serviceName={serviceName} selectedId={line?.id ?? null} matches={query.trim() ? matches : null} focusStations={focusStations} onSelect={select} />
        <MapLegend className="max-md:hidden" />
      </section>

      <section aria-label="Stop strip" className={cx(panelClass, 'px-4 py-3 md:col-start-2 md:row-start-2 min-[1180px]:col-span-2')}>
        <StopStrip index={index} line={line} focusStations={focusStations} />
      </section>

      <aside
        aria-label="Line card"
        className={cx(panelClass, 'p-4 md:col-span-2 md:row-start-3 min-[1180px]:col-span-1 min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:max-h-[600px] min-[1180px]:overflow-auto')}
      >
        <LineCard index={index} line={line} focusedFinding={focusedFinding} onFocusFinding={(at) => setFocus(at === null || !line ? null : { lineId: line.id, at })} />
        {line && (
          <p className="m-0 mt-4 text-xs">
            <Link to={{ pathname: '/map', search: search.replace(/([?&])line=[^&]*&?/, '$1') }} className="text-accent-fg underline">
              Back to the service map
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[260px_minmax(0,1fr)]" role="status" aria-label="Loading the transit board">
      <div className={cx(panelClass, 'flex flex-col gap-2 p-3.5')}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-surface-3" />
        ))}
      </div>
      <div className={cx(panelClass, 'grid min-h-[320px] place-items-center bg-stage')}>
        <svg viewBox="0 0 400 120" className="w-2/3" aria-hidden="true">
          <path d="M20 60H380M120 60V20M120 60V100" stroke="var(--color-line-strong)" strokeWidth="6" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
