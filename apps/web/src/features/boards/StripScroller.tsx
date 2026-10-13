import type { ReactNode } from 'react';

/**
 * The horizontally scrolling body of a board strip. It is a focusable, labelled region, so keyboard
 * users can scroll it with the arrow keys even when it holds no focusable content (WCAG 2.1.1; axe
 * `scrollable-region-focusable`).
 */
export function StripScroller({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-md pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      {children}
    </div>
  );
}
