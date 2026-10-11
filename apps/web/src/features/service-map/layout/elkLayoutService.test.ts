import { describe, expect, it } from 'vitest';
import { generateTopology, SCALE_250 } from '../../../data/mock/generateTopology';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { toLayoutRequest } from '../graph/layoutRequest';
import { buildTopologyGraph, type GraphOptions } from '../graph/topologyGraph';
import { createElkLayoutService } from './elkLayoutService';
import type { Box, LayoutRequest, LayoutResult } from './GraphLayoutService';

const elk = createElkLayoutService();
const mockIndex = buildTopologyIndex(mockTopology);

/** Overlap tolerance in px: boxes may touch but not intersect by more than this. */
const TOLERANCE = 0.5;
const overlaps = (a: Box, b: Box) =>
  a.x + a.width - TOLERANCE > b.x && b.x + b.width - TOLERANCE > a.x &&
  a.y + a.height - TOLERANCE > b.y && b.y + b.height - TOLERANCE > a.y;
const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE &&
  inner.x + inner.width <= outer.x + outer.width + TOLERANCE &&
  inner.y + inner.height <= outer.y + outer.height + TOLERANCE;

function overlappingPairs(boxes: Record<string, Box>): string[] {
  const entries = Object.entries(boxes);
  const pairs: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (overlaps(entries[i]![1], entries[j]![1])) pairs.push(`${entries[i]![0]} × ${entries[j]![0]}`);
    }
  }
  return pairs;
}

function assertValidLayout(request: LayoutRequest, result: LayoutResult) {
  // Every node and group placed, with its requested size.
  expect(Object.keys(result.nodes).sort()).toEqual(request.nodes.map((n) => n.id).sort());
  expect(Object.keys(result.groups).sort()).toEqual(request.groups.map((g) => g.id).sort());
  for (const n of request.nodes) expect(result.nodes[n.id]).toMatchObject({ width: n.width, height: n.height });
  // No node boxes overlap.
  expect(overlappingPairs(result.nodes)).toEqual([]);
  // Nested groups: children inside their parent; sibling groups do not overlap.
  for (const n of request.nodes) if (n.parentId) expect(contains(result.groups[n.parentId]!, result.nodes[n.id]!)).toBe(true);
  const siblings = new Map<string | undefined, Record<string, Box>>();
  for (const g of request.groups) {
    expect(g.parentId === undefined || contains(result.groups[g.parentId]!, result.groups[g.id]!)).toBe(true);
    siblings.set(g.parentId, { ...siblings.get(g.parentId), [g.id]: result.groups[g.id]! });
  }
  for (const group of siblings.values()) expect(overlappingPairs(group)).toEqual([]);
  // Edge endpoints exist.
  const placed = new Set([...Object.keys(result.nodes), ...Object.keys(result.groups)]);
  for (const e of request.edges) expect(placed.has(e.source) && placed.has(e.target)).toBe(true);
}

const FIXTURES: [string, GraphOptions][] = [
  ['production topology', { environmentId: 'production', filters: EMPTY_FILTERS, mode: 'topology' }],
  ['production infrastructure', { environmentId: 'production', filters: EMPTY_FILTERS, mode: 'infrastructure' }],
  ['production infrastructure, collapsed', { environmentId: 'production', filters: EMPTY_FILTERS, mode: 'infrastructure', collapsedGroupIds: new Set(['kafka-events-prod', 'aks-payments-prod']) }],
  ['staging topology', { environmentId: 'staging', filters: EMPTY_FILTERS, mode: 'topology' }],
  ['staging infrastructure', { environmentId: 'staging', filters: EMPTY_FILTERS, mode: 'infrastructure' }],
  ['development topology', { environmentId: 'development', filters: EMPTY_FILTERS, mode: 'topology' }],
];

describe('ELK layout — mock fixtures', () => {
  it.each(FIXTURES)('%s: no overlaps, groups contain children', async (_name, options) => {
    const request = toLayoutRequest(buildTopologyGraph(mockIndex, options));
    assertValidLayout(request, await elk.layout(request));
  });

  it('is deterministic for identical input, regardless of input order', async () => {
    const request = toLayoutRequest(buildTopologyGraph(mockIndex, FIXTURES[1]![1]));
    const shuffled: LayoutRequest = {
      ...request,
      nodes: [...request.nodes].reverse(),
      edges: [...request.edges].reverse(),
      groups: [...request.groups].reverse(),
    };
    const [a, b, c] = await Promise.all([elk.layout(request), elk.layout(request), elk.layout(shuffled)]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('does not mutate the request', async () => {
    const request = toLayoutRequest(buildTopologyGraph(mockIndex, FIXTURES[0]![1]));
    const copy = structuredClone(request);
    await elk.layout(request);
    expect(request).toEqual(copy);
  });

  it('respects abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(elk.layout(toLayoutRequest(buildTopologyGraph(mockIndex, FIXTURES[0]![1])), controller.signal)).rejects.toThrow();
  });
});

describe('ELK layout — 250 nodes / 750 edges benchmark fixture', () => {
  const index = buildTopologyIndex(generateTopology(SCALE_250));
  it.each([
    ['topology', 'topology'],
    ['infrastructure', 'infrastructure'],
  ] as const)('%s: no overlaps', async (_name, mode) => {
    const request = toLayoutRequest(buildTopologyGraph(index, { environmentId: 'production', filters: EMPTY_FILTERS, mode }));
    expect(request.nodes).toHaveLength(250);
    assertValidLayout(request, await elk.layout(request));
  }, 60_000);
});
