import { Html, Line } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LabelLayer } from '../../service-map/galaxy/labelLayer';
import { CHIP, useLabel } from './drilldownChrome';
import { gridSegments, outline, segmentsOf } from './drilldownGeometry';
import { boardLabelAnchor, stationLabelAnchor } from './drilldownLabels';
import type { DrilldownBoard, DrilldownStation, Footprint } from './drilldownModel';
import { lineColorOf, type DrilldownColors } from './drilldownPalette';

/**
 * A service in the drill-down (Milestone 13.1), in the 2D board's language: the flow's lines as
 * ribbons in their line colours, white stations with dark rings, policy diamonds, a faint grid.
 * Lines outside the flow appear (thin, dimmed) only with Show all lines inside the service. A
 * service without a board hangs nothing.
 */
export interface ServicePlaneProps {
  board: DrilldownBoard;
  colors: DrilldownColors;
  /** The camera is inside this service. */
  entered: boolean;
  /** Another service is entered: step back. */
  faded: boolean;
  /** Show the whole board (only while entered). */
  allLines: boolean;
  /** The selected step's line, when it is on this board: brighter, the other flow lines quieter. */
  focusLineId: string | null;
  onEnter: (serviceId: string) => void;
  labels: LabelLayer;
}

export const ServicePlane = memo(function ServicePlane(props: ServicePlaneProps) {
  // A service without a board hangs nothing under its lane: its steps' stubs and lane caption say so.
  return props.board.kind === 'pad' ? null : <Board {...props} />;
});

function Board({ board, colors, entered, faded, allLines, focusLineId, onEnter, labels }: ServicePlaneProps) {
  const whole = entered && allLines;
  const footprint: Footprint = whole ? board.full : board;
  const fade = faded ? 0.25 : 1;
  const grid = useMemo(() => gridSegments(footprint, 60), [footprint]);
  const flowLines = board.lines.filter((l) => l.inFlow);
  const otherSegments = useMemo(() => (whole ? segmentsOf(board.lines.filter((l) => !l.inFlow).flatMap((l) => l.branches), 1) : []), [board, whole]);
  const stations = board.stations.filter((s) => whole || s.inFlow);
  const flowCount = flowLines.length;
  return (
    <group userData={{ serviceDefinitionId: board.serviceDefinitionId }}>
      <Slab footprint={footprint} colors={colors} fade={fade} entered={entered} serviceId={board.serviceDefinitionId} onEnter={onEnter} />
      {grid.length > 0 && <Line points={grid} segments color={colors.grid} lineWidth={1} transparent opacity={0.35 * fade} />}
      {otherSegments.length > 0 && <Line points={otherSegments} segments color={colors.dim} lineWidth={2} transparent opacity={0.6} />}
      {flowLines.map((line) => {
        const focused = line.lineId === focusLineId;
        const quiet = focusLineId !== null && !focused;
        const color = new THREE.Color(lineColorOf(colors, line.colorIndex));
        if (focused && colors.dark) color.multiplyScalar(1.6); // above 1: the selected line blooms
        return <Line key={line.lineId} points={segmentsOf(line.branches, 2)} segments color={color} lineWidth={focused ? 9 : 6} transparent opacity={(quiet ? 0.35 : 1) * fade} toneMapped={!focused} userData={{ lineId: line.lineId, inFlow: true }} />;
      })}
      <StationDiscs stations={stations} colors={colors} fade={fade} serviceId={board.serviceDefinitionId} />
      <PolicyDiamonds board={board} colors={colors} fade={fade} />
      {entered && stations.map((s) => <StationLabel key={s.id} station={s} labels={labels} />)}
      {!faded && (
        <PlaneLabel board={board} labels={labels} detail={whole ? `${board.lines.length} lines` : `${flowCount} of ${board.lines.length} lines in this flow`} />
      )}
    </group>
  );
}

/** The plane's fill and outline; clicking it enters the service. */
function Slab({ footprint, colors, fade, entered, serviceId, onEnter }: { footprint: Footprint; colors: DrilldownColors; fade: number; entered: boolean; serviceId: string; onEnter: (id: string) => void }) {
  const [x, y, z] = footprint.center;
  return (
    <>
      <mesh
        position={[x, y - 1, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ serviceDefinitionId: serviceId }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onEnter(serviceId);
        }}
      >
        <planeGeometry args={[footprint.width, footprint.depth]} />
        <meshBasicMaterial color={colors.plane} transparent opacity={colors.planeOpacity * fade} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={outline(footprint)} color={entered ? colors.accent : colors.planeLine} lineWidth={entered ? 2 : 1.2} transparent opacity={0.95 * fade} />
    </>
  );
}

const BIG_STATIONS: ReadonlySet<string> = new Set(['gate', 'dependency', 'caller']);
/** Flat, facing up: rotated onto the plane. */
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/** Stations as the 2D board draws them: a white disc on a dark ring, flat on the plane, bigger for gates, callers, and dependencies. Two instanced meshes. */
function StationDiscs({ stations, colors, fade, serviceId }: { stations: readonly DrilldownStation[]; colors: DrilldownColors; fade: number; serviceId: string }) {
  const rings = useRef<THREE.InstancedMesh>(null);
  const discs = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    stations.forEach((s, i) => {
      const r = BIG_STATIONS.has(s.kind) ? 1.35 : 1;
      rings.current?.setMatrixAt(i, matrix.compose(new THREE.Vector3(s.position[0], s.position[1] + 3, s.position[2]), FLAT, new THREE.Vector3(r, r, 1)));
      discs.current?.setMatrixAt(i, matrix.compose(new THREE.Vector3(s.position[0], s.position[1] + 3.4, s.position[2]), FLAT, new THREE.Vector3(r, r, 1)));
    });
    if (rings.current) rings.current.instanceMatrix.needsUpdate = true;
    if (discs.current) discs.current.instanceMatrix.needsUpdate = true;
  }, [stations]);
  if (stations.length === 0) return null;
  return (
    <group key={stations.length} userData={{ serviceDefinitionId: serviceId, stations: stations.map((s) => s.id) }}>
      <instancedMesh ref={rings} args={[undefined, undefined, stations.length]}>
        <circleGeometry args={[9, 24]} />
        <meshBasicMaterial color={colors.stationRing} transparent opacity={fade} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={discs} args={[undefined, undefined, stations.length]}>
        <circleGeometry args={[6, 24]} />
        <meshBasicMaterial color={colors.station} transparent opacity={fade} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}

/** Policy stops on the flow's lines as small diamonds in their pattern colours (missing ones in the warning colour). */
function PolicyDiamonds({ board, colors, fade }: { board: DrilldownBoard; colors: DrilldownColors; fade: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    board.policies.forEach((p, i) => {
      m.setMatrixAt(i, matrix.makeTranslation(p.position[0], p.position[1] + 9, p.position[2]));
      m.setColorAt(i, color.set(p.state === 'missing' ? colors.warn : colors.policy[p.type]));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [board, colors]);
  if (board.policies.length === 0) return null;
  return (
    <instancedMesh key={board.policies.length} ref={mesh} args={[undefined, undefined, board.policies.length]} userData={{ policies: board.policies.map((p) => p.id) }}>
      <octahedronGeometry args={[6]} />
      <meshBasicMaterial transparent opacity={fade} />
    </instancedMesh>
  );
}

function PlaneLabel({ board, detail, labels }: { board: DrilldownBoard; detail: string; labels: LabelLayer }) {
  const attach = useLabel(labels, `board:${board.serviceDefinitionId}`);
  return (
    <Html position={boardLabelAnchor(board) as [number, number, number]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={attach} className={`${CHIP} font-semibold`} data-board-label={board.serviceDefinitionId}>
        {board.name}
        <span className="ml-1.5 font-normal text-fg-3">{detail}</span>
      </div>
    </Html>
  );
}

function StationLabel({ station, labels }: { station: DrilldownStation; labels: LabelLayer }) {
  const attach = useLabel(labels, `station:${station.id}`);
  return (
    <Html position={stationLabelAnchor(station) as [number, number, number]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={attach} className={CHIP} data-station-label={station.id}>
        {station.name}
      </div>
    </Html>
  );
}
