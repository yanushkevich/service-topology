import { describe, expect, it } from 'vitest';
import { hiddenLabels, labelPriority, type ScreenLabel } from './labelDeclutter';
import type { SceneNode } from './sceneModel';

const label = (id: string, x: number, y: number, priority = 3): ScreenLabel => ({ id, x, y, width: 100, height: 20, priority });

describe('3D label declutter', () => {
  it('keeps labels that do not overlap', () => {
    expect(hiddenLabels([label('a', 0, 0), label('b', 200, 0), label('c', 0, 40)])).toEqual(new Set());
  });

  it('hides the lower-priority label of an overlapping pair, whatever the input order', () => {
    expect(hiddenLabels([label('plain', 0, 0, 3), label('unhealthy', 30, 8, 1)])).toEqual(new Set(['plain']));
    expect(hiddenLabels([label('unhealthy', 30, 8, 1), label('plain', 0, 0, 3)])).toEqual(new Set(['plain']));
  });

  it('keeps a label that overlaps only one already hidden', () => {
    // b overlaps a (kept) and c; c overlaps only b. Hiding b frees c.
    expect(hiddenLabels([label('a', 0, 0, 0), label('b', 90, 0, 1), label('c', 180, 0, 2)])).toEqual(new Set(['b']));
  });

  it('ranks selected and hovered first, then highlighted or unhealthy, then containers', () => {
    const node = (patch: Partial<SceneNode>) => ({ id: 'n', type: 'service', emphasis: 'none', health: 'healthy', ...patch }) as SceneNode;
    expect(labelPriority(node({ emphasis: 'selected' }), null)).toBe(0);
    expect(labelPriority(node({}), 'n')).toBe(0);
    expect(labelPriority(node({ health: 'degraded' }), null)).toBe(1);
    expect(labelPriority(node({ type: 'cluster' }), null)).toBe(2);
    expect(labelPriority(node({}), null)).toBe(3);
  });
});
