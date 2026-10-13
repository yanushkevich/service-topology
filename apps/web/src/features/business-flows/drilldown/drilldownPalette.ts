import { POLICY_TYPES, type PolicyType } from '../../../transit/types';
import { readGalaxyColors, type GalaxyColors } from '../../service-map/galaxy/palette';

/**
 * Colours of the 3D drill-down, read from the theme tokens at runtime (WebGL takes colour values,
 * not CSS variables), so it speaks the 2D transit board's language: line colours
 * (`--transit-line-1…12`), white stations with dark rings, policy colours, the dim colour for lines
 * outside the flow. No literals here: the galaxy palette (the one sanctioned exception) supplies
 * the fallbacks.
 */
export interface DrilldownColors extends GalaxyColors {
  lines: string[];
  /** Plane and pad fill, lane strips, outlines, grid. */
  plane: string;
  strip: string;
  planeLine: string;
  grid: string;
  text: string;
  station: string;
  stationRing: string;
  /** Lines outside the flow (Show all lines). */
  dim: string;
  policy: Record<PolicyType, string>;
  /** Plane fill opacity: stronger on the light theme, where the fill is close to the page. */
  planeOpacity: number;
  /** Bloom and fog suit the dark stage only. */
  dark: boolean;
}

const LINE_TOKENS = 12;

export function readDrilldownColors(): DrilldownColors {
  const galaxy = readGalaxyColors();
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    ...galaxy,
    lines: Array.from({ length: LINE_TOKENS }, (_, i) => v(`--transit-line-${i + 1}`, galaxy.accent)),
    plane: v('--color-bg-1', galaxy.background),
    strip: v('--color-bg-2', galaxy.background),
    planeLine: v('--color-line-strong', galaxy.text3),
    grid: v('--color-line', galaxy.text3),
    text: v('--color-text', galaxy.accent),
    station: v('--transit-station', galaxy.accent),
    stationRing: v('--transit-station-ring', galaxy.background),
    dim: v('--transit-dim', galaxy.text3),
    policy: Object.fromEntries(POLICY_TYPES.map((type) => [type, v(`--transit-policy-${type}`, galaxy.accent)])) as Record<PolicyType, string>,
    planeOpacity: dark ? 0.55 : 0.85,
    dark,
  };
}

/** A line's colour by its position in the board's line order, as on the 2D board. */
export const lineColorOf = (colors: DrilldownColors, colorIndex: number) => colors.lines[colorIndex % colors.lines.length] ?? colors.accent;
