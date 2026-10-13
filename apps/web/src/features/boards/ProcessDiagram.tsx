import type { ReactNode } from 'react';
import type { FragmentType, Lifeline, MessageStyle, Process, ProcessItem, Section } from '../../transit/process';
import { cx } from '../../shared/ui/classes';
import { StripScroller } from './StripScroller';

/**
 * A process as a sequence diagram (ADR-028): lifelines across, messages and fragments down. It is
 * an ordered list laid out on a CSS subgrid, so it reads in order without the drawing; each item
 * also says in words who talks to whom.
 */
export function ProcessDiagram({ process, label }: { process: Process; label: string }) {
  const columns = process.lifelines.length;
  const at = new Map(process.lifelines.map((l, i) => [l.id, i + 1]));
  const name = (id: string) => process.lifelines.find((l) => l.id === id)?.name ?? id;
  const template = { gridTemplateColumns: `repeat(${columns}, minmax(112px, 1fr))` };
  return (
    <StripScroller label={`${label}, scrollable`}>
      <div className="relative grid min-w-max gap-y-1.5 pb-2" style={template} data-process>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid" style={template}>
          {process.lifelines.map((l) => (
            <span key={l.id} className="mx-auto mt-9 w-0 border-l border-dashed border-line-strong" />
          ))}
        </div>
        {process.lifelines.map((l) => (
          <LifelineHead key={l.id} lifeline={l} />
        ))}
        <ol aria-label={label} className="relative col-span-full m-0 grid list-none grid-cols-subgrid gap-y-1.5 p-0">
          {process.items.map((item) => (
            <Item key={item.id} item={item} at={at} name={name} />
          ))}
        </ol>
      </div>
    </StripScroller>
  );
}

function LifelineHead({ lifeline }: { lifeline: Lifeline }) {
  return (
    <div className="relative z-1 mx-1 flex flex-col items-center rounded-md border border-line-strong bg-surface-1 px-2 py-1 text-center" data-lifeline={lifeline.id}>
      <span className="line-clamp-2 text-xs font-semibold text-fg">{lifeline.name}</span>
      {lifeline.sub && <span className="font-mono text-[10px] text-fg-3">{lifeline.sub}</span>}
    </div>
  );
}

type Lookup = { at: ReadonlyMap<string, number>; name: (id: string) => string };

function Item({ item, at, name }: { item: ProcessItem } & Lookup) {
  switch (item.kind) {
    case 'message':
      return <Message item={item} at={at} name={name} />;
    case 'note':
      return (
        <li className="col-span-full grid grid-cols-subgrid" data-note>
          <span className="relative z-1 mx-1 rounded-sm border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-2" style={{ gridColumn: `${at.get(item.at) ?? 1}` }}>
            <span className="sr-only">Note at {name(item.at)}: </span>
            {item.text}
          </span>
        </li>
      );
    case 'fragment':
      return <Fragment item={item} at={at} name={name} />;
  }
}

const STROKE: Record<MessageStyle, string> = {
  call: 'border-fg-2',
  async: 'border-dashed border-fg-2',
  reply: 'border-dashed border-fg-3',
  write: 'border-accent',
  read: 'border-fg-3',
  local: 'border-fg-2',
};
const VERB: Record<MessageStyle, string> = { call: 'calls', async: 'sends to', reply: 'replies to', write: 'writes to', read: 'reads from', local: 'continues in' };

function Message({ item, at, name }: { item: Extract<ProcessItem, { kind: 'message' }> } & Lookup) {
  const a = at.get(item.from) ?? 1;
  const b = at.get(item.to) ?? a;
  const self = a === b;
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  const rightward = b >= a;
  const words = `${name(item.from)} ${VERB[item.style]} ${self ? 'itself' : name(item.to)}: ${item.label}${item.guards.length ? ` (${item.guards.join(', ')})` : ''}`;
  return (
    <li className="col-span-full grid grid-cols-subgrid" data-message={item.id} data-style={item.style}>
      <span className="sr-only">{words}</span>
      <span aria-hidden="true" className="relative z-1 flex flex-col px-[calc(50%/var(--span))]" style={{ gridColumn: `${left} / ${right + 1}`, ['--span' as string]: String(right - left + 1) }}>
        <span className="px-1 text-center font-mono text-[11px] whitespace-nowrap text-fg">
          {self && '↺ '}
          {item.label}
        </span>
        {item.guards.length > 0 && <span className="px-1 text-center text-[10px] whitespace-nowrap text-fg-3">[{item.guards.join(' · ')}]</span>}
        {!self && (
          <span className="relative mt-0.5 h-2">
            <span className={cx('absolute inset-x-0 top-1 border-t-2', STROKE[item.style])} />
            <span className={cx('absolute top-0 size-0 border-y-4 border-y-transparent', rightward ? '-right-px border-l-[7px] border-l-fg-2' : '-left-px border-r-[7px] border-r-fg-2')} />
          </span>
        )}
      </span>
    </li>
  );
}

const FRAME: Record<FragmentType, string> = {
  alt: 'border-line-strong',
  opt: 'border-line-strong',
  loop: 'border-line-strong',
  par: 'border-line-strong',
  transaction: 'border-accent-ring bg-accent-soft/40',
  compensation: 'border-dashed border-indigo',
};
const TITLE: Record<FragmentType, string> = { alt: 'alt', opt: 'opt', loop: 'loop', par: 'par', transaction: 'transaction', compensation: 'compensate' };

function Fragment({ item, at, name }: { item: Extract<ProcessItem, { kind: 'fragment' }> } & Lookup) {
  return (
    <li className={cx('relative z-1 col-span-full mx-1 grid grid-cols-subgrid rounded-md border py-1', FRAME[item.type])} data-fragment={item.type}>
      <span className="col-span-full flex items-center gap-1.5 px-2">
        <span className="rounded-sm bg-surface-3 px-1.5 font-mono text-[10px] tracking-[0.07em] text-fg uppercase">{TITLE[item.type]}</span>
        {item.guard && item.type !== 'alt' && <span className="font-mono text-[11px] text-fg-2">{item.guard}</span>}
      </span>
      {item.sections.map((section, i) => (
        <SectionView key={i} section={section} first={i === 0} type={item.type} at={at} name={name} />
      ))}
    </li>
  );
}

function SectionView({ section, first, type, at, name }: { section: Section; first: boolean; type: FragmentType } & Lookup) {
  // An alt names each section's condition; a loop or opt already shows it in its title.
  const guard = type === 'alt' || (type === 'par' && !first) ? section.guard : undefined;
  const heading: ReactNode =
    guard !== undefined || (type === 'alt' && section.share !== undefined) || (type === 'opt' && section.share !== undefined) ? (
      <span className="col-span-full px-2 font-mono text-[11px] text-fg-2">
        {guard !== undefined && `[${guard}]`}
        {section.share !== undefined && ` · ${Number((section.share * 100).toFixed(1))}%`}
      </span>
    ) : null;
  return (
    <div className={cx('col-span-full grid grid-cols-subgrid gap-y-1.5', !first && 'mt-1 border-t border-dashed border-line-strong pt-1')}>
      {heading}
      <ol className="col-span-full m-0 grid list-none grid-cols-subgrid gap-y-1.5 p-0" aria-label={section.guard ? `When ${section.guard}` : undefined}>
        {section.items.map((child) => (
          <Item key={child.id} item={child} at={at} name={name} />
        ))}
      </ol>
    </div>
  );
}
