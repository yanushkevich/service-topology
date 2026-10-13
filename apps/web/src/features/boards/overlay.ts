/** Percentage position of a viewBox point, for HTML overlays (tooltips, choosers) on a scaled SVG. */
export function overlayPosition(x: number, y: number, size: { width: number; height: number }) {
  return { left: `${(x / size.width) * 100}%`, top: `${(y / size.height) * 100}%` };
}
