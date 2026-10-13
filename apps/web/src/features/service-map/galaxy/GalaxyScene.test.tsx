import { useThree } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useEffect } from 'react';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { EntityRef } from '../../../domain/types';
import { mockTopology } from '../../../data/mock/topology';
import { EMPTY_FILTERS } from '../../../domain/registry';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { CameraMemory, fitPose } from './cameraMath';
import { GalaxyScene, type GalaxyHandle } from './GalaxyScene';
import type { GalaxyColors } from './palette';
import { layoutGalaxy } from './layout3d';
import { buildScene, motionPolicy, type MotionPolicy, type SceneModel } from './sceneModel';
import { resolveGalaxyScope } from './scope';

const index = buildTopologyIndex(mockTopology);
const colors: GalaxyColors = {
  background: '#070a13', accent: '#5fe1ff', ok: '#3dd6b0', warn: '#f5b454', crit: '#ff7b7b', text3: '#7f8cab',
  edge: { http: '#a9c8ff', grpc: '#5fe1ff', data: '#b79cff', event: '#8ef0c0', other: '#7f8cab' },
};
const still = motionPolicy({ reducedMotion: true, paused: false, particlesEnabled: true });
const moving = motionPolicy({ reducedMotion: false, paused: false, particlesEnabled: true });

function sceneFor(path: string[]): SceneModel {
  const model = resolveGalaxyScope(index, { environmentId: 'production', filters: EMPTY_FILTERS, path });
  return buildScene(index, model, layoutGalaxy(model), { selection: null, highlightMode: 'direct', labelMode: 'minimal' });
}

const probe: { camera: THREE.Camera | null } = { camera: null };
function CameraProbe() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    probe.camera = camera;
  }, [camera]);
  return null;
}
const cam = () => probe.camera as THREE.Camera;

async function render(
  path: string[],
  {
    policy = still,
    showContainment = true,
    onSelect = vi.fn<(ref: EntityRef) => void>(),
    onEnter = vi.fn<(id: string) => void>(),
    memory = new CameraMemory(),
  }: {
    policy?: MotionPolicy;
    showContainment?: boolean;
    onSelect?: Mock<(ref: EntityRef) => void>;
    onEnter?: Mock<(id: string) => void>;
    memory?: CameraMemory;
  } = {},
) {
  const handleRef: { current: GalaxyHandle | null } = { current: null };
  const element = (p: string[]) => (
    <>
      <CameraProbe />
      <GalaxyScene scene={sceneFor(p)} scopePath={p} policy={policy} showContainment={showContainment} colors={colors} onSelect={onSelect} onEnter={onEnter} handleRef={handleRef} memory={memory} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(element(path));
  return { renderer, handleRef, onSelect, onEnter, update: (p: string[]) => renderer.update(element(p)) };
}

const entityGroups = (renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
  renderer.scene.findAll((n) => n.type === 'Group' && typeof n.instance.userData?.entityId === 'string');

afterEach(() => vi.restoreAllMocks());

describe('GalaxyScene', () => {
  it('renders one object per node, identified by canonical ID', async () => {
    const { renderer } = await render([]);
    const ids = entityGroups(renderer).map((g) => g.instance.userData.entityId).sort();
    expect(ids).toEqual(sceneFor([]).nodes.map((n) => n.id).sort());
    expect(ids).toContain('payment-service.production');
  });

  it('selects on click and enters on double-click, by canonical ID', async () => {
    const { renderer, onSelect, onEnter } = await render([]);
    const group = entityGroups(renderer).find((g) => g.instance.userData.entityId === 'payment-service.production')!;
    const mesh = group.children.find((c) => c.type === 'Mesh')!;
    await renderer.fireEvent(mesh, 'click');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'service-instance', id: 'payment-service.production' });
    await renderer.fireEvent(mesh, 'doubleClick');
    expect(onEnter).toHaveBeenCalledWith('payment-service.production');
  });

  it('draws one direction cone per known direction', async () => {
    const { renderer } = await render([]);
    const arrows = renderer.scene.find((n) => n.instance.name === 'arrows').instance as THREE.InstancedMesh;
    expect(arrows.count).toBe(sceneFor([]).edges.reduce((sum, e) => sum + e.arrows.length, 0));
  });

  it('animates traffic only when the motion policy allows it', async () => {
    const withMotion = await render([], { policy: moving });
    expect(withMotion.renderer.scene.findAll((n) => n.instance.name === 'traffic')).toHaveLength(1);
    const paused = await render([], { policy: motionPolicy({ reducedMotion: false, paused: true, particlesEnabled: true }) });
    expect(paused.renderer.scene.findAll((n) => n.instance.name === 'traffic')).toHaveLength(0);
    const reduced = await render([], { policy: still });
    expect(reduced.renderer.scene.findAll((n) => n.instance.name === 'traffic')).toHaveLength(0);
  });

  it('draws containment (spokes) only inside entity scopes, and can hide it', async () => {
    // drei's Line copies userData onto its wrapper and line object; count distinct links.
    const spokes = (r: Awaited<ReturnType<typeof render>>['renderer']) => [
      ...new Set(r.scene.findAll((n) => typeof n.instance.userData?.containment === 'string').map((n) => n.instance.userData.containment)),
    ];
    expect(spokes((await render([])).renderer)).toHaveLength(0);
    expect(spokes((await render(['kafka-events-prod'])).renderer)).toHaveLength(3);
    expect(spokes((await render(['kafka-events-prod'], { showContainment: false })).renderer)).toHaveLength(0);
  });

  it('disposes geometries and materials on unmount', async () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const { renderer } = await render(['aws-acct-commerce-prod', 'eks-commerce-prod']);
    const nodeCount = sceneFor(['aws-acct-commerce-prod', 'eks-commerce-prod']).nodes.length;
    await renderer.unmount();
    expect(geometryDispose.mock.calls.length).toBeGreaterThanOrEqual(nodeCount);
    expect(materialDispose.mock.calls.length).toBeGreaterThanOrEqual(nodeCount);
  });

  it('fits, focuses, and dives in through the camera handle (instant under reduced motion)', async () => {
    const { handleRef } = await render([]);
    const scene = sceneFor([]);
    handleRef.current!.fit();
    expect(cam().position.toArray().map(Math.round)).toEqual(fitPose(scene.extent).position.map(Math.round));
    const arrive = vi.fn();
    handleRef.current!.diveInto('payment-service.production', arrive);
    expect(arrive).toHaveBeenCalledTimes(1);
    const target = scene.nodes.find((n) => n.id === 'payment-service.production')!;
    expect(cam().position.distanceTo(new THREE.Vector3(...target.position))).toBeLessThan(target.radius * 3);
  });

  it('restores the remembered camera when returning to a scope', async () => {
    const memory = new CameraMemory();
    const { handleRef, update } = await render([], { memory });
    handleRef.current!.focus('payment-service.production');
    const overviewPose = cam().position.clone();
    await update(['az-sub-payments']);
    expect(cam().position.equals(overviewPose)).toBe(false);
    await update([]);
    expect(cam().position.distanceTo(overviewPose)).toBeLessThan(0.01);
  });
});
