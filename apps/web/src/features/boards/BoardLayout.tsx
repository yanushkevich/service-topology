import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { boardPanelClass, buttonClass, cx } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';

/**
 * Shared layout of the transit and flow boards (docs/TRANSIT_BOARD.md "Screen layout"): a
 * scrolling frame, a header, and a four-panel grid — index, map, strip, card — that is three
 * columns at ≥ 1180px, index drawer + map with the card below at 761–1179px, and one column
 * (index as a select, then map, strip, card) below 760px.
 */

export function BoardFrame({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:px-3 max-md:pt-3">{children}</div>;
}

/** Breadcrumb, title, mode switch, then right-aligned controls (window, data label). */
export function BoardHeader({ breadcrumb, title, modes, aside }: { breadcrumb: ReactNode; title: ReactNode; modes?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line pb-3">
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-fg-3">
        {breadcrumb}
      </nav>
      <h1 className="m-0 text-lg font-semibold">{title}</h1>
      {modes}
      <span className="flex-1" />
      {aside}
    </header>
  );
}

export interface BoardGridProps {
  /** Landmark labels, e.g. "Lines", "Map", "Stop strip", "Line card". */
  labels: { index: string; map: string; strip: string; card: string };
  /** The index panel: the full list, and (below 760px) a compact replacement such as a select. */
  index: ReactNode;
  narrowIndex?: ReactNode;
  map: ReactNode;
  /** Shown at the bottom of the map panel on wide screens. */
  legend?: ReactNode;
  strip: ReactNode;
  card: ReactNode;
  /** Width of the card column at ≥ 1180px. */
  cardWidth?: 330 | 340;
  /**
   * The flow board's arrangement (ADR-023): the index is a compact bar across the top, and the map
   * takes the full width beside the card, because a swimlane needs width more than a list does.
   */
  wideMap?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
}

export function BoardGrid(props: BoardGridProps) {
  return props.wideMap ? <WideMapGrid {...props} /> : <ThreeColumnGrid {...props} />;
}

function ThreeColumnGrid({ labels, index, narrowIndex, map, legend, strip, card, cardWidth = 330, onKeyDown }: BoardGridProps) {
  const [indexOpen, setIndexOpen] = useState(true);
  return (
    <div
      className={cx(
        'grid grid-cols-1 gap-3.5 md:grid-cols-[auto_minmax(0,1fr)]',
        cardWidth === 330 ? 'min-[1180px]:grid-cols-[260px_minmax(0,1fr)_330px]' : 'min-[1180px]:grid-cols-[260px_minmax(0,1fr)_340px]',
      )}
      onKeyDown={onKeyDown}
    >
      <nav aria-label={labels.index} className={cx(boardPanelClass, 'self-start p-3.5 md:row-span-2 md:row-start-1', indexOpen ? 'md:w-[240px] min-[1180px]:w-auto' : 'md:w-auto')}>
        <button type="button" className={buttonClass('ghost', 'mb-2 max-md:hidden min-[1180px]:hidden')} aria-expanded={indexOpen} onClick={() => setIndexOpen((open) => !open)}>
          <Icon name={indexOpen ? 'chevronDown' : 'chevronRight'} />
          {labels.index}
        </button>
        {narrowIndex && <div className="md:hidden">{narrowIndex}</div>}
        <div className={cx(narrowIndex ? 'max-md:hidden' : undefined, !indexOpen && 'md:max-[1179px]:hidden')}>{index}</div>
      </nav>
      <section aria-label={labels.map} className={cx(boardPanelClass, 'relative flex flex-col justify-center overflow-hidden bg-stage p-1.5 pb-12 max-md:pb-1.5 md:col-start-2 md:row-start-1')}>
        {map}
        {legend}
      </section>
      <section aria-label={labels.strip} className={cx(boardPanelClass, 'px-4 py-3 md:col-start-2 md:row-start-2 min-[1180px]:col-span-2')}>
        {strip}
      </section>
      <aside
        aria-label={labels.card}
        className={cx(boardPanelClass, 'p-4 md:col-span-2 md:row-start-3 min-[1180px]:col-span-1 min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:overflow-auto', cardWidth === 330 ? 'min-[1180px]:max-h-[600px]' : 'min-[1180px]:max-h-[640px]')}
      >
        {card}
      </aside>
    </div>
  );
}

function WideMapGrid({ labels, index, map, legend, strip, card, onKeyDown }: BoardGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3.5 min-[1180px]:grid-cols-[minmax(0,1fr)_340px]" onKeyDown={onKeyDown}>
      <nav aria-label={labels.index} className={cx(boardPanelClass, 'px-3.5 py-2.5 min-[1180px]:col-span-2')}>
        {index}
      </nav>
      <section aria-label={labels.map} className={cx(boardPanelClass, 'relative overflow-hidden bg-stage pb-12 max-md:pb-0')}>
        {map}
        {legend}
      </section>
      <aside aria-label={labels.card} className={cx(boardPanelClass, 'p-4 min-[1180px]:col-start-2 min-[1180px]:row-span-2 min-[1180px]:row-start-2 min-[1180px]:max-h-[820px] min-[1180px]:self-start min-[1180px]:overflow-auto')}>
        {card}
      </aside>
      <section aria-label={labels.strip} className={cx(boardPanelClass, 'px-4 py-3 max-[1179px]:row-start-3 min-[1180px]:col-start-1 min-[1180px]:row-start-3')}>
        {strip}
      </section>
    </div>
  );
}

/** Loading placeholder of a board: shimmer rows and a grey track. */
export function BoardSkeleton({ label }: { label: string }) {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[260px_minmax(0,1fr)]" role="status" aria-label={label}>
      <div className={cx(boardPanelClass, 'flex flex-col gap-2 p-3.5')}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-surface-3" />
        ))}
      </div>
      <div className={cx(boardPanelClass, 'grid min-h-[320px] place-items-center bg-stage')}>
        <svg viewBox="0 0 400 120" className="w-2/3" aria-hidden="true">
          <path d="M20 60H380M120 60V20M120 60V100" stroke="var(--color-line-strong)" strokeWidth="6" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
