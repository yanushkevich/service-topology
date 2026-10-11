import { useCallback, useEffect, useId, useState } from 'react';
import { SAVED_LAYOUT_SCHEMA_VERSION, type SavedLayout } from '../../../data/savedLayouts/savedLayout';
import { useSavedLayoutRepository } from '../../../data/savedLayouts/savedLayoutContext';
import { formatTimestamp } from '../../../shared/format';
import { Icon } from '../../../shared/ui/Icon';
import { useUiStore } from '../../../state/uiStore';
import styles from './topology2d.module.css';

interface LayoutsMenuProps {
  /** Current node positions keyed by canonical ID (relative to group in infrastructure mode). */
  currentPositions: () => Record<string, { x: number; y: number }>;
  collapsedGroupIds: ReadonlySet<string>;
  onApply: (layout: SavedLayout) => void;
  onClose: () => void;
}

/** Save/apply/delete layouts through the SavedLayoutRepository; nothing renderer-specific is stored. */
export function LayoutsMenu({ currentPositions, collapsedGroupIds, onApply, onClose }: LayoutsMenuProps) {
  const repository = useSavedLayoutRepository();
  const [layouts, setLayouts] = useState<SavedLayout[] | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const nameId = useId();

  const refresh = useCallback(() => {
    repository
      .list()
      .then(setLayouts)
      .catch(() => setLayouts([]));
  }, [repository]);
  useEffect(refresh, [refresh]);

  const save = async () => {
    const { environmentId, layoutMode, filters } = useUiStore.getState();
    const layout: SavedLayout = {
      schemaVersion: SAVED_LAYOUT_SCHEMA_VERSION,
      id: `layout-${Date.now().toString(36)}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      view: {
        environmentId,
        layoutMode,
        filters: { ...filters, providers: [...filters.providers], health: [...filters.health], groups: [...filters.groups] },
        collapsedGroupIds: [...collapsedGroupIds].sort(),
      },
      positions: currentPositions(),
    };
    try {
      await repository.save(layout);
      setName('');
      setMessage(`Saved “${layout.name}”.`);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the layout.');
    }
  };

  return (
    <div className={`${styles.float} ${styles.layoutsMenu}`} role="dialog" aria-label="Saved layouts">
      <div className={styles.menuHeader}>
        <b>Saved layouts</b>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close saved layouts">
          <Icon name="close" />
        </button>
      </div>
      <form
        className={styles.saveRow}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={nameId} className="visually-hidden">
          Layout name
        </label>
        <input
          id={nameId}
          className={styles.input}
          placeholder="Name this layout"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <button type="submit" className={styles.primary} disabled={!name.trim()}>
          Save
        </button>
      </form>
      {message && (
        <p className={styles.menuMessage} role="status">
          {message}
        </p>
      )}
      {layouts === null ? (
        <p className={styles.menuMessage}>Loading…</p>
      ) : layouts.length === 0 ? (
        <p className={styles.menuMessage}>No saved layouts yet. Positions, collapsed groups, mode, environment, and filters are saved.</p>
      ) : (
        <ul className={styles.layoutList}>
          {layouts.map((layout) => (
            <li key={layout.id}>
              <span className={styles.layoutText}>
                <b>{layout.name}</b>
                <span className="mono">
                  {layout.view.environmentId} · {layout.view.layoutMode} · {formatTimestamp(layout.createdAt)}
                </span>
              </span>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  onApply(layout);
                  setMessage(`Applied “${layout.name}”.`);
                }}
                aria-label={`Apply ${layout.name}`}
              >
                Apply
              </button>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  void repository.remove(layout.id).then(refresh);
                }}
                aria-label={`Delete ${layout.name}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
