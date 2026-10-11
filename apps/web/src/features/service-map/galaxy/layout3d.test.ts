import { describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000, SCALE_250 } from '../../../data/mock/generateTopology';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex, type TopologyIndex } from '../../../domain/topologyIndex';
import { layoutGalaxy, type GalaxyLayout } from './layout3d';
import { resolveGalaxyScope, type GalaxyScopeModel } from './scope';

const mockIndex = buildTopologyIndex(mockTopology);
const scope = (index: TopologyIndex, path: string[], environmentId = 'production') =>
  resolveGalaxyScope(index, { environmentId, filters: EMPTY_FILTERS, path });

/** Pairs of node spheres that intersect (centers closer than the sum of radii). */
function collisions(model: GalaxyScopeModel, layout: GalaxyLayout): string[] {
  const out: string[] = [];
  const nodes = model.nodes;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!.id;
      const b = nodes[j]!.id;
      const pa = layout.positions[a]!;
      const pb = layout.positions[b]!;
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if (d < (layout.radii[a] ?? 0) + (layout.radii[b] ?? 0)) out.push(`${a} × ${b} (${d.toFixed(1)})`);
    }
  }
  return out;
}

const FIXTURES: [string, () => GalaxyScopeModel][] = [
  ['mock overview (production)', () => scope(mockIndex, [])],
  ['mock overview (staging)', () => scope(mockIndex, [], 'staging')],
  ['mock overview (development)', () => scope(mockIndex, [], 'development')],
  ['container: account → cluster', () => scope(mockIndex, ['aws-acct-commerce-prod', 'eks-commerce-prod'])],
  ['container: account', () => scope(mockIndex, ['aws-acct-commerce-prod'])],
  ['container: broker', () => scope(mockIndex, ['kafka-events-prod'])],
  ['leaf: service instance', () => scope(mockIndex, ['payment-service.production'])],
  ['leaf: SaaS with callers in two environments', () => scope(mockIndex, ['ext-card-processor'])],
  ['250-node overview', () => scope(buildTopologyIndex(generateTopology(SCALE_250)), [])],
  ['1,000-entity overview (aggregated)', () => scope(buildTopologyIndex(generateTopology(INVENTORY_1000)), [])],
];

describe('layoutGalaxy', () => {
  it.each(FIXTURES)('%s: every node placed, no intersecting nodes', (_name, make) => {
    const model = make();
    const layout = layoutGalaxy(model);
    for (const n of model.nodes) {
      expect(layout.positions[n.id], n.id).toBeDefined();
      expect(layout.positions[n.id]!.every(Number.isFinite)).toBe(true);
    }
    expect(collisions(model, layout)).toEqual([]);
    expect(layout.extent).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    for (const [, make] of FIXTURES.slice(0, 4)) expect(layoutGalaxy(make())).toEqual(layoutGalaxy(make()));
  });

  it('keeps constellations apart in the overview', () => {
    const model = scope(mockIndex, []);
    const layout = layoutGalaxy(model);
    const cores = model.groups.filter((g) => g.coreId).map((g) => layout.positions[g.coreId!]!);
    for (let i = 0; i < cores.length; i++)
      for (let j = i + 1; j < cores.length; j++) {
        const [a, b] = [cores[i]!, cores[j]!];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(150);
      }
  });

  it('puts the explored entity at the origin, inbound partners left and outbound right', () => {
    const model = scope(mockIndex, ['payment-service.production']);
    const layout = layoutGalaxy(model);
    expect(layout.positions['payment-service.production']).toEqual([0, 0, 0]);
    expect(layout.positions['order-service.production']![0]).toBeLessThan(0);
    expect(layout.positions['ext-card-processor']![0]).toBeGreaterThan(0);
  });

  it('draws containment as rings/shells around entity scopes', () => {
    const layout = layoutGalaxy(scope(mockIndex, ['aws-acct-commerce-prod', 'eks-commerce-prod']));
    expect(layout.rings.filter((r) => r.kind === 'scope-shell')).toHaveLength(2);
    expect(layout.rings.some((r) => r.kind === 'children')).toBe(true);
    expect(layout.rings.some((r) => r.kind === 'grandchildren')).toBe(true);
  });
});
