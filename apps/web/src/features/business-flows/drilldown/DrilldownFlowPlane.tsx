import { Html, Line, RoundedBox } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { easing } from 'maath';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LabelLayer } from '../../service-map/galaxy/labelLayer';
import { arrowHeads, outline, segmentsOf } from './drilldownGeometry';
import { laneLabelAnchor, outcomeLabelAnchor, stepLabelAnchor, STEP_TILE_HEIGHT } from './drilldownLabels';
import type { DrilldownModel, DrilldownOutcome, DrilldownStep } from './drilldownModel';
import type { DrilldownColors } from './drilldownPalette';
import { CHIP, useLabel } from './drilldownChrome';

/**
 * The flow plane of the drill-down (Milestone 13.1): lane strips with captions in a gutter, the
 * flow's transitions in its colour with arrowheads, steps as raised tiles, and outcomes. Faded
 * (but still clickable) while the camera is inside a service.
 */
export const FlowPlane = memo(function FlowPlane({ model, colors, flowColor, faded, labels }: { model: DrilldownModel; colors: DrilldownColors; flowColor: string; faded: boolean; labels: LabelLayer }) {
  const { x0, x1, z0, z1 } = model.flowPlane;
  const fade = faded ? 0.3 : 1;
  const transitions = useMemo(() => segmentsOf(model.transitions.map((t) => t.points), 1.5), [model]);
  const heads = useMemo(() => arrowHeads(model.transitions.map((t) => t.points)), [model]);
  return (
    <group userData={{ flowId: model.flowId }}>
      <mesh position={[(x0 + x1) / 2, -1, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[x1 - x0, z1 - z0 + 40]} />
        <meshBasicMaterial color={colors.plane} transparent opacity={colors.planeOpacity * 0.6 * fade} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={outline({ center: [(x0 + x1) / 2, 0, (z0 + z1) / 2], width: x1 - x0, depth: z1 - z0 + 40 })} color={colors.planeLine} lineWidth={1} transparent opacity={0.8 * fade} />
      {model.lanes.map((lane, i) => (
        <group key={lane.serviceDefinitionId}>
          <mesh position={[(x0 + x1) / 2, -0.5, (lane.z0 + lane.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} userData={{ lane: lane.serviceDefinitionId }}>
            <planeGeometry args={[x1 - x0, lane.z1 - lane.z0]} />
            <meshBasicMaterial color={colors.strip} transparent opacity={(i % 2 ? 0.25 : 0.55) * fade} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {!faded && <LaneCaption id={lane.serviceDefinitionId} label={lane.label} noBoard={!lane.hasBoard} position={laneLabelAnchor(model, lane)} labels={labels} />}
        </group>
      ))}
      {transitions.length > 0 && <Line points={transitions} segments color={flowColor} lineWidth={3} transparent opacity={0.9 * fade} />}
      <ArrowHeads heads={heads} color={flowColor} opacity={fade} />
      {model.outcomes.map((o) => (
        <OutcomeTile key={o.id} outcome={o} colors={colors} faded={faded} labels={labels} />
      ))}
    </group>
  );
});

function LaneCaption({ id, label, noBoard, position, labels }: { id: string; label: string; noBoard: boolean; position: readonly number[]; labels: LabelLayer }) {
  const attach = useLabel(labels, `lane:${id}`);
  return (
    <Html position={position as [number, number, number]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={attach} className="pointer-events-none text-[10px] tracking-[0.08em] whitespace-nowrap text-fg-2 uppercase select-none" data-lane-label={id}>
        {label}
        {noBoard && <span className="block text-[9px] tracking-normal text-fg-3 normal-case">no transit board</span>}
      </div>
    </Html>
  );
}

/** Instanced cones at the end of each transition, pointing along it. */
function ArrowHeads({ heads, color, opacity }: { heads: ReturnType<typeof arrowHeads>; color: string; opacity: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const matrix = new THREE.Matrix4();
    heads.forEach((h, i) => {
      q.setFromUnitVectors(up, new THREE.Vector3(...h.direction));
      // Back the cone off its length so the tip touches the target.
      m.setMatrixAt(i, matrix.compose(new THREE.Vector3(h.position[0] - h.direction[0] * 7, h.position[1], h.position[2] - h.direction[2] * 7), q, new THREE.Vector3(1, 1, 1)));
    });
    m.instanceMatrix.needsUpdate = true;
  }, [heads]);
  if (heads.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, heads.length]} userData={{ arrows: heads.length }}>
      <coneGeometry args={[6, 14, 12]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </instancedMesh>
  );
}

const OutcomeTile = memo(function OutcomeTile({ outcome, colors, faded, labels }: { outcome: DrilldownOutcome; colors: DrilldownColors; faded: boolean; labels: LabelLayer }) {
  const attach = useLabel(labels, `outcome:${outcome.id}`);
  const anchor = outcomeLabelAnchor(outcome);
  return (
    <group position={outcome.position as [number, number, number]}>
      <RoundedBox args={[120, 10, 34]} radius={4} position={[0, 5, 0]} userData={{ outcomeId: outcome.id }}>
        <meshStandardMaterial color={outcome.kind === 'success' ? colors.ok : colors.warn} transparent opacity={faded ? 0.35 : 1} roughness={0.5} />
      </RoundedBox>
      {!faded && (
        <Html position={[0, anchor[1] - outcome.position[1], 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={attach} className={CHIP} data-outcome-label={outcome.id}>
            {outcome.name}
          </div>
        </Html>
      )}
    </group>
  );
});

/** A step: a raised tile with a flow-coloured edge; the selected one lifts and takes the accent (maath easing, frame-local). */
export const StepTile = memo(function StepTile({ step, colors, flowColor, selected, faded, reduced, onSelect, labels }: { step: DrilldownStep; colors: DrilldownColors; flowColor: string; selected: boolean; faded: boolean; reduced: boolean; onSelect: (stepId: string) => void; labels: LabelLayer }) {
  const ref = useRef<THREE.Group>(null);
  const attach = useLabel(labels, `step:${step.id}`);
  const target = useMemo(() => new THREE.Vector3(0, selected ? 10 : 0, 0), [selected]);
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    if (reduced) g.position.copy(target);
    else if (easing.damp3(g.position, target, 0.12, delta)) state.invalidate(); // keep frames coming until it settles
  });
  const anchor = stepLabelAnchor(step);
  return (
    <group position={step.position as [number, number, number]}>
      <group ref={ref}>
        <RoundedBox
          args={[150, STEP_TILE_HEIGHT, 44]}
          radius={5}
          position={[0, STEP_TILE_HEIGHT / 2, 0]}
          userData={{ stepId: step.id }}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            onSelect(step.id);
          }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}
        >
          <meshStandardMaterial color={selected ? colors.accent : colors.plane} emissive={selected ? colors.accent : flowColor} emissiveIntensity={selected ? 0.35 : 0.08} transparent opacity={faded && !selected ? 0.45 : 1} roughness={0.45} />
        </RoundedBox>
        {/* The flow's colour on the leading edge, like the line badge on the 2D step. */}
        <mesh position={[-71, STEP_TILE_HEIGHT / 2 + 0.5, 0]}>
          <boxGeometry args={[8, STEP_TILE_HEIGHT + 1, 44]} />
          <meshBasicMaterial color={flowColor} transparent opacity={faded && !selected ? 0.45 : 1} />
        </mesh>
        <Html position={[0, anchor[1] - step.position[1], 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={attach} className={`${CHIP} ${selected ? 'border-accent font-semibold' : ''}`} data-step-label={step.id}>
            {step.name}
          </div>
        </Html>
      </group>
    </group>
  );
});
