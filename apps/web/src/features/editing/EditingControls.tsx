import { useEffect, useId, useRef, useState } from 'react';
import { WRITABLE_KINDS, type WritableKind } from '../../data/repositories/TopologyRepository';
import type { EntityId } from '../../domain/types';
import { Button } from '../../shared/ui/primitives';
import { buttonClass, cx, floatClass } from '../../shared/ui/classes';
import { Icon } from '../../shared/ui/Icon';
import { KIND_HINTS, KIND_LABELS } from './entityForms';
import { useEntityEditing } from './editingContext';

/** Link that reopens the app on the backend data source (the source is chosen at startup). */
function BackendLink() {
  const url = new URL(window.location.href);
  url.searchParams.set('source', 'api');
  return (
    <a className="text-accent-fg underline" href={`${url.pathname}${url.search}`}>
      Use the backend API
    </a>
  );
}

/** Why editing is unavailable, with the way out where there is one. */
export function EditingUnavailableNote({ className }: { className?: string }) {
  const { unavailable } = useEntityEditing();
  if (!unavailable) return null;
  return (
    <p className={cx('m-0 text-sm text-fg-2', className)}>
      {unavailable.reason} {unavailable.hint === 'backend' && <BackendLink />}
    </p>
  );
}

/**
 * "New" menu in the header (ADR-020): one entry per entity kind. When editing is unavailable the
 * menu explains why instead of offering entries, so the action stays discoverable.
 */
export function NewEntityMenu() {
  const { unavailable, openCreate } = useEntityEditing();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"], a')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  const onMenuKey = (event: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };
  const choose = (kind: WritableKind) => {
    setOpen(false);
    openCreate(kind);
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        className={buttonClass('primary', 'h-8')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="plus" />
        New
        <Icon name="chevronDown" />
      </button>
      {open && (
        <div ref={menu} id={menuId} className={cx(floatClass, 'top-10 right-0 z-40 w-[300px] p-1.5')} onKeyDown={onMenuKey}>
          {unavailable ? (
            <div className="px-2 py-1.5">
              <EditingUnavailableNote />
            </div>
          ) : (
            <div role="menu" aria-label="Create">
              {WRITABLE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-3 focus-visible:bg-surface-3"
                  onClick={() => choose(kind)}
                >
                  <span className="block text-sm text-fg">{KIND_LABELS[kind]}</span>
                  <span className="block text-xs text-fg-3">{KIND_HINTS[kind]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Edit and Delete for one entity (inspector footer, event detail). Hidden reasons are shown as a note. */
export function EntityEditActions({ kind, id, label }: { kind: WritableKind; id: EntityId; label: string }) {
  const { unavailable, openEdit, openDelete } = useEntityEditing();
  if (unavailable) {
    return unavailable.hint === 'loading' ? null : <EditingUnavailableNote className="text-xs" />;
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => openEdit(kind, id)} aria-label={`Edit ${label}`}>
        <Icon name="edit" />
        Edit
      </Button>
      <Button variant="danger" onClick={() => openDelete(kind, id)} aria-label={`Delete ${label}`}>
        <Icon name="trash" />
        Delete
      </Button>
    </div>
  );
}
