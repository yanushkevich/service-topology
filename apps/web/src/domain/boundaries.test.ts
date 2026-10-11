import { describe, expect, it } from 'vitest';

// Raw source of every non-test module in src/domain, loaded by Vite at test time.
const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('domain boundary (ADR-001)', () => {
  it('has modules to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(sources))('%s imports no renderer, UI, or state libraries', (_path, source) => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of imports) {
      expect(specifier).toMatch(/^\.\//); // domain modules import only each other
    }
  });
});
