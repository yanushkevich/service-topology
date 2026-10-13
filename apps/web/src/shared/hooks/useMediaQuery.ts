import { useSyncExternalStore } from 'react';

/** Below this width boards stack, maps go flat, and line lists become selects (spec "Responsive"). */
export const NARROW_QUERY = '(max-width: 760px)';

/** Whether a CSS media query matches, kept current as the viewport changes. False without matchMedia. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(query);
      list?.addEventListener?.('change', notify);
      return () => list?.removeEventListener?.('change', notify);
    },
    () => Boolean(window.matchMedia?.(query).matches),
  );
}
