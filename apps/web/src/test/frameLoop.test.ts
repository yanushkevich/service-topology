import { describe, expect, it } from 'vitest';

/**
 * Guard (ARCHITECTURE §11, Milestone 5): no React state updates at animation-frame frequency.
 * Scans every `useFrame(...)` callback and `requestAnimationFrame(...)` callback in the app for
 * React setters (`setX(`) and store updates (`setState`, `getState().set…`). Three.js mutators
 * such as `setMatrixAt` are allowed.
 */
const sources = import.meta.glob<string>(['../**/*.tsx', '../**/*.ts', '!../**/*.test.*', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ALLOWED = new Set(['setMatrixAt', 'setColorAt', 'setFromUnitVectors', 'setAttribute', 'setTranslation']);

/** Body of the first argument of each call to `name(` (balanced parentheses). */
function callbacks(source: string, name: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(`${name}(`, from);
    if (start < 0) return out;
    let depth = 0;
    let i = start + name.length;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')' && --depth === 0) break;
    }
    out.push(source.slice(start, i + 1));
    from = i;
  }
}

describe('frame loop guard', () => {
  const frameCallbacks = Object.entries(sources).flatMap(([path, source]) =>
    [...callbacks(source, 'useFrame'), ...callbacks(source, 'requestAnimationFrame')].map((body) => ({ path, body })),
  );

  it('finds the frame callbacks it is meant to guard', () => {
    expect(frameCallbacks.filter((c) => c.body.startsWith('useFrame')).length).toBeGreaterThanOrEqual(2);
  });

  it.each(frameCallbacks.map((c, i) => [`${c.path} #${i}`, c.body] as const))('%s updates no React/store state', (_name, body) => {
    const setters = [...body.matchAll(/\b(set[A-Z]\w*)\s*\(/g)].map((m) => m[1]!).filter((n) => !ALLOWED.has(n));
    expect(setters).toEqual([]);
    expect(body).not.toMatch(/\.setState\(|getState\(\)\.\w+\(/);
  });
});
