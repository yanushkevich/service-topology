import { describe, expect, it } from 'vitest';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { layoutGalaxy } from './layout3d';
import { buildScene, edgeCurve, motionPolicy, trafficRate, type SceneOptions } from './sceneModel';
import { resolveGalaxyScope } from './scope';

const index = buildTopologyIndex(mockTopology);
const make = (path: string[], options: Partial<SceneOptions> = {}) => {
  const model = resolveGalaxyScope(index, { environmentId: 'production', filters: EMPTY_FILTERS, path });
  return buildScene(index, model, layoutGalaxy(model), { selection: null, highlightMode: 'direct', labelMode: 'auto', ...options });
};
const node = (scene: ReturnType<typeof make>, id: string) => scene.nodes.find((n) => n.id === id)!;

describe('buildScene', () => {
  it('uses canonical IDs and the layout positions', () => {
    const scene = make([]);
    expect(node(scene, 'order-service.production')).toMatchObject({ ref: { kind: 'service-instance', id: 'order-service.production' } });
    expect(scene.edges.every((e) => e.points.length === 17)).toBe(true);
  });

  it('highlights the selection reach and dims the rest only while something is selected', () => {
    expect(make([]).highlightActive).toBe(false);
    expect(make([]).nodes.every((n) => n.emphasis === 'none')).toBe(true);
    const scene = make([], { selection: { kind: 'service-instance', id: 'payment-service.production' } });
    expect(node(scene, 'payment-service.production').emphasis).toBe('selected');
    expect(node(scene, 'order-service.production').emphasis).toBe('highlighted');
    expect(node(scene, 'web-bff.production').emphasis).toBe('dimmed');
    expect(scene.edges.find((e) => e.id === 'rel:order-service.production->payment-service.production')?.emphasis).toBe('highlighted');
  });

  it('selecting a relationship highlights its endpoints', () => {
    const scene = make([], { selection: { kind: 'relationship', id: 'rel:order-service.production->payment-service.production' } });
    expect(scene.edges.find((e) => e.id === 'rel:order-service.production->payment-service.production')?.emphasis).toBe('selected');
    expect(node(scene, 'order-service.production').emphasis).toBe('highlighted');
  });

  it('applies label level-of-detail: always label anchors, selection, and problems; others when near', () => {
    const minimal = make(['aws-acct-commerce-prod', 'eks-commerce-prod'], { labelMode: 'minimal' });
    expect(minimal.nodes.filter((n) => n.labelLevel === 'always').map((n) => n.id)).toEqual(['eks-commerce-prod']);
    expect(make([], { labelMode: 'all' }).nodes.every((n) => n.labelLevel === 'always')).toBe(true);
    const auto = make([], { selection: { kind: 'service-instance', id: 'ledger-service.production' } });
    expect(node(auto, 'az-sub-payments').labelLevel).toBe('always'); // constellation core
    expect(node(auto, 'notification-service.production').labelLevel).toBe('always'); // unavailable
    expect(node(auto, 'ledger-service.production').labelLevel).toBe('always'); // selected
    expect(node(auto, 'cart-service.production').labelLevel).toBe('near');
  });

  it('describes outside nodes for assistive technology', () => {
    const scene = make(['payment-service.production']);
    expect(node(scene, 'order-service.production').ariaLabel).toBe('Order Service, api, health healthy, outside current scope, sends into it');
    expect(node(scene, 'order-service.production').outside).toBe(true);
  });

  it('gives bidirectional pairs two arrows and opposite bends; one-way edges one arrow', () => {
    const a = edgeCurve([0, 0, 0], 10, [100, 0, 0], 10, 1);
    const b = edgeCurve([0, 0, 0], 10, [100, 0, 0], 10, -1);
    expect(a.control[2]).toBeCloseTo(-b.control[2]);
    expect(a.points[0]![0]).toBeCloseTo(12); // starts at the node surface, not its center
    const scene = make([]);
    expect(scene.edges.every((e) => e.arrows.length === (e.bidirectional ? 2 : 1))).toBe(true);
  });

  it('binds traffic to throughput data only', () => {
    expect(trafficRate(undefined)).toBeNull();
    expect(trafficRate(0)).toBeNull();
    expect(trafficRate(9)).toBe(0.6);
    expect(trafficRate(1e9)).toBe(2.5);
    const scene = make([]);
    expect(scene.edges.find((e) => e.id === 'rel:payout-worker.production->ledger-service.production')?.trafficRate).toBeNull();
    expect(scene.edges.find((e) => e.id === 'rel:api-gateway.production->web-bff.production')).toMatchObject({ trafficSimulated: true });
  });

  it('draws containment links only inside entity scopes', () => {
    expect(make([]).containment).toEqual([]);
    expect(make(['kafka-events-prod']).containment).toHaveLength(3);
  });
});

describe('motionPolicy', () => {
  it('turns particles off for reduced motion or pause, and cuts camera moves for reduced motion', () => {
    expect(motionPolicy({ reducedMotion: false, paused: false, particlesEnabled: true })).toEqual({ particles: true, transitionSeconds: 0.8 });
    expect(motionPolicy({ reducedMotion: false, paused: true, particlesEnabled: true })).toEqual({ particles: false, transitionSeconds: 0.8 });
    expect(motionPolicy({ reducedMotion: true, paused: false, particlesEnabled: true })).toEqual({ particles: false, transitionSeconds: 0 });
    expect(motionPolicy({ reducedMotion: false, paused: false, particlesEnabled: false }).particles).toBe(false);
  });
});
