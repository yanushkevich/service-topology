import { CONTAINER_TYPES, type SceneNode } from './sceneModel';

/**
 * 3D label declutter (Milestone 11.6): labels are HTML over the canvas, so crowded clusters
 * overlap. In priority order each label keeps its place unless it overlaps one already kept; the
 * rest are hidden while they overlap. Pure; the scene measures and applies it when the camera moves.
 */

/** A label's box on screen, in CSS pixels, centred on (x, y). */
export interface ScreenLabel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Lower keeps its place first. */
  priority: number;
}

/** Selected or hovered first, then highlighted or unhealthy, then containers, then the rest. */
export function labelPriority(node: SceneNode, hoveredId: string | null): number {
  if (node.emphasis === 'selected' || node.id === hoveredId) return 0;
  if (node.emphasis === 'highlighted' || node.health === 'unavailable' || node.health === 'degraded') return 1;
  if (CONTAINER_TYPES.has(node.type)) return 2;
  return 3;
}

/** IDs of the labels to hide: each overlaps a label with a higher priority (or an earlier one of equal priority). */
export function hiddenLabels(labels: readonly ScreenLabel[], gap = 2): Set<string> {
  const kept: ScreenLabel[] = [];
  const hidden = new Set<string>();
  const overlap = (a: ScreenLabel, b: ScreenLabel) => Math.abs(a.x - b.x) * 2 < a.width + b.width + gap * 2 && Math.abs(a.y - b.y) * 2 < a.height + b.height + gap * 2;
  for (const label of [...labels].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    if (kept.some((k) => overlap(k, label))) hidden.add(label.id);
    else kept.push(label);
  }
  return hidden;
}
