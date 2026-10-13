import { useContext, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import type { BoardDefinition } from '../../transit/definition';
import { TransitRepositoryContext } from '../../transit/repository';
import { cx, kickerClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { Modal } from '../../shared/ui/Modal';
import { useUiStore } from '../../state/uiStore';
import { locationOf, quickSearch, searchItems, type SearchItem } from './quickSearch';

/** One row of the result list: a search item, or the explicit "filter the registry" option. */
type Option = { item: SearchItem } | { filter: string };

/**
 * Quick search (ADR-033; the design reference's command palette): a combobox over everything
 * the app can open. Arrow keys move, Enter opens, Escape closes. Choosing a result opens it;
 * typing never navigates.
 */
export function QuickSearchDialog({ pages, onClose }: { pages: readonly { path: string; label: string }[]; onClose: () => void }) {
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  const transit = useContext(TransitRepositoryContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [boards, setBoards] = useState<BoardDefinition[]>([]);
  const ids = useId();
  useEffect(() => {
    const controller = new AbortController();
    transit
      .boardDefinitions(controller.signal)
      .then(setBoards)
      .catch(() => undefined); // Endpoints are optional: the search works without them.
    return () => controller.abort();
  }, [transit]);

  const index = topology.status === 'ready' ? topology.index : null;
  const items = useMemo(() => (index ? searchItems({ index, environmentId, boards, pages }) : []), [index, environmentId, boards, pages]);
  const results = useMemo(() => quickSearch(items, query), [items, query]);
  const text = query.trim();
  const options: Option[] = [...results.groups.flatMap((g) => g.items.map((item) => ({ item }))), ...(text ? [{ filter: text }] : [])];
  const optionId = (i: number) => `${ids}-option-${i}`;
  const current = Math.min(active, options.length - 1);
  useEffect(() => {
    document.getElementById(`${ids}-option-${current}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [ids, current]);

  const open = (option: Option | undefined) => {
    if (!option) return;
    onClose();
    const { setFilters, select } = useUiStore.getState();
    if ('filter' in option) {
      setFilters({ query: option.filter });
      navigate({ pathname: '/registry', search: location.search });
      return;
    }
    const { target } = option.item;
    if (target.kind === 'entity') select(target.ref);
    navigate(locationOf(target, location.search, location.pathname));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: options.length - 1 };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      setActive(Math.max(0, Math.min(options.length - 1, next)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      open(options[current]);
    }
  };

  const keyOf = (option: Option) => ('item' in option ? option.item.key : 'filter');
  const position = new Map(options.map((option, i) => [keyOf(option), i]));
  const optionProps = (option: Option) => {
    const i = position.get(keyOf(option)) ?? -1;
    return {
      id: optionId(i),
      role: 'option',
      'aria-selected': i === current,
      onMouseMove: () => i !== current && setActive(i),
      onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(), // keep focus in the field
      onClick: () => open(option),
      className: 'flex cursor-pointer items-baseline gap-2.5 rounded-md px-2.5 py-1.5 aria-selected:bg-accent-soft aria-selected:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]',
    } as const;
  };

  return (
    <Modal
      title="Search"
      onClose={onClose}
      footer={<span className="mr-auto text-xs text-fg-3">↑ ↓ to move · Enter to open · Esc to close</span>}
    >
      <div className="flex h-9 items-center gap-2 rounded-md border border-control bg-surface-2 px-2.5 text-fg-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Icon name="search" />
        <label htmlFor={`${ids}-input`} className="sr-only">
          Search services, flows, events, endpoints, and pages
        </label>
        <input
          id={`${ids}-input`}
          data-autofocus
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={`${ids}-list`}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? optionId(current) : undefined}
          className="min-w-0 flex-1 border-0 bg-transparent text-fg placeholder:text-fg-3 focus-visible:outline-none"
          placeholder="Jump to a service, flow, event, endpoint, or page"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div id={`${ids}-list`} role="listbox" aria-label="Results" className="mt-2 flex flex-col gap-2">
        {results.groups.map(({ group, heading, items: shown }) => (
          <div key={group} role="group" aria-labelledby={`${ids}-${group}`}>
            <div id={`${ids}-${group}`} className={cx(kickerClass, 'px-2.5 pb-0.5')}>
              {heading}
            </div>
            {shown.map((item) => (
              <div key={item.key} {...optionProps({ item })} data-result={item.target.kind}>
                <span className="min-w-0 truncate font-medium text-fg">{item.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-3">{item.detail}</span>
              </div>
            ))}
            {results.more[group] !== undefined && <div className="px-2.5 text-xs text-fg-3">and {results.more[group]} more: type more of the name</div>}
          </div>
        ))}
        {text && (
          <div role="group" aria-label="Filter">
            <div {...optionProps({ filter: text })} data-result="filter">
              <span className="font-medium text-fg">Filter the registry for “{text}”</span>
            </div>
          </div>
        )}
      </div>
      {text && results.groups.length === 0 && (
        <p className="m-0 mt-2 px-2.5 text-sm text-fg-2">
          Nothing is named “{text}”. Try a service, a flow step, an event, or an endpoint such as “Capture”.
        </p>
      )}
    </Modal>
  );
}
