import { useEffect } from 'react';

/** Marks a title this hook added, so it can be removed again when the text fits. */
const AUTO = 'data-auto-title';
/** How far up from the pointer's target to look for the truncating element. */
const MAX_DEPTH = 4;

/**
 * Shows the full text of any name cut off with "…" as a native tooltip, app-wide: on pointer over,
 * the nearest element with `text-overflow: ellipsis` that overflows gets its text as `title`.
 * Elements with their own title are left alone. Screen readers already get the full text.
 */
export function useTruncationTitles(): void {
  useEffect(() => {
    const onOver = (event: Event) => {
      const el = truncatingAncestor(event.target);
      if (el) syncTitle(el);
    };
    document.addEventListener('pointerover', onOver);
    return () => document.removeEventListener('pointerover', onOver);
  }, []);
}

function truncatingAncestor(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    if (getComputedStyle(el).textOverflow === 'ellipsis') return el;
  }
  return null;
}

function syncTitle(el: HTMLElement): void {
  const truncated = el.scrollWidth > el.clientWidth;
  const auto = el.hasAttribute(AUTO);
  if (truncated && !el.hasAttribute('title')) {
    el.setAttribute('title', (el.textContent ?? '').trim());
    el.setAttribute(AUTO, '');
  } else if (!truncated && auto) {
    el.removeAttribute('title');
    el.removeAttribute(AUTO);
  }
}
