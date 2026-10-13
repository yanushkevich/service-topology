/**
 * The 3D galaxy's colours: the one place outside `styles/tokens.css` with literal colours.
 *
 * WebGL materials take colour values, not CSS variables, so the scene reads the theme tokens at
 * runtime (`readGalaxyColors`) and keeps literals only for (a) fallbacks when a token is missing and
 * (b) the scene's own decorative palette (node kinds, stars, rings), which has no 2D counterpart.
 * `src/styles/rawColors.test.ts` fails on literal colours anywhere else in TypeScript.
 */

export interface GalaxyColors {
  background: string;
  accent: string;
  ok: string;
  warn: string;
  crit: string;
  text3: string;
  edge: Record<'http' | 'grpc' | 'data' | 'event' | 'other', string>;
}

/** Theme colours from the CSS tokens, so the scene follows light/dark like the rest of the UI. */
export function readGalaxyColors(): GalaxyColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--color-stage', '#070a13'),
    accent: v('--color-accent', '#5fe1ff'),
    ok: v('--color-ok', '#3dd6b0'),
    warn: v('--color-warn', '#f5b454'),
    crit: v('--color-crit', '#ff7b7b'),
    text3: v('--color-text-3', '#7f8cab'),
    edge: {
      http: v('--edge-http', '#a9c8ff'),
      grpc: v('--edge-grpc', '#5fe1ff'),
      data: v('--edge-data', '#b79cff'),
      event: v('--edge-event', '#8ef0c0'),
      other: v('--color-text-3', '#7f8cab'),
    },
  };
}

/** Node colour by resource type; services use SERVICE_COLOR. */
export const NODE_COLOR: Record<string, string> = {
  gateway: '#5fe1ff',
  database: '#a78bfa',
  'search-index': '#a78bfa',
  cache: '#b79cff',
  topic: '#aab3ff',
  queue: '#8fa2ff',
  exchange: '#8fa2ff',
  broker: '#8fa2ff',
  'external-resource': '#9aa6c4',
  account: '#8fa2ff',
  subscription: '#8fa2ff',
  project: '#8fa2ff',
  region: '#8fa2ff',
  datacenter: '#8fa2ff',
  cluster: '#8fa2ff',
  namespace: '#8fa2ff',
};
export const SERVICE_COLOR = '#7f9df0';
export const STARFIELD_COLOR = '#9fb0e6';
/** Orbit rings of a scope's members (the scope shell uses the theme's text-3). */
export const ORBIT_RING_COLOR = '#7d8bff';
/** Containment spokes. */
export const CONTAINMENT_COLOR = '#8fa2ff';
/** Particles are the edge colour lightened toward this. */
export const PARTICLE_TINT = '#ffffff';
