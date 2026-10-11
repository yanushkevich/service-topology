import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { containmentForest, type ContainmentNode } from '../../domain/containment';
import { buildRegistryRows, hasActiveFilters, inEnvironment, matchesFilters } from '../../domain/registry';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { healthLabel, typeLabel } from '../../shared/mappings';
import { buttonClass } from '../../shared/ui/classes';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useUiStore } from '../../state/uiStore';
import { FilterBar } from '../filters/FilterBar';
import { Card, Note, PageShell } from '../pages/PageShell';

/**
 * Infrastructure (PRODUCT_SPEC Revision 5 §K.3): the containment hierarchy as a keyboard-operable
 * tree, from explicit parent references only, with health and count roll-ups.
 */
export function InfrastructurePage() {
  return <PageShell title="Infrastructure">{(index) => <InfrastructureContent index={index} />}</PageShell>;
}

interface VisibleItem {
  node: ContainmentNode;
  level: number;
  parentId: string | null;
  posinset: number;
  setsize: number;
}

/** Keep nodes that match, plus their ancestors; containment-only nodes match through descendants. */
function filterTree(nodes: ContainmentNode[], keep: (node: ContainmentNode) => boolean): ContainmentNode[] {
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, keep);
    return keep(node) || children.length > 0 ? [{ ...node, children }] : [];
  });
}

function InfrastructureContent({ index }: { index: TopologyIndex }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const filters = useUiStore((s) => s.filters);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const navigate = useNavigate();
  const { search } = useLocation();

  const rows = useMemo(() => buildRegistryRows(index).filter((r) => inEnvironment(r, environmentId)), [index, environmentId]);
  const forest = useMemo(() => containmentForest(index, environmentId), [index, environmentId]);
  const filtering = hasActiveFilters(filters);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.ref.id, r])), [rows]);
  const matches = (node: ContainmentNode) => {
    const row = rowById.get(node.id);
    if (row) return matchesFilters(row, filters);
    // Containment levels match the search text by name only; chip filters apply to entities.
    const q = filters.query.trim().toLowerCase();
    return q !== '' && filters.providers.length + filters.health.length + filters.groups.length === 0 && node.name.toLowerCase().includes(q);
  };
  const roots = useMemo(() => (filtering ? filterTree(forest.roots, matches) : forest.roots), [forest, filtering, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const independent = filtering ? forest.independent.filter(matches) : forest.independent;

  // Expanded: providers and the first two levels by default; everything while filtering.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    const walk = (nodes: ContainmentNode[], depth: number) =>
      nodes.forEach((n) => {
        if (depth < 3 && n.children.length > 0) ids.add(n.id);
        walk(n.children, depth + 1);
      });
    walk(forest.roots, 0);
    return ids;
  });
  const isExpanded = (id: string) => filtering || expanded.has(id);

  const visible: VisibleItem[] = [];
  const flatten = (nodes: ContainmentNode[], level: number, parentId: string | null) =>
    nodes.forEach((node, i) => {
      visible.push({ node, level, parentId, posinset: i + 1, setsize: nodes.length });
      if (node.children.length > 0 && isExpanded(node.id)) flatten(node.children, level + 1, node.id);
    });
  flatten(roots, 1, null);

  const [focusId, setFocusId] = useState<string | null>(null);
  const activeId = focusId && visible.some((v) => v.node.id === focusId) ? focusId : (visible[0]?.node.id ?? null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const focusItem = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    refs.current.get(id)?.focus();
  };
  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, item: VisibleItem) => {
    const i = visible.findIndex((v) => v.node.id === item.node.id);
    const hasChildren = item.node.children.length > 0;
    switch (event.key) {
      case 'ArrowDown':
        focusItem(visible[i + 1]?.node.id);
        break;
      case 'ArrowUp':
        focusItem(visible[i - 1]?.node.id);
        break;
      case 'Home':
        focusItem(visible[0]?.node.id);
        break;
      case 'End':
        focusItem(visible.at(-1)?.node.id);
        break;
      case 'ArrowRight':
        if (hasChildren && !isExpanded(item.node.id)) toggle(item.node.id, true);
        else if (hasChildren) focusItem(visible[i + 1]?.node.id);
        break;
      case 'ArrowLeft':
        if (hasChildren && isExpanded(item.node.id) && !filtering) toggle(item.node.id, false);
        else if (item.parentId) focusItem(item.parentId);
        break;
      case 'Enter':
      case ' ':
        if (item.node.ref) select(item.node.ref);
        else if (hasChildren) toggle(item.node.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const selectedNodeId = selection?.id;
  const selectedResource = selection?.kind === 'resource' && index.resources.has(selection.id) ? selection.id : null;
  const showGrouped = () => {
    const ui = useUiStore.getState();
    ui.setLayoutMode('infrastructure');
    ui.setActiveView('2d');
    navigate({ pathname: '/map', search });
  };
  const explore3d = (id: string) => {
    const ui = useUiStore.getState();
    ui.exitScopeTo(0);
    ui.enterScope(id);
    ui.setActiveView('3d');
    navigate({ pathname: '/map', search });
  };

  return (
    <>
      <FilterBar rows={rows} label="Filter infrastructure" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={showGrouped}>
          Show grouped on map
        </button>
        {selectedResource && (
          <button type="button" className={buttonClass('secondary')} onClick={() => explore3d(selectedResource)}>
            Explore {index.resources.get(selectedResource)?.name} in 3D
          </button>
        )}
        <button type="button" className={buttonClass('ghost')} onClick={() => setExpanded(new Set(visible.filter((v) => v.node.children.length).map((v) => v.node.id).concat([...expanded])))} disabled={filtering}>
          Expand visible
        </button>
        <button type="button" className={buttonClass('ghost')} onClick={() => setExpanded(new Set())} disabled={filtering}>
          Collapse all
        </button>
        <span className="text-sm text-fg-2">From explicit parent references only. Use arrow keys to move, Enter to select.</span>
      </div>

      <Card title="Containment" aside={<span className="font-mono text-sm text-fg-3">{visible.length} shown</span>}>
        {roots.length === 0 ? (
          <Note>{filtering ? 'Nothing matches the current search and filters.' : 'No infrastructure is modeled for this environment.'}</Note>
        ) : (
          <div role="tree" aria-label="Infrastructure containment" className="flex flex-col">
            {visible.map((item) => {
              const { node, level } = item;
              const hasChildren = node.children.length > 0;
              const open = hasChildren && isExpanded(node.id);
              const selected = selectedNodeId === node.id;
              return (
                <div
                  key={node.id}
                  ref={(el) => {
                    if (el) refs.current.set(node.id, el);
                    else refs.current.delete(node.id);
                  }}
                  role="treeitem"
                  aria-level={level}
                  aria-posinset={item.posinset}
                  aria-setsize={item.setsize}
                  aria-selected={selected}
                  {...(hasChildren ? { 'aria-expanded': open } : {})}
                  tabIndex={node.id === activeId ? 0 : -1}
                  onFocus={() => setFocusId(node.id)}
                  onKeyDown={(e) => onKeyDown(e, item)}
                  onClick={() => (node.ref ? select(node.ref) : hasChildren && toggle(node.id))}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md pr-2 hover:bg-surface-3 aria-selected:bg-accent-soft aria-selected:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]"
                  style={{ paddingLeft: 8 + (level - 1) * 18 }}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-5 flex-none place-items-center rounded-sm text-fg-2"
                    onClick={(e) => {
                      if (!hasChildren) return;
                      e.stopPropagation();
                      toggle(node.id);
                    }}
                  >
                    {hasChildren ? (open ? '▾' : '▸') : ''}
                  </span>
                  {node.type === 'provider' ? (
                    <span className="w-[26px]" aria-hidden="true" />
                  ) : (
                    <TypeGlyph type={node.type === 'service-instance' ? 'api' : node.type} size={14} />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-semibold">{node.name}</b>{' '}
                    <span className="text-xs text-fg-3">{node.type === 'service-instance' ? 'Service instance' : node.type === 'provider' ? 'Provider' : typeLabel(node.type)}</span>
                  </span>
                  {node.environmentId && node.type !== 'service-instance' && (
                    <span className="hidden font-mono text-[10.5px] text-fg-3 md:inline">
                      {node.environmentId}
                      {node.environmentInherited ? ' (inherited)' : ''}
                    </span>
                  )}
                  {hasChildren && (
                    <span className="font-mono text-[10.5px] whitespace-nowrap text-fg-3 max-md:hidden">
                      {node.descendantCount} inside{node.unhealthyCount > 0 ? ` · ${node.unhealthyCount} unhealthy` : ''}
                    </span>
                  )}
                  <span aria-label={`Health ${healthLabel(node.rollupHealth)}${hasChildren ? ' (worst inside)' : ''}`} className="flex">
                    <StatusShape health={node.rollupHealth} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Environment-independent" aside={<span className="text-sm text-fg-2">Shared by every environment (e.g. SaaS APIs); no containment.</span>}>
        {independent.length === 0 ? (
          <Note>None.</Note>
        ) : (
          <ul className="m-0 list-none p-0">
            {independent.map((node) => (
              <li key={node.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  aria-pressed={selectedNodeId === node.id}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-surface-3 aria-pressed:bg-accent-soft"
                  onClick={() => node.ref && select(node.ref)}
                >
                  <TypeGlyph type={node.type} size={14} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{node.name}</span>
                  <span className="text-xs text-fg-3">{typeLabel(node.type)}</span>
                  <StatusShape health={node.rollupHealth} label />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
