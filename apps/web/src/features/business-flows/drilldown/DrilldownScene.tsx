import { CameraControls, type CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TxStep } from '../../../transit/flows/observed';
import type { Playback } from '../../boards/playback';
import { LabelLayer, type LabelAnchor } from '../../service-map/galaxy/labelLayer';
import { DRILLDOWN_FOV, poseFor } from './drilldownCamera';
import { labelAnchors } from './drilldownLabels';
import { scopeBounds, type DrilldownModel } from './drilldownModel';
import { lineColorOf, type DrilldownColors } from './drilldownPalette';
import { ServicePlane } from './DrilldownBoards';
import { FlowPlane, StepTile } from './DrilldownFlowPlane';
import { ReplayParticles, Shafts } from './DrilldownParts';

/**
 * The 3D drill-down scene (ADR-026, Milestone 13.1): the flow plane over what the flow does inside
 * each service, joined by beams. View models only; selection and scope live in the URL, the camera
 * pose in CameraControls.
 */
export interface DrilldownSceneProps {
  model: DrilldownModel;
  colors: DrilldownColors;
  /** The flow's colour, as on the 2D board (its position in the flow list). */
  flowColorIndex: number;
  /** The service the camera has entered, or null for the whole flow. */
  scope: string | null;
  /** Inside a service: show all its lines, not only the flow's. */
  allLines: boolean;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  onEnterService: (serviceDefinitionId: string) => void;
  replay: { steps: readonly TxStep[]; playback: Playback } | null;
  reduced: boolean;
  /** Selective bloom on the selected beam and particles (dark theme; off in tests). */
  bloom: boolean;
}

export function DrilldownScene({ model, colors, flowColorIndex, scope, allLines, selectedStepId, onSelectStep, onEnterService, replay, reduced, bloom }: DrilldownSceneProps) {
  const [labels] = useState(() => new LabelLayer());
  const anchors = useMemo(() => labelAnchors(model, { selectedStepId, scope, allLines }), [model, selectedStepId, scope, allLines]);
  const flowColor = lineColorOf(colors, flowColorIndex);
  const selected = model.steps.find((s) => s.id === selectedStepId);
  const overview = poseFor(model.bounds);
  const reach = Math.hypot(overview.position[0] - overview.target[0], overview.position[1] - overview.target[1], overview.position[2] - overview.target[2]);
  return (
    <>
      {colors.dark && <fog attach="fog" args={[colors.background, reach * 0.9, reach * 2.6]} />}
      <ambientLight intensity={0.75} />
      <directionalLight position={[300, 900, 600]} intensity={1.1} />
      <FlowPlane model={model} colors={colors} flowColor={flowColor} faded={scope !== null} labels={labels} />
      {model.steps.map((step) => (
        <StepTile key={step.id} step={step} colors={colors} flowColor={flowColor} selected={step.id === selectedStepId} faded={scope !== null && step.serviceDefinitionId !== scope} reduced={reduced} onSelect={onSelectStep} labels={labels} />
      ))}
      {model.boards.map((board) => (
        <ServicePlane
          key={board.serviceDefinitionId}
          board={board}
          colors={colors}
          entered={scope === board.serviceDefinitionId}
          faded={scope !== null && scope !== board.serviceDefinitionId}
          allLines={allLines}
          focusLineId={selected?.serviceDefinitionId === board.serviceDefinitionId ? selected.lineId : null}
          onEnter={onEnterService}
          labels={labels}
        />
      ))}
      <Shafts shafts={model.shafts} colors={colors} flowColor={flowColor} selectedStepId={selectedStepId} scope={scope} />
      {replay && <ReplayParticles steps={replay.steps} playback={replay.playback} shafts={model.shafts} colors={colors} flowColor={flowColor} reduced={reduced} />}
      <CameraRig model={model} scope={scope} allLines={allLines} reduced={reduced} />
      <LabelDeclutter labels={labels} anchors={anchors} />
      {bloom && (
        <EffectComposer>
          {/* Selective: only colours pushed above 1 (the selected beam and line, particles) pass the threshold. */}
          <Bloom luminanceThreshold={1} intensity={0.9} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

/** Flies to the scope: the whole flow, or one service's plane (its whole board with all lines). Instant the first time and under reduced motion. */
function CameraRig({ model, scope, allLines, reduced }: { model: DrilldownModel; scope: string | null; allLines: boolean; reduced: boolean }) {
  const controls = useRef<CameraControlsImpl>(null);
  const placed = useRef(false);
  const aspect = useThree((s) => (s.size.height > 0 ? s.size.width / s.size.height : 1.6));
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { position, target } = poseFor(scopeBounds(model, scope, allLines), { fov: DRILLDOWN_FOV, aspect });
    void c.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], placed.current && !reduced);
    placed.current = true;
  }, [model, scope, allLines, reduced, aspect]);
  return <CameraControls ref={controls} makeDefault minDistance={60} maxDistance={9000} />;
}

/** Hides labels that overlap a more important one, re-measured only when the camera or the labels change. */
function LabelDeclutter({ labels, anchors }: { labels: LabelLayer; anchors: readonly LabelAnchor[] }) {
  useFrame(({ camera, size }) => labels.update(camera, size, anchors));
  return null;
}
