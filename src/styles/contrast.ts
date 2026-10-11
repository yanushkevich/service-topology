/* eslint-disable @typescript-eslint/no-non-null-assertion -- regex groups are guaranteed by the patterns; used by tests only */
/** WCAG 2.2 relative luminance and contrast ratio (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio). */

export type Rgb = readonly [number, number, number];

export function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb, alpha: 1 };
  }
  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1]!.split(',').map((p) => Number(p.trim()));
    return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
  }
  throw new Error(`Unsupported color "${value}"`);
}

/** Composite a (possibly translucent) foreground over an opaque background. */
export function over(fg: { rgb: Rgb; alpha: number }, bg: Rgb): Rgb {
  return fg.rgb.map((c, i) => c * fg.alpha + (bg[i] ?? 0) * (1 - fg.alpha)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Variables declared in a CSS block whose selector list contains `selector`. */
export function tokensFor(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of match[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[decl[1]!] = decl[2]!.trim();
  }
  return out;
}
