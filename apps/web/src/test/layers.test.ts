import { describe, expect, it } from 'vitest';

// Dependencies point down (docs/CONVENTIONS.md "Layers"): app and layouts → features → state, data,
// shared → transit, simulation → domain. A lower layer never imports a feature, a layout, or the
// app; shared code that two features need moves down into shared/ (or features/boards for boards).
const sources = import.meta.glob<string>(
  ['../{domain,transit,simulation,contracts,data,state,shared,contract,styles}/**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);

describe('layer boundaries', () => {
  it('has modules to check', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
  });

  it.each(Object.entries(sources))('%s does not import features, layouts, or the app', (_path, source) => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
    expect(imports.filter((s) => /(^|\/)(features|layouts|app)\//.test(s))).toEqual([]);
  });
});
