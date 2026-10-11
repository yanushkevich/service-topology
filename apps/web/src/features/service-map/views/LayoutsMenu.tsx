import { useCallback, useEffect, useId, useState } from 'react';
import { SAVED_LAYOUT_SCHEMA_VERSION, type SavedLayout } from '../../../data/savedLayouts/savedLayout';
import { useSavedLayoutRepository } from '../../../data/savedLayouts/savedLayoutContext';
import { formatTimestamp } from '../../../shared/format';
import { Icon } from '../../../shared/ui/Icon';
import { useUiStore } from '../../../state/uiStore';

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
    <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] bottom-16 left-3 z-20 max-h-[60%] w-[360px] max-w-[calc(100%-24px)] overflow-auto px-3 pt-2.5 pb-3 text-sm`} role="dialog" aria-label="Saved layouts">
      <div className="mb-1.5 flex items-center justify-between">
        <b>Saved layouts</b>
        <button type="button" className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={onClose} aria-label="Close saved layouts">
          <Icon name="close" />
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={nameId} className="sr-only">
          Layout name
        </label>
        <input
          id={nameId}
          className="h-8 min-w-0 flex-1 rounded-md border border-control bg-surface-2 px-2.5 text-fg placeholder:text-fg-3"
          placeholder="Name this layout"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 font-semibold whitespace-nowrap text-on-accent hover:brightness-110 disabled:opacity-50" disabled={!name.trim()}>
          Save
        </button>
      </form>
      {message && (
        <p className="mt-2 mb-0 text-fg-2" role="status">
          {message}
        </p>
      )}
      {layouts === null ? (
        <p className="mt-2 mb-0 text-fg-2">Loading…</p>
      ) : layouts.length === 0 ? (
        <p className="mt-2 mb-0 text-fg-2">No saved layouts yet. Positions, collapsed groups, mode, environment, and filters are saved.</p>
      ) : (
        <ul className="m-0 mt-2.5 list-none p-0 [&_li]:flex [&_li]:items-center [&_li]:gap-1 [&_li]:border-t [&_li]:border-line [&_li]:py-1.5">
          {layouts.map((layout) => (
            <li key={layout.id}>
              <span className="flex min-w-0 flex-1 flex-col [&_b]:truncate [&_span]:truncate [&_span]:text-[10.5px] [&_span]:text-fg-3">
                <b>{layout.name}</b>
                <span className="font-mono">
                  {layout.view.environmentId} · {layout.view.layoutMode} · {formatTimestamp(layout.createdAt)}
                </span>
              </span>
              <button
                type="button"
                className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50"
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
                className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50"
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
