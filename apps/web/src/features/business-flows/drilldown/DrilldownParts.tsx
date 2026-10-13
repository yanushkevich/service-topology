import { Html, Line } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { easing } from 'maath';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { activeTxSteps, type TxStep } from '../../../transit/flows/observed';
import type { Playback } from '../../boards/playback';
import { particleOnShaft } from './drilldownCamera';
import type { DrilldownBoard, DrilldownShaft, DrilldownStep, Vec3 } from './drilldownModel';
import { lineColorOf, type DrilldownColors } from './drilldownPalette';

/**
 * Pieces of the 3D drill-down scene (ADR-026). View models only: every mesh carries its canonical
 * ID in `userData`. Stations are one instanced mesh per board; lines, transitions, and shafts are
 * one segment set each. Nothing here writes React or store state per frame.
 */

const LABEL = 'pointer-events-none select-none whitespace-nowrap rounded-md border border-line bg-float/85 px-1.5 py-px text-xs font-medium text-fg';

/** A service's transit plane: a translucent slab with its outline and name; clicking it enters the service. */
export const BoardPlane = memo(function BoardPlane({ board, colors, entered, onEnter }: { board: DrilldownBoard; colors: DrilldownColors; entered: boolean; onEnter: (serviceId: string) => void }) {
  const [x, y, z] = board.center;
  const hw = board.width / 2;
  const hd = board.depth / 2;
  const outline: Vec3[] = [
    [x - hw, y, z - hd],
    [x + hw, y, z - hd],
    [x + hw, y, z + hd],
    [x - hw, y, z + hd],
    [x - hw, y, z - hd],
  ];
  return (
    <group userData={{ serviceDefinitionId: board.serviceDefinitionId }}>
      <mesh
        position={[x, y - 1, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ serviceDefinitionId: board.serviceDefinitionId }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onEnter(board.serviceDefinitionId);
        }}
      >
        <planeGeometry args={[board.width, board.depth]} />
        <meshBasicMaterial color={colors.plane} transparent opacity={entered ? 0.55 : 0.32} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={outline as [number, number, number][]} color={entered ? colors.accent : colors.planeLine} lineWidth={entered ? 2 : 1} transparent opacity={0.9} />
      <Html position={[x - hw, y, z - hd]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`${LABEL} -translate-y-full font-semibold`} data-board-label={board.serviceDefinitionId}>
          {board.name}
          {!board.hasBoard && <span className="ml-1.5 font-normal text-fg-3">no transit board yet</span>}
        </div>
      </Html>
    </group>
  );
});

const STATION_COLOR: Record<string, keyof DrilldownColors> = { caller: 'text3', gate: 'accent', module: 'text', client: 'text3', dependency: 'ok' };

/** A board's stations as one instanced mesh; labelled only when the camera has entered the service. */
export const Stations = memo(function Stations({ board, colors, labelled }: { board: DrilldownBoard; colors: DrilldownColors; labelled: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    board.stations.forEach((s, i) => {
      m.setMatrixAt(i, matrix.makeTranslation(s.position[0], s.position[1] + 4, s.position[2]));
      const key = STATION_COLOR[s.kind] ?? 'text3';
      const value = colors[key];
      m.setColorAt(i, color.set(typeof value === 'string' ? value : colors.accent));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [board, colors]);
  if (board.stations.length === 0) return null;
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, board.stations.length]} userData={{ serviceDefinitionId: board.serviceDefinitionId, stations: board.stations.map((s) => s.id) }}>
        <sphereGeometry args={[5, 12, 8]} />
        <meshStandardMaterial roughness={0.5} />
      </instancedMesh>
      {labelled &&
        board.stations.map((s) => (
          <Html key={s.id} position={[s.position[0], s.position[1] + 12, s.position[2]]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
            <div className={LABEL} data-station-label={s.id}>
              {s.name}
            </div>
          </Html>
        ))}
    </>
  );
});

/** A board's lines as one set of coloured segments, in the transit board's line colours. */
export const BoardLines = memo(function BoardLines({ board, colors }: { board: DrilldownBoard; colors: DrilldownColors }) {
  const { points, vertexColors } = useMemo(() => {
    const pts: [number, number, number][] = [];
    const cols: [number, number, number][] = [];
    const color = new THREE.Color();
    for (const line of board.lines) {
      color.set(lineColorOf(colors, line.colorIndex));
      for (const branch of line.branches) {
        for (let i = 1; i < branch.length; i++) {
          const a = branch[i - 1];
          const b = branch[i];
          if (!a || !b) continue;
          pts.push([a[0], a[1] + 2, a[2]], [b[0], b[1] + 2, b[2]]);
          cols.push([color.r, color.g, color.b], [color.r, color.g, color.b]);
        }
      }
    }
    return { points: pts, vertexColors: cols };
  }, [board, colors]);
  if (points.length === 0) return null;
  return <Line points={points} vertexColors={vertexColors} segments lineWidth={2.5} userData={{ serviceDefinitionId: board.serviceDefinitionId, lines: board.lines.map((l) => l.lineId) }} />;
});

/** Light shafts from steps to their lines' entry stations; bright enough to bloom, and the selected step's brightest. */
export const Shafts = memo(function Shafts({ shafts, colors, selectedStepId }: { shafts: readonly DrilldownShaft[]; colors: DrilldownColors; selectedStepId: string | null }) {
  if (shafts.length === 0) return null;
  const glow = new THREE.Color(colors.accent).multiplyScalar(2.2);
  const rest = shafts.filter((s) => s.stepId !== selectedStepId);
  const selected = shafts.filter((s) => s.stepId === selectedStepId);
  const segments = (list: readonly DrilldownShaft[]) => list.flatMap((s) => [s.from, s.to] as [number, number, number][]);
  return (
    <group userData={{ shafts: shafts.map((s) => s.stepId) }}>
      {rest.length > 0 && <Line points={segments(rest)} segments color={glow} lineWidth={1.5} transparent opacity={0.7} toneMapped={false} dashed dashSize={10} gapSize={6} />}
      {selected.length > 0 && <Line points={segments(selected)} segments color={glow} lineWidth={3.5} toneMapped={false} />}
    </group>
  );
});

/** A step on the flow plane: a tile with its label; the selected one lifts and glows (maath easing, frame-local). */
export const StepMarker = memo(function StepMarker({ step, colors, selected, reduced, onSelect }: { step: DrilldownStep; colors: DrilldownColors; selected: boolean; reduced: boolean; onSelect: (stepId: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(1, selected ? 2.4 : 1, 1), [selected]);
  useFrame((state, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (reduced) mesh.scale.copy(target);
    else if (easing.damp3(mesh.scale, target, 0.12, delta)) state.invalidate(); // keep frames coming until it settles
  });
  return (
    <group position={step.position as [number, number, number]}>
      <mesh
        ref={ref}
        position={[0, 6, 0]}
        userData={{ stepId: step.id }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(step.id);
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <boxGeometry args={[46, 10, 26]} />
        <meshStandardMaterial color={selected ? colors.accent : colors.plane} emissive={selected ? colors.accent : colors.text3} emissiveIntensity={selected ? 0.6 : 0.15} roughness={0.4} />
      </mesh>
      <Html position={[0, 24, 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`${LABEL} ${selected ? 'border-accent' : ''}`} data-step-label={step.id}>
          {step.name}
        </div>
      </Html>
    </group>
  );
});

const PARTICLES = 6;

/**
 * Replay particles on the playback clock (never stepped from frames): each active step's particle
 * goes down its shaft into the service's line and back up. Positions are set imperatively.
 */
export function ReplayParticles({ steps, playback, shafts, colors, reduced }: { steps: readonly TxStep[]; playback: Playback; shafts: readonly DrilldownShaft[]; colors: DrilldownColors; reduced: boolean }) {
  const pool = useRef<(THREE.Mesh | null)[]>([]);
  const byStep = useMemo(() => new Map(shafts.map((s) => [s.stepId, s])), [shafts]);
  const glow = useMemo(() => new THREE.Color(colors.accent).multiplyScalar(3), [colors]);
  useFrame(() => {
    const clock = playback.get();
    const active = activeTxSteps(steps, clock.t, clock.step).filter((s) => byStep.has(s.stepId));
    pool.current.forEach((mesh, i) => {
      if (!mesh) return;
      const step = active[i];
      const shaft = step ? byStep.get(step.stepId) : undefined;
      mesh.visible = Boolean(step && shaft);
      if (!step || !shaft) return;
      const progress = (clock.t - step.displayStartMs) / Math.max(1, step.displayDurationMs);
      const [x, y, z] = particleOnShaft(shaft, progress, reduced);
      mesh.position.set(x, y, z);
    });
  });
  return (
    <group userData={{ particles: PARTICLES }}>
      {Array.from({ length: PARTICLES }, (_, i) => (
        <mesh
          key={i}
          visible={false}
          ref={(m) => {
            pool.current[i] = m;
          }}
        >
          <sphereGeometry args={[7, 16, 12]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

