import { useMemo } from 'react';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { typeLabel } from '../../../shared/mappings';
import { Icon } from '../../../shared/ui/Icon';
import { useUiStore } from '../../../state/uiStore';
import { buildTopologyGraph } from '../graph/topologyGraph';
import styles from './topology2d.module.css';

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
    <div className={`${styles.float} ${styles.groupsPanel}`} role="dialog" aria-label="Infrastructure groups">
      <div className={styles.menuHeader}>
        <b>Groups</b>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close groups">
          <Icon name="close" />
        </button>
      </div>
      {ordered.length === 0 ? (
        <p className={styles.menuMessage}>No groups for the current filters.</p>
      ) : (
        <ul className={styles.groupList}>
          {ordered.map((g) => {
            const isCollapsed = collapsed.has(g.id);
            const hidden = insideCollapsed(g.id);
            return (
              <li key={g.id} style={{ paddingLeft: g.depth * 14 }} className={hidden ? styles.groupHidden : undefined}>
                <button
                  type="button"
                  className={styles.groupToggleButton}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${g.label}`}
                  onClick={() => onToggle(g.id)}
                  disabled={hidden}
                >
                  {isCollapsed ? '+' : '−'}
                </button>
                <button type="button" className={styles.groupName} onClick={() => g.ref && select(g.ref)} disabled={!g.ref}>
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
