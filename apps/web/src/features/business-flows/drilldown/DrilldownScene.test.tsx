import { useThree } from '@react-three/fiber';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useEffect } from 'react';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { checkoutFlow } from '../../../data/mock/businessFlows';
import { mockTopology } from '../../../data/mock/topology';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import { indexBoard } from '../../../transit/board';
import type { TxStep } from '../../../transit/flows/observed';
import { computeSwimlanes } from '../../../transit/flows/swimlane';
import { paymentServiceBoard } from '../../../transit/mock/paymentServiceBoard';
import { createPlayback } from '../../boards/playback';
import { particleOnShaft, poseFor } from './drilldownCamera';
import { buildDrilldown, scopeBounds } from './drilldownModel';
import type { DrilldownColors } from './drilldownPalette';
import { DrilldownScene, type DrilldownSceneProps } from './DrilldownScene';

const topology = buildTopologyIndex(mockTopology);
const serviceName = (id: string) => topology.definitions.get(id)?.name ?? id;
const payments = indexBoard(paymentServiceBoard('production'));
const model = buildDrilldown({ flow: checkoutFlow, layout: computeSwimlanes(checkoutFlow, serviceName), boards: new Map([['payment-service', payments]]), serviceName });
const colors: DrilldownColors = {
  background: '#070a13', accent: '#5fe1ff', ok: '#3dd6b0', warn: '#f5b454', crit: '#ff7b7b', text3: '#7f8cab',
  edge: { http: '#a9c8ff', grpc: '#5fe1ff', data: '#b79cff', event: '#8ef0c0', other: '#7f8cab' },
  lines: ['#5fe1ff', '#b48cff', '#7ff0c0'], plane: '#101626', planeLine: '#2a3350', text: '#e8edf9', planeOpacity: 0.35,
};

const probe: { camera: THREE.Camera | null } = { camera: null };
function CameraProbe() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    probe.camera = camera;
  }, [camera]);
  return null;
}

async function render(overrides: Partial<DrilldownSceneProps> = {}) {
  const props: DrilldownSceneProps = { model, colors, scope: null, selectedStepId: null, onSelectStep: vi.fn(), onEnterService: vi.fn(), replay: null, reduced: true, bloom: false, ...overrides };
  const element = (p: DrilldownSceneProps) => (
    <>
      <CameraProbe />
      <DrilldownScene {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(element(props));
  return { renderer, props, update: (next: Partial<DrilldownSceneProps>) => renderer.update(element({ ...props, ...next })) };
}

type Renderer = Awaited<ReturnType<typeof render>>['renderer'];
const instanced = (r: Renderer) => r.scene.findAll((n) => (n.instance as THREE.InstancedMesh).isInstancedMesh === true);
/** Plain meshes carrying a canonical ID (the instanced stations report type Mesh too). */
const withData = (r: Renderer, key: string) => r.scene.findAll((n) => n.type === 'Mesh' && !(n.instance as THREE.InstancedMesh).isInstancedMesh && typeof n.instance.userData?.[key] === 'string');

describe('DrilldownScene (ADR-026)', () => {
  it('draws every step and every service plane, identified by canonical IDs', async () => {
    const { renderer } = await render();
    expect(withData(renderer, 'stepId').map((n) => n.instance.userData.stepId).sort()).toEqual(model.steps.map((s) => s.id).sort());
    expect(withData(renderer, 'serviceDefinitionId').map((n) => n.instance.userData.serviceDefinitionId)).toEqual(model.boards.map((b) => b.serviceDefinitionId));
  });

  it('instances the stations of each board in one mesh', async () => {
    const { renderer } = await render();
    const meshes = instanced(renderer);
    expect(meshes).toHaveLength(1); // only Payment Service has a board
    expect((meshes[0]?.instance as THREE.InstancedMesh).count).toBe(payments.board.stations.length);
  });

  it('selects a step and enters a service by clicking, by canonical ID', async () => {
    const { renderer, props } = await render();
    const capture = withData(renderer, 'stepId').find((n) => n.instance.userData.stepId === 'capture-payment');
    const plane = withData(renderer, 'serviceDefinitionId').find((n) => n.instance.userData.serviceDefinitionId === 'payment-service');
    if (!capture || !plane) throw new Error('expected the step and the plane');
    await renderer.fireEvent(capture, 'click');
    expect(props.onSelectStep).toHaveBeenCalledWith('capture-payment');
    await renderer.fireEvent(plane, 'click');
    expect(props.onEnterService).toHaveBeenCalledWith('payment-service');
  });

  it('places the camera on the flow, then on an entered service, and back (instant under reduced motion)', async () => {
    const { renderer, update } = await render();
    // CameraControls applies a pose on its next update (a frame).
    const position = async () => {
      await renderer.advanceFrames(2, 16);
      return (probe.camera as THREE.Camera).position.toArray().map(Math.round);
    };
    expect(await position()).toEqual(poseFor(model.bounds).position.map(Math.round));
    await update({ scope: 'payment-service' });
    expect(await position()).toEqual(poseFor(scopeBounds(model, 'payment-service')).position.map(Math.round));
    await update({ scope: null });
    expect(await position()).toEqual(poseFor(model.bounds).position.map(Math.round));
  });

  it('moves replay particles from the playback clock: down the active step’s shaft', async () => {
    const step: TxStep = { stepId: 'capture-payment', label: 'Capture', startMs: 0, durationMs: 100, displayStartMs: 0, displayDurationMs: 100, status: 'ok', correlated: true };
    const playback = createPlayback({ t: 25, step: 0 });
    const { renderer } = await render({ replay: { steps: [step], playback }, reduced: false });
    await renderer.advanceFrames(1, 16);
    const particles = renderer.scene.findAll((n) => n.type === 'Mesh' && n.parent?.instance.userData?.particles !== undefined);
    const visible = particles.filter((p) => p.instance.visible);
    expect(visible).toHaveLength(1);
    const shaft = model.shafts.find((s) => s.stepId === 'capture-payment');
    if (!shaft) throw new Error('expected a shaft');
    expect(visible[0]?.instance.position.toArray()).toEqual([...particleOnShaft(shaft, 0.25, false)]);
  });

  it('keeps the scene the same when entering a service (only the camera and labels change)', async () => {
    const { renderer, update } = await render();
    const before = renderer.scene.findAll((n) => n.type === 'Mesh').length;
    await update({ scope: 'payment-service' });
    expect(renderer.scene.findAll((n) => n.type === 'Mesh').length).toBe(before);
    expect(instanced(renderer)).toHaveLength(1);
  });
});

describe('drill-down camera and particles (pure)', () => {
  it('looks at a box from above and in front, farther for a bigger box', () => {
    const small = poseFor({ min: [0, 0, 0], max: [200, 0, 200] });
    const big = poseFor({ min: [0, 0, 0], max: [2000, 0, 2000] });
    expect(small.target).toEqual([100, 0, 100]);
    expect(small.position[1]).toBeGreaterThan(0);
    expect(small.position[2]).toBeGreaterThan(small.target[2]);
    expect(big.position[1] - big.target[1]).toBeGreaterThan(small.position[1] - small.target[1]);
  });

  it('runs a particle down the shaft and back up, and rests at the station with reduced motion', () => {
    const shaft = { from: [0, 0, 0] as const, to: [0, -400, 0] as const };
    expect(particleOnShaft(shaft, 0, false)).toEqual([0, 0, 0]);
    expect(particleOnShaft(shaft, 0.5, false)).toEqual([0, -400, 0]);
    expect(particleOnShaft(shaft, 1, false)).toEqual([0, 0, 0]);
    expect(particleOnShaft(shaft, 0.2, true)).toEqual([0, -400, 0]);
  });
});
