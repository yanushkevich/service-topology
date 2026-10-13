import { useCallback } from 'react';
import type { LabelLayer } from '../../service-map/galaxy/labelLayer';

/** Shared label styling and registration for the drill-down's HTML labels. */

/** A label chip: token surface, border, small text (2D board chips). */
export const CHIP = 'pointer-events-none select-none whitespace-nowrap rounded-md border border-line bg-float/90 px-1.5 py-px text-xs font-medium text-fg shadow-sm';

/** A stable callback ref that registers a label with the scene's declutter. */
export function useLabel(labels: LabelLayer, id: string) {
  return useCallback((el: HTMLElement | null) => labels.attach(id, el), [labels, id]);
}
