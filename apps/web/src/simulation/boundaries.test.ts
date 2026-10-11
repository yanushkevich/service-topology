import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

describe('simulation boundary (ARCHITECTURE §10)', () => {
  it.each(Object.entries(sources))('%s depends only on the domain and itself', (_path, source) => {
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      expect(specifier).toMatch(/^(\.\/|\.\.\/domain\/)/);
    }
  });
});
