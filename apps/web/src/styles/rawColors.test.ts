import { describe, expect, it } from 'vitest';

/**
 * Colours come from tokens (ADR-013, docs/CONVENTIONS.md "Styling"): `tokens.css` holds every
 * value, components use token utilities (`text-fg-2`) or `var(--…)`. The only literals allowed in
 * TypeScript are the 3D palette, because WebGL materials cannot read CSS variables.
 */
const sources = import.meta.glob<string>(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx', '!../test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ALLOWED = new Set(['../features/service-map/galaxy/palette.ts']);

/** A hex colour as a value (after a quote, space, paren, comma, or colon), or a colour function. */
const RAW_COLOR = /(?:['"`\s(,:])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|oklch)\(/;

/** Tailwind's default palette is disabled, so these classes render nothing (`indigo` and `violet` are tokens). */
const DEFAULT_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|outline|from|to|via|shadow|divide|accent|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;

const checked = Object.entries(sources).filter(([path]) => !ALLOWED.has(path));

describe('styling rules', () => {
  it('has modules to check', () => {
    expect(checked.length).toBeGreaterThan(50);
  });

  it.each(checked)('%s uses tokens, not literal colours', (_path, source) => {
    const offending = source.split('\n').filter((line) => RAW_COLOR.test(line) || DEFAULT_PALETTE.test(line));
    expect(offending).toEqual([]);
  });

  it.each(checked)('%s uses no CSS Modules', (_path, source) => {
    expect(source).not.toMatch(/\.module\.css['"]/);
  });
});
