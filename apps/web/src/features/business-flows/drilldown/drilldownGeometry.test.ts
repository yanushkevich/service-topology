import { describe, expect, it } from 'vitest';
import { arrowHeads, gridSegments, outline, segmentsOf } from './drilldownGeometry';

describe('drill-down geometry', () => {
  it('points an arrowhead along the last non-zero segment', () => {
    expect(arrowHeads([[[0, 0, 0], [10, 0, 0], [10, 0, 0]]])).toEqual([{ position: [10, 2, 0], direction: [1, 0, 0] }]);
    expect(arrowHeads([[[0, 0, 0], [0, 0, -5]]])[0]?.direction).toEqual([0, 0, -1]);
    expect(arrowHeads([[[3, 0, 3]]])).toEqual([]);
  });

  it('outlines a footprint as a closed polyline', () => {
    const points = outline({ center: [0, -10, 0], width: 20, depth: 10 }, 0);
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual(points[4]);
    expect(points[1]).toEqual([10, -10, -5]);
  });

  it('draws grid lines inside a footprint only', () => {
    const segments = gridSegments({ center: [0, 0, 0], width: 200, depth: 100 }, 80, 0);
    expect(segments.length % 2).toBe(0);
    expect(segments.every(([x, , z]) => x >= -100 && x <= 100 && z >= -50 && z <= 50)).toBe(true);
  });

  it('turns polylines into segment pairs', () => {
    expect(segmentsOf([[[0, 0, 0], [1, 0, 0], [1, 0, 1]]])).toEqual([[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 1]]);
  });
});
