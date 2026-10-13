import { describe, expect, it } from 'vitest';

// The transit and flow read models and layouts are pure (ADR-021, ADR-022): the boards render
// them, and they run in tests and benchmarks without a DOM. Only the repository module provides a
// React context, as src/data does for the topology.
const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts', '!./repository.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('transit boundary (ADR-021, ADR-022)', () => {
  it('has modules to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(sources))('%s imports only domain types and its own modules', (_path, source) => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of imports) {
      expect(specifier).toMatch(/^\.{1,2}\/(?!.*(?:features|state|shared)\/)/);
    }
  });
});
