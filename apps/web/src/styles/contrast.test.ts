import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, tokensFor, type Rgb } from './contrast';

// Raw token source, so the test checks exactly what ships.
const css = Object.values(import.meta.glob<string>('./tokens.css', { query: '?raw', import: 'default', eager: true }))[0] ?? '';

const themes = {
  dark: { ...tokensFor(css, ':root'), ...tokensFor(css, ":root[data-theme='dark']") },
  light: { ...tokensFor(css, ':root'), ...tokensFor(css, ":root[data-theme='light']") },
};

/** Surfaces text and indicators actually sit on. */
const SURFACES = ['--color-bg-0', '--color-bg-1', '--color-bg-2', '--color-bg-3', '--color-stage', '--color-bg-selected', '--color-node'];
const TEXT = ['--color-text', '--color-text-2', '--color-text-3', '--color-accent-text', '--color-ok-text', '--color-warn-text', '--color-crit-text'];
/** Non-text indicators required to understand content or state (WCAG 1.4.11). */
const INDICATORS: { token: string; opacity?: number; why: string }[] = [
  { token: '--color-ok', why: 'status shape (healthy)' },
  { token: '--color-warn', why: 'status shape (degraded)' },
  { token: '--color-crit', why: 'status shape (unavailable)' },
  { token: '--color-accent', why: 'focus ring, pressed-state indicator, selection outline' },
  { token: '--color-control-border', why: 'form control boundary' },
  { token: '--color-indigo', why: 'pressed chip border, highlighted node border' },
  // 2D edges render at opacity 0.62 over the stage.
  { token: '--edge-http', opacity: 0.62, why: 'HTTP path' },
  { token: '--edge-grpc', opacity: 0.62, why: 'gRPC path' },
  { token: '--edge-data', opacity: 0.62, why: 'data path' },
  { token: '--edge-event', opacity: 0.62, why: 'event path' },
];
const EDGE_SURFACES = ['--color-stage'];

type Theme = keyof typeof themes;
const color = (theme: Theme, token: string) => {
  const value = themes[theme][token];
  if (!value) throw new Error(`${theme}: missing ${token}`);
  // Resolve var(--x) references (e.g. --color-accent-text: var(--color-accent)).
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return parseColor(ref ? (themes[theme][ref[1]!] ?? value) : value);
};
const solid = (theme: Theme, token: string): Rgb => over(color(theme, token), [255, 255, 255]);

function failures(theme: Theme, tokens: string[], surfaces: string[], minimum: number, opacity = 1) {
  const out: string[] = [];
  for (const fg of tokens) {
    for (const bgToken of surfaces) {
      const bg = solid(theme, bgToken);
      const fgColor = color(theme, fg);
      const ratio = contrast(over({ rgb: fgColor.rgb, alpha: fgColor.alpha * opacity }, bg), bg);
      if (ratio < minimum) out.push(`${fg} on ${bgToken}: ${ratio.toFixed(2)}`);
    }
  }
  return out;
}

describe.each(['dark', 'light'] as const)('%s theme contrast (WCAG 2.2 AA)', (theme) => {
  it('normal text is at least 4.5:1 on every surface', () => {
    expect(failures(theme, TEXT, SURFACES, 4.5)).toEqual([]);
  });

  it('button text on the accent fill is at least 4.5:1', () => {
    const ratio = contrast(solid(theme, '--color-accent-contrast'), solid(theme, '--color-accent'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('status-shape glyphs are at least 3:1 on their fill', () => {
    const glyph: Rgb = [6, 16, 26]; // #06101a in glyphs.module.css
    for (const fill of ['--color-ok', '--color-warn', '--color-crit']) {
      expect(contrast(glyph, solid(theme, fill)), fill).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(INDICATORS.filter((i) => !i.token.startsWith('--edge')))('$why ($token) is at least 3:1 on UI surfaces', ({ token }) => {
    expect(failures(theme, [token], SURFACES.filter((s) => s !== '--color-bg-selected' || token === '--color-accent'), 3)).toEqual([]);
  });

  it.each(INDICATORS.filter((i) => i.token.startsWith('--edge')))('$why ($token, as rendered) is at least 3:1 on the map', ({ token, opacity }) => {
    expect(failures(theme, [token], EDGE_SURFACES, 3, opacity)).toEqual([]);
  });
});

describe('contrast helpers', () => {
  it('match the WCAG reference values', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
  });
});
