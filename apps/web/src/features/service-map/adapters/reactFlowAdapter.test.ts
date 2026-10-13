import { describe, expect, it } from 'vitest';
import { openingFit, type HighlightState } from './reactFlowAdapter';

const highlight = (selected: string[], nodes: string[]): HighlightState => ({ selectedIds: new Set(selected), nodeIds: new Set(nodes), edgeIds: new Set(), active: selected.length > 0 });

describe('openingFit', () => {
  it('fits the whole graph without a selection, or with only an event highlight', () => {
    expect(openingFit(null)).toEqual({ padding: 0.12 });
    expect(openingFit({ ...highlight([], ['a', 'b']), active: true })).toEqual({ padding: 0.12 });
  });

  it('fits the selection and its highlighted neighbours, no closer than 100%', () => {
    expect(openingFit(highlight(['order'], ['order', 'payment', 'orders-db']))).toEqual({
      nodes: [{ id: 'order' }, { id: 'payment' }, { id: 'orders-db' }],
      padding: 0.3,
      maxZoom: 1,
    });
  });
});
