import { useState } from 'react';

/**
 * Keeps the first value seen for a key, so a value rebuilt on every render (or every simulation
 * tick) only changes identity when its key does. Memos and layouts that depend on it rerun only
 * on a real change. Uses React's "adjust state while rendering" pattern.
 */
export function useKeyed<T>(value: T, key: string): T {
  const [kept, setKept] = useState({ key, value });
  if (kept.key !== key) {
    setKept({ key, value });
    return value;
  }
  return kept.value;
}
