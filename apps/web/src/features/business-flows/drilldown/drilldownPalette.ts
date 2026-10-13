import { readGalaxyColors, type GalaxyColors } from '../../service-map/galaxy/palette';

/**
 * Colours of the 3D drill-down, read from the theme tokens at runtime (WebGL takes colour values,
 * not CSS variables). No literals here: the galaxy palette (the one sanctioned exception) supplies
 * the fallbacks. Line colours are the transit board's `--transit-line-1…12`.
 */
export interface DrilldownColors extends GalaxyColors {
  lines: string[];
  plane: string;
  planeLine: string;
  text: string;
  /** Plane fill opacity: stronger on the light theme, where the fill is close to the page. */
  planeOpacity: number;
}

const LINE_TOKENS = 12;

export function readDrilldownColors(): DrilldownColors {
  const galaxy = readGalaxyColors();
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    ...galaxy,
    lines: Array.from({ length: LINE_TOKENS }, (_, i) => v(`--transit-line-${i + 1}`, galaxy.accent)),
    plane: v('--color-bg-2', galaxy.background),
    planeLine: v('--color-line-strong', galaxy.text3),
    text: v('--color-text', galaxy.accent),
    planeOpacity: document.documentElement.dataset.theme === 'light' ? 0.75 : 0.35,
  };
}

/** A line's colour by its position in the board's line order, as on the 2D board. */
export const lineColorOf = (colors: DrilldownColors, colorIndex: number) => colors.lines[colorIndex % colors.lines.length] ?? colors.accent;
