import { useSyncExternalStore } from 'react';
import { usePreferencesStore } from './preferencesStore';

/**
 * One answer to "should motion be reduced?" for the whole app: the OS preference or the Settings
 * override. CSS follows the same rule (global.css: prefers-reduced-motion and data-motion="reduce").
 */
const QUERY = '(prefers-reduced-motion: reduce)';

export function isMotionReduced(): boolean {
  if (usePreferencesStore.getState().preferences.motion === 'reduce') return true;
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches);
}

export function useMotionReduced(): boolean {
  const override = usePreferencesStore((s) => s.preferences.motion === 'reduce');
  const system = useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(QUERY);
      query?.addEventListener?.('change', notify);
      return () => query?.removeEventListener?.('change', notify);
    },
    () => Boolean(window.matchMedia?.(QUERY).matches),
  );
  return override || system;
}
