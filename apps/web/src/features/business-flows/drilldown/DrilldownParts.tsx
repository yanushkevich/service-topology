import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { activeTxSteps, type TxStep } from '../../../transit/flows/observed';
import type { Playback } from '../../boards/playback';
import { particleOnShaft } from './drilldownCamera';
import type { DrilldownShaft } from './drilldownModel';
import type { DrilldownColors } from './drilldownPalette';

/**
 * Shafts and replay particles of the drill-down (Milestone 13.1). Shafts are beams in the flow's
 * colour from each step to the entry station of its line, with a ring where they land; the
 * selected step's beam is bright enough to bloom. Steps without a line get a short dashed stub.
 * Nothing here writes React or store state per frame.
 */
export const Shafts = memo(function Shafts({ shafts, colors, flowColor, selectedStepId, scope }: { shafts: readonly DrilldownShaft[]; colors: DrilldownColors; flowColor: string; selectedStepId: string | null; scope: string | null }) {
  const mapped = shafts.filter((s) => s.lineId !== null);
  const stubs = shafts.filter((s) => s.lineId === null);
  const inScope = (s: DrilldownShaft) => !scope || s.serviceDefinitionId === scope;
  const pairs = (list: readonly DrilldownShaft[]) => list.flatMap((s) => [s.from, s.to] as [number, number, number][]);
  const selected = mapped.filter((s) => s.stepId === selectedStepId);
  const near = mapped.filter((s) => s.stepId !== selectedStepId && inScope(s));
  const far = mapped.filter((s) => s.stepId !== selectedStepId && !inScope(s));
  const glow = useMemo(() => new THREE.Color(flowColor).multiplyScalar(colors.dark ? 2.2 : 1), [flowColor, colors.dark]);
  return (
    <group userData={{ shafts: mapped.map((s) => s.stepId), stubs: stubs.map((s) => s.stepId) }}>
      {near.length > 0 && <Line points={pairs(near)} segments color={flowColor} lineWidth={2.5} transparent opacity={selectedStepId ? 0.35 : 0.7} />}
      {far.length > 0 && <Line points={pairs(far)} segments color={flowColor} lineWidth={1.5} transparent opacity={0.15} />}
      {selected.length > 0 && <Line points={pairs(selected)} segments color={glow} lineWidth={4.5} toneMapped={false} />}
      {stubs.length > 0 && <Line points={pairs(stubs)} segments color={colors.text3} lineWidth={1.5} dashed dashSize={10} gapSize={8} transparent opacity={scope ? 0.2 : 0.6} />}
      {stubs.map((s) => (
        // An empty ring where a stub ends: nothing is known inside this service yet.
        <mesh key={s.stepId} position={[s.to[0], s.to[1], s.to[2]]} rotation={[-Math.PI / 2, 0, 0]} userData={{ stubEnd: s.stepId }}>
          <ringGeometry args={[8, 10, 24]} />
          <meshBasicMaterial color={colors.text3} transparent opacity={scope ? 0.2 : 0.7} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {mapped.map((s) => (
        <mesh key={s.stepId} position={[s.to[0], s.to[1] + 5, s.to[2]]} rotation={[-Math.PI / 2, 0, 0]} userData={{ landing: s.stepId }}>
          <ringGeometry args={[11, 14, 28]} />
          <meshBasicMaterial color={s.stepId === selectedStepId ? glow : flowColor} transparent opacity={inScope(s) ? 0.9 : 0.2} toneMapped={s.stepId !== selectedStepId} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
});

const PARTICLES = 6;

/**
 * Replay particles on the playback clock (never stepped from frames): each active step's particle
 * goes down its shaft into the service's line and back up. Positions are set imperatively.
 */
export function ReplayParticles({ steps, playback, shafts, colors, flowColor, reduced }: { steps: readonly TxStep[]; playback: Playback; shafts: readonly DrilldownShaft[]; colors: DrilldownColors; flowColor: string; reduced: boolean }) {
  const pool = useRef<(THREE.Mesh | null)[]>([]);
  const byStep = useMemo(() => new Map(shafts.filter((s) => s.lineId !== null).map((s) => [s.stepId, s])), [shafts]);
  const glow = useMemo(() => new THREE.Color(flowColor).multiplyScalar(colors.dark ? 3 : 1), [flowColor, colors.dark]);
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
          <sphereGeometry args={[14, 16, 12]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
