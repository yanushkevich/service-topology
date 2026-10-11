import { useMemo } from 'react';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { typeLabel } from '../../../shared/mappings';
import { Icon } from '../../../shared/ui/Icon';
import { useUiStore } from '../../../state/uiStore';
import { buildTopologyGraph } from '../graph/topologyGraph';

/**
 * Full-size equivalent of the in-canvas group headers (WCAG 2.5.8 "equivalent" exception): those
 * scale with zoom and can become tiny. Lists every group of grouped-infrastructure mode with
 * select and collapse/expand, operable by keyboard at a fixed, readable size.
 */
export function GroupsPanel({
  index,
  collapsed,
  onToggle,
  onClose,
}: {
  index: TopologyIndex;
  collapsed: ReadonlySet<string>;
  onToggle: (groupId: string) => void;
  onClose: () => void;
}) {
  const environmentId = useUiStore((s) => s.environmentId);
  const filters = useUiStore((s) => s.filters);
  const neighborhood = useUiStore((s) => s.neighborhood);
  const select = useUiStore((s) => s.select);
  // Uncollapsed structure, so collapsed groups and their nested groups are still listed.
  const groups = useMemo(
    () => buildTopologyGraph(index, { environmentId, filters, mode: 'infrastructure', neighborhood: neighborhood ?? undefined }).groups,
    [index, environmentId, filters, neighborhood],
  );
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]));
  const insideCollapsed = (id: string) => {
    let parent = parentOf.get(id);
    while (parent) {
      if (collapsed.has(parent)) return true;
      parent = parentOf.get(parent);
    }
    return false;
  };
  // Depth-first order: parents followed by their children.
  const ordered: typeof groups = [];
  const visit = (parentId: string | undefined) => {
    for (const g of groups.filter((x) => x.parentId === parentId).sort((a, b) => a.label.localeCompare(b.label))) {
      ordered.push(g);
      visit(g.id);
    }
  };
  visit(undefined);

  return (
    <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] top-3 right-3 z-20 max-h-[calc(100%-140px)] w-[300px] max-w-[calc(100%-24px)] overflow-auto px-3 pt-2.5 pb-3 text-sm`} role="dialog" aria-label="Infrastructure groups">
      <div className="mb-1.5 flex items-center justify-between">
        <b>Groups</b>
        <button type="button" className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={onClose} aria-label="Close groups">
          <Icon name="close" />
        </button>
      </div>
      {ordered.length === 0 ? (
        <p className="mt-2 mb-0 text-fg-2">No groups for the current filters.</p>
      ) : (
        <ul className="m-0 mt-1.5 list-none p-0 [&_li]:flex [&_li]:min-h-8 [&_li]:items-center [&_li]:gap-1">
          {ordered.map((g) => {
            const isCollapsed = collapsed.has(g.id);
            const hidden = insideCollapsed(g.id);
            return (
              <li key={g.id} style={{ paddingLeft: g.depth * 14 }} className={hidden ? 'opacity-55' : undefined}>
                <button
                  type="button"
                  className="size-6.5 flex-none rounded-sm border border-control text-fg"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${g.label}`}
                  onClick={() => onToggle(g.id)}
                  disabled={hidden}
                >
                  {isCollapsed ? '+' : '−'}
                </button>
                <button type="button" className="flex min-h-7 min-w-0 flex-1 items-baseline gap-1.5 rounded-sm px-1.5 py-0.5 text-left enabled:hover:bg-surface-3 [&_b]:truncate [&_b]:text-fg [&_span]:text-[10.5px] [&_span]:whitespace-nowrap [&_span]:text-fg-3" onClick={() => g.ref && select(g.ref)} disabled={!g.ref}>
                  <b>{g.label}</b>
                  <span>{g.type === 'provider' ? 'Provider' : typeLabel(g.type)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
