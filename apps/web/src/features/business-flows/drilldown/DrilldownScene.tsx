import { CameraControls, Html, Line, type CameraControlsImpl } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TxStep } from '../../../transit/flows/observed';
import type { Playback } from '../../boards/playback';
import { LabelLayer, type LabelAnchor } from '../../service-map/galaxy/labelLayer';
import { labelAnchors } from './drilldownLabels';
import { poseFor } from './drilldownCamera';
import { scopeBounds, type DrilldownModel, type Vec3 } from './drilldownModel';
import type { DrilldownColors } from './drilldownPalette';
import { BoardLines, BoardPlane, ReplayParticles, Shafts, Stations, StepMarker } from './DrilldownParts';

/**
 * The 3D drill-down scene (ADR-026, docs/BUSINESS_FLOWS.md §13): the flow plane with its lanes,
 * steps, and transitions over the services' transit planes, joined by light shafts. View models
 * only; selection and scope live in the URL, the camera pose in CameraControls.
 */
export interface DrilldownSceneProps {
  model: DrilldownModel;
  colors: DrilldownColors;
  /** The service the camera has entered, or null for the whole flow. */
  scope: string | null;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  onEnterService: (serviceDefinitionId: string) => void;
  replay: { steps: readonly TxStep[]; playback: Playback } | null;
  reduced: boolean;
  /** Selective bloom on the shafts and particles (off in tests and the light theme). */
  bloom: boolean;
}

export function DrilldownScene({ model, colors, scope, selectedStepId, onSelectStep, onEnterService, replay, reduced, bloom }: DrilldownSceneProps) {
  const [labels] = useState(() => new LabelLayer());
  const anchors = useMemo(() => labelAnchors(model, selectedStepId, scope), [model, selectedStepId, scope]);
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[300, 900, 600]} intensity={1.1} />
      <FlowPlane model={model} colors={colors} />
      {model.steps.map((step) => (
        <StepMarker key={step.id} step={step} colors={colors} selected={step.id === selectedStepId} reduced={reduced} onSelect={onSelectStep} labels={labels} />
      ))}
      {model.boards.map((board) => (
        <group key={board.serviceDefinitionId}>
          <BoardPlane board={board} colors={colors} entered={scope === board.serviceDefinitionId} onEnter={onEnterService} labels={labels} />
          <BoardLines board={board} colors={colors} />
          <Stations board={board} colors={colors} labelled={scope === board.serviceDefinitionId} labels={labels} />
        </group>
      ))}
      <Shafts shafts={model.shafts} colors={colors} selectedStepId={selectedStepId} />
      {replay && <ReplayParticles steps={replay.steps} playback={replay.playback} shafts={model.shafts} colors={colors} reduced={reduced} />}
      <CameraRig model={model} scope={scope} reduced={reduced} />
      <LabelDeclutter labels={labels} anchors={anchors} />
      {bloom && (
        <EffectComposer>
          {/* Selective: only colours pushed above 1 (shafts, particles; toneMapped off) pass the threshold. */}
          <Bloom luminanceThreshold={1} intensity={0.9} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

/** The flow plane: a band per lane with its caption, the outcomes band, transitions, and outcomes. */
function FlowPlane({ model, colors }: { model: DrilldownModel; colors: DrilldownColors }) {
  const { x0, x1 } = model.flowPlane;
  const transitions = useMemo(
    () =>
      model.transitions.flatMap((t) =>
        t.points.slice(1).flatMap((b, i) => {
          const a = t.points[i] ?? b;
          return [lifted(a), lifted(b)];
        }),
      ),
    [model],
  );
  return (
    <group userData={{ flowId: model.flowId }}>
      {model.lanes.map((lane, i) => (
        <group key={lane.serviceDefinitionId}>
          <mesh position={[(x0 + x1) / 2, -0.5, (lane.z0 + lane.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} userData={{ lane: lane.serviceDefinitionId }}>
            <planeGeometry args={[x1 - x0, lane.z1 - lane.z0]} />
            <meshBasicMaterial color={colors.plane} transparent opacity={i % 2 ? colors.planeOpacity : Math.min(1, colors.planeOpacity + 0.15)} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <Html position={[x0, 0, lane.z0 + 14]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className="pointer-events-none pl-2 text-[10px] tracking-[0.07em] whitespace-nowrap text-fg-3 uppercase select-none" data-lane-label={lane.serviceDefinitionId}>
              {lane.label}
            </div>
          </Html>
        </group>
      ))}
      {transitions.length > 0 && <Line points={transitions} segments color={colors.text3} lineWidth={1.5} transparent opacity={0.85} />}
      {model.outcomes.map((o) => (
        <group key={o.id} position={o.position as [number, number, number]}>
          <mesh position={[0, 8, 0]} rotation={[0, Math.PI / 4, 0]} userData={{ outcomeId: o.id }}>
            <octahedronGeometry args={[11]} />
            <meshStandardMaterial color={o.kind === 'success' ? colors.ok : colors.warn} roughness={0.4} />
          </mesh>
          <Html position={[0, 26, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className="pointer-events-none rounded-md border border-line bg-float/85 px-1.5 py-px text-xs whitespace-nowrap text-fg-2 select-none">{o.name}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

const lifted = (p: Vec3): [number, number, number] => [p[0], p[1] + 1, p[2]];

/** Flies to the scope: the whole flow, or one service's plane. Instant the first time and under reduced motion. */
function CameraRig({ model, scope, reduced }: { model: DrilldownModel; scope: string | null; reduced: boolean }) {
  const controls = useRef<CameraControlsImpl>(null);
  const placed = useRef(false);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = poseFor(scopeBounds(model, scope));
    void c.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], placed.current && !reduced);
    placed.current = true;
  }, [model, scope, reduced]);
  return <CameraControls ref={controls} makeDefault minDistance={60} maxDistance={8000} />;
}

/** Hides labels that overlap a more important one, re-measured only when the camera or the labels change. */
function LabelDeclutter({ labels, anchors }: { labels: LabelLayer; anchors: readonly LabelAnchor[] }) {
  useFrame(({ camera, size }) => labels.update(camera, size, anchors));
  return null;
}

