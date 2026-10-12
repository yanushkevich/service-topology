import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './classes';
import { Icon } from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog over a scrim (mock command palette, Main.dc.html). Focus moves into the dialog,
 * stays there (Tab wraps), Escape or the scrim closes it, and focus returns to where it was.
 * `side` docks it to the right edge as a full-height sheet (forms); otherwise it is centred.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  side = false,
  closeLabel = 'Close',
  busy = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  side?: boolean;
  closeLabel?: string;
  /** While busy, Escape and the scrim do not close it (a save is in flight). */
  busy?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const isBusy = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    isBusy.current = busy;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy.current) {
        event.stopPropagation();
        close.current();
      } else if (event.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (!firstItem || !lastItem) return;
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div
      className={cx('fixed inset-0 z-80 flex bg-scrim', side ? 'justify-end' : 'items-start justify-center px-4 pt-[12vh]')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy.current) close.current();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx(
          'flex flex-col overflow-hidden border border-line bg-float shadow-float backdrop-blur-[10px] focus:outline-none',
          side ? 'h-full w-[460px] max-w-full rounded-l-xl' : 'max-h-[76vh] w-[520px] max-w-full rounded-xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="m-0 mt-0.5 text-sm text-fg-2">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg disabled:opacity-50"
            onClick={onClose}
            aria-label={closeLabel}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
