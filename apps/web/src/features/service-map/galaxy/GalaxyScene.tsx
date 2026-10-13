import { Html, Line, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { gsap } from 'gsap';
import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import * as THREE from 'three';
import type { EntityRef } from '../../../domain/types';
import { healthLabel } from '../../../shared/mappings';
import { approachPose, CameraMemory, fitPose, focusPose, type CameraPose } from './cameraMath';
import { ringPoint, type RingLayout, type Vec3 } from './layout3d';
import { CONTAINMENT_COLOR, NODE_COLOR, ORBIT_RING_COLOR, PARTICLE_TINT, SERVICE_COLOR, STARFIELD_COLOR, type GalaxyColors } from './palette';
import { labelPriority } from './labelDeclutter';
import { LabelLayer, type LabelAnchor } from './labelLayer';
import { CONTAINER_TYPES, NEAR_LABEL_DISTANCE, type MotionPolicy, type SceneEdge, type SceneModel, type SceneNode } from './sceneModel';

/**
 * Galaxy scene contents (spec §2, §6). Renders view models only; every mesh carries its canonical
 * ID in `userData.entityId`. No React state changes per frame: particles and camera tweens update
 * Three.js objects imperatively. Geometries/materials declared in JSX are disposed by R3F on
 * unmount; buffers built here are disposed explicitly.
 */

export interface GalaxyHandle {
  fit: () => void;
  focus: (id: string) => void;
  zoom: (factor: number) => void;
  /** Fly toward a node, then call `arrive` (which switches the scope). */
  diveInto: (id: string, arrive: () => void) => void;
}

interface GalaxySceneProps {
  scene: SceneModel;
  scopePath: readonly string[];
  policy: MotionPolicy;
  showContainment: boolean;
  colors: GalaxyColors;
  onSelect: (ref: EntityRef) => void;
  onEnter: (id: string) => void;
  handleRef: Ref<GalaxyHandle>;
  memory: CameraMemory;
}

const LABEL_STATUS: Record<string, string> = { degraded: 'text-warn-fg', unavailable: 'text-crit-fg', unknown: 'text-fg-3' };
const DASH: Record<string, [number, number]> = { http: [1, 0], grpc: [9, 4], data: [1.5, 5], event: [9, 4], other: [2, 3] };

export function GalaxyScene(props: GalaxySceneProps) {
  const { scene, policy, showContainment, colors, onSelect, onEnter } = props;
  const [hovered, setHovered] = useState<string | null>(null);
  const [labels] = useState(() => new LabelLayer());
  // Label anchors above each node, ranked for the declutter; rebuilt only when the nodes or the hover change.
  const anchors = useMemo<LabelAnchor[]>(
    () => scene.nodes.map((n) => ({ id: n.id, position: [n.position[0], n.position[1] + n.radius + 8, n.position[2]], priority: labelPriority(n, hovered) })),
    [scene.nodes, hovered],
  );
  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[0, 600, 400]} intensity={1.4} decay={0} />
      <Stars />
      {showContainment && <Containment scene={scene} colors={colors} />}
      <Edges edges={scene.edges} colors={colors} />
      <Arrows edges={scene.edges} colors={colors} />
      <GlowPaths edges={scene.edges} colors={colors} />
      {policy.particles && <TrafficParticles edges={scene.edges} highlightActive={scene.highlightActive} colors={colors} />}
      {scene.nodes.map((node) => (
        <GalaxyNode
          key={node.id}
          node={node}
          colors={colors}
          hovered={hovered === node.id}
          onHover={setHovered}
          onSelect={onSelect}
          onEnter={onEnter}
          labels={labels}
        />
      ))}
      <LabelDeclutter anchors={anchors} labels={labels} />
      <CameraRig {...props} />
    </>
  );
}

/** Deterministic background stars (decorative, static, far behind the graph). */
const Stars = memo(function Stars() {
  const positions = useMemo(() => {
    const count = 900;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * 2.399963;
      const d = 5000 + ((i * 7919) % 2000);
      out[i * 3] = Math.cos(theta) * r * d;
      out[i * 3 + 1] = y * d * 0.6;
      out[i * 3 + 2] = Math.sin(theta) * r * d;
    }
    return out;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={2} sizeAttenuation={false} color={STARFIELD_COLOR} transparent opacity={0.35} depthWrite={false} />
    </points>
  );
});

/** Containment: tilted rings and undirected dashed spokes. Never arrows, never glow. */
function Containment({ scene, colors }: { scene: SceneModel; colors: GalaxyColors }) {
  return (
    <group name="containment">
      {scene.rings.map((ring) => (
        <Ring key={ring.id} ring={ring} color={ring.kind === 'scope-shell' ? colors.text3 : ORBIT_RING_COLOR} />
      ))}
      {scene.containment.map((link) => (
        <Line
          key={link.id}
          points={[link.from as unknown as THREE.Vector3Tuple, link.to as unknown as THREE.Vector3Tuple]}
          color={CONTAINMENT_COLOR}
          lineWidth={1}
          dashed
          dashSize={4}
          gapSize={4}
          transparent
          opacity={0.55}
          userData={{ containment: link.id }}
        />
      ))}
    </group>
  );
}

function Ring({ ring, color }: { ring: RingLayout; color: string }) {
  const points = useMemo(
    () => Array.from({ length: 73 }, (_, i) => ringPoint(ring.center, ring.radius, ring.tilt, (i / 72) * Math.PI * 2) as unknown as THREE.Vector3Tuple),
    [ring],
  );
  const shell = ring.kind === 'scope-shell';
  return (
    <Line
      points={points}
      color={color}
      lineWidth={1}
      dashed={shell}
      dashSize={2}
      gapSize={7}
      transparent
      opacity={shell ? 0.25 : 0.32}
    />
  );
}

/** All communication paths of one kind in one LineSegments (dash pattern per kind; alpha per vertex for dimming). */
function Edges({ edges, colors }: { edges: SceneEdge[]; colors: GalaxyColors }) {
  const groups = useMemo(() => {
    const byKind = new Map<string, SceneEdge[]>();
    for (const e of edges) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
    return [...byKind.entries()];
  }, [edges]);
  return (
    <group name="edges">
      {groups.map(([kind, list]) => (
        <EdgeKindLines key={kind} kind={kind} edges={list} color={colors.edge[kind as keyof GalaxyColors['edge']] ?? colors.text3} />
      ))}
    </group>
  );
}

function EdgeKindLines({ kind, edges, color }: { kind: string; edges: SceneEdge[]; color: string }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colorsArray: number[] = [];
    const c = new THREE.Color(color);
    for (const e of edges) {
      const alpha = e.emphasis === 'dimmed' ? 0.1 : e.emphasis === 'none' ? 0.5 : 0.95;
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i] as Vec3;
        const b = e.points[i + 1] as Vec3;
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        colorsArray.push(c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colorsArray, 4));
    return g;
  }, [edges, color]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    ref.current?.computeLineDistances();
  }, [geometry]);
  const [dash, gap] = DASH[kind] ?? [1, 0];
  return (
    <lineSegments ref={ref} geometry={geometry} userData={{ edgeKind: kind, relationshipIds: edges.map((e) => e.id) }}>
      <lineDashedMaterial vertexColors transparent depthWrite={false} dashSize={dash} gapSize={gap} />
    </lineSegments>
  );
}

/** Direction cones (one per direction known); dimmed with the edge. */
function Arrows({ edges, colors }: { edges: SceneEdge[]; colors: GalaxyColors }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const arrows = useMemo(() => edges.flatMap((e) => e.arrows.map((a) => ({ ...a, edge: e }))), [edges]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const background = new THREE.Color(colors.background);
    arrows.forEach((arrow, i) => {
      quaternion.setFromUnitVectors(up, new THREE.Vector3(...arrow.direction).normalize());
      const s = arrow.edge.emphasis === 'selected' || arrow.edge.emphasis === 'highlighted' ? 1.4 : 1;
      matrix.compose(new THREE.Vector3(...arrow.position), quaternion, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, matrix);
      const color = new THREE.Color(colors.edge[arrow.edge.kind] ?? colors.text3);
      if (arrow.edge.emphasis === 'dimmed') color.lerp(background, 0.8);
      mesh.setColorAt(i, color);
    });
    mesh.count = arrows.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [arrows, colors]);
  if (arrows.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, arrows.length]} name="arrows">
      <coneGeometry args={[3, 9, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Selected/highlighted paths get a soft glowing tube; status problems get a marker at the midpoint. */
function GlowPaths({ edges, colors }: { edges: SceneEdge[]; colors: GalaxyColors }) {
  const hot = edges.filter((e) => e.emphasis === 'selected' || e.emphasis === 'highlighted');
  const problems = edges.filter((e) => e.status === 'degraded' || e.status === 'inactive');
  return (
    <group name="glow">
      {hot.map((e) => (
        <GlowTube key={e.id} edge={e} color={colors.edge[e.kind] ?? colors.accent} />
      ))}
      {problems.map((e) => {
        const mid = e.points[Math.floor(e.points.length / 2)] as Vec3;
        return (
          <mesh key={`status:${e.id}`} position={mid as unknown as THREE.Vector3Tuple} userData={{ relationshipId: e.id, status: e.status }}>
            {e.status === 'inactive' ? <octahedronGeometry args={[4]} /> : <tetrahedronGeometry args={[4.5]} />}
            <meshBasicMaterial color={e.status === 'inactive' ? colors.crit : colors.warn} transparent opacity={e.emphasis === 'dimmed' ? 0.25 : 0.95} />
          </mesh>
        );
      })}
    </group>
  );
}

function GlowTube({ edge, color }: { edge: SceneEdge; color: string }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(edge.points.map((p) => new THREE.Vector3(...p))), [edge.points]);
  const selected = edge.emphasis === 'selected';
  return (
    <group userData={{ relationshipId: edge.id }}>
      <mesh>
        <tubeGeometry args={[curve, 32, selected ? 1.1 : 0.8, 6, false]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 32, selected ? 4 : 3, 8, false]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Moving dots along paths whose relationships have a throughput field (spec §2 "activity
 * particles"). Rate follows the data; all current data is simulated, which the overlay labels.
 */
function TrafficParticles({ edges, highlightActive, colors }: { edges: SceneEdge[]; highlightActive: boolean; colors: GalaxyColors }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const particles = useMemo(() => {
    const candidates = edges
      .filter((e) => e.trafficRate !== null && e.emphasis !== 'dimmed')
      .filter((e) => !highlightActive || e.emphasis !== 'none');
    return candidates.slice(0, 300).flatMap((e) => {
      const count = Math.min(3, Math.ceil(e.trafficRate ?? 1));
      return Array.from({ length: count }, (_, k) => ({ edge: e, offset: k / count }));
    });
  }, [edges, highlightActive]);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    particles.forEach((p, i) => mesh.setColorAt(i, new THREE.Color(colors.edge[p.edge.kind] ?? colors.accent).lerp(new THREE.Color(PARTICLE_TINT), 0.35)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [particles, colors]);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const time = clock.getElapsedTime();
    particles.forEach((p, i) => {
      const pts = p.edge.points;
      const t = (time * (p.edge.trafficRate ?? 1) * 0.35 + p.offset) % 1;
      const f = t * (pts.length - 1);
      const a = pts[Math.floor(f)] as Vec3;
      const b = (pts[Math.min(pts.length - 1, Math.floor(f) + 1)] ?? a) as Vec3;
      const k = f - Math.floor(f);
      matrix.makeTranslation(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  if (particles.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, particles.length]} name="traffic">
      <sphereGeometry args={[1.8, 8, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Silhouette per entity type (Foundations artboard): shape first, color second. */
function Shape({ type, radius }: { type: string; radius: number }) {
  switch (type) {
    case 'gateway':
      return <cylinderGeometry args={[radius, radius, radius * 1.1, 6]} />;
    case 'database':
    case 'search-index':
      return <cylinderGeometry args={[radius * 0.85, radius * 0.85, radius * 1.5, 24]} />;
    case 'cache':
      return <octahedronGeometry args={[radius * 1.1]} />;
    case 'topic':
    case 'queue':
      return <capsuleGeometry args={[radius * 0.5, radius * 1.4, 6, 12]} />;
    case 'exchange':
      return <octahedronGeometry args={[radius]} />;
    default:
      return CONTAINER_TYPES.has(type) ? <sphereGeometry args={[radius * 0.45, 20, 16]} /> : <sphereGeometry args={[radius, 28, 20]} />;
  }
}

const GalaxyNode = memo(function GalaxyNode({
  node,
  colors,
  hovered,
  onHover,
  onSelect,
  onEnter,
  labels,
}: {
  node: SceneNode;
  colors: GalaxyColors;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (ref: EntityRef) => void;
  onEnter: (id: string) => void;
  labels: LabelLayer;
}) {
  const color = NODE_COLOR[node.type] ?? SERVICE_COLOR;
  const dimmed = node.emphasis === 'dimmed';
  const opacity = dimmed ? 0.22 : node.outside ? 0.75 : 1;
  const container = CONTAINER_TYPES.has(node.type);
  const wire = node.type === 'external-resource' || node.type === 'exchange' || node.type === 'queue';
  const r = node.radius;
  const statusColor = node.health === 'unavailable' ? colors.crit : node.health === 'degraded' ? colors.warn : null;
  const labelRef = useRef<HTMLDivElement | null>(null);
  // drei's Html mounts the label in its own root, later than this component: register it on attach.
  const attachLabel = useCallback(
    (el: HTMLDivElement | null) => {
      labelRef.current = el;
      labels.attach(node.id, el);
    },
    [labels, node.id],
  );
  const worldPosition = useMemo(() => new THREE.Vector3(...node.position), [node.position]);
  // Camera-aware label density: toggled imperatively when the camera moves, never via React state.
  useFrame(({ camera }) => {
    const el = labelRef.current;
    if (!el || node.labelLevel !== 'near') return;
    const visible = hovered || camera.position.distanceTo(worldPosition) < NEAR_LABEL_DISTANCE;
    const value = visible ? '' : 'hidden';
    if (el.style.visibility !== value) el.style.visibility = value;
  });
  const showLabel = node.labelLevel === 'always' || node.labelLevel === 'near' || hovered;
  return (
    <group position={node.position as unknown as THREE.Vector3Tuple} name={node.id} userData={{ entityId: node.id, ref: node.ref }}>
      <mesh
        userData={{ entityId: node.id }}
        rotation={node.type === 'topic' || node.type === 'queue' ? [0, 0, Math.PI / 2] : [0, 0, 0]}
        onClick={(e) => {
          e.stopPropagation();
          if (node.ref) onSelect(node.ref);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEnter(node.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(node.id);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = '';
        }}
      >
        <Shape type={node.type} radius={r} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={dimmed ? 0.05 : 0.35}
          roughness={0.45}
          metalness={0.1}
          wireframe={wire}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      {container && (
        <mesh rotation={[Math.PI / 2.6, 0, 0.3]}>
          <torusGeometry args={[r, Math.max(0.6, r * 0.07), 8, 48]} />
          <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.15 : 0.7} />
        </mesh>
      )}
      {(node.emphasis === 'selected' || node.emphasis === 'highlighted' || hovered) && (
        <mesh>
          <sphereGeometry args={[r * (node.emphasis === 'selected' ? 1.9 : 1.5), 24, 16]} />
          <meshBasicMaterial
            color={node.emphasis === 'selected' ? colors.accent : color}
            transparent
            opacity={node.emphasis === 'selected' ? 0.22 : 0.12}
            side={THREE.BackSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      {statusColor && (
        // Status ring(s) in addition to the label's status shape: one ring degraded, two unavailable.
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r * 1.35, 0.7, 6, 40]} />
            <meshBasicMaterial color={statusColor} transparent opacity={dimmed ? 0.3 : 0.95} />
          </mesh>
          {node.health === 'unavailable' && (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r * 1.6, 0.7, 6, 40]} />
              <meshBasicMaterial color={statusColor} transparent opacity={dimmed ? 0.3 : 0.95} />
            </mesh>
          )}
        </group>
      )}
      {showLabel && (
        <Html position={[0, r + 8, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div
            ref={attachLabel}
            className={`galaxy-label flex flex-col items-center text-xs leading-tight font-medium whitespace-nowrap text-fg select-none ${dimmed ? 'opacity-35' : ''}`}
          >
            <span className={node.emphasis === 'selected' ? 'rounded-md border border-accent bg-surface-1/80 px-1.5 py-px' : undefined}>{node.name}</span>
            {node.memberCount > 1 && <span className="font-mono text-[10px] text-fg-3">{node.memberCount} entities</span>}
            {node.health !== 'healthy' && (
              <span className={`rounded-[4px] border border-current px-[5px] text-[10px] font-semibold ${LABEL_STATUS[node.health] ?? ''}`}>{healthLabel(node.health)}</span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
});


/** Hides labels that overlap a more important one, when the camera or the labels change (LabelLayer). */
function LabelDeclutter({ anchors, labels }: { anchors: readonly LabelAnchor[]; labels: LabelLayer }) {
  useFrame(({ camera, size }) => labels.update(camera, size, anchors));
  return null;
}

/**
 * Owns the camera: orbit (drag), pan (right-drag), zoom (wheel), fit, focus, dive-in, and per-scope
 * restore. Finite GSAP tweens, killed when the user grabs the controls or issues another command.
 */
function CameraRig({ scene, scopePath, policy, handleRef, memory }: GalaxySceneProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera, invalidate } = useThree();
  const tween = useRef<gsap.core.Timeline | null>(null);
  const previousPath = useRef<readonly string[] | null>(null);
  const extent = scene.extent;

  const pose = (): CameraPose => {
    const target = controls.current?.target ?? new THREE.Vector3();
    return { position: [camera.position.x, camera.position.y, camera.position.z], target: [target.x, target.y, target.z] };
  };

  const apply = (to: CameraPose, seconds: number, done?: () => void) => {
    tween.current?.kill();
    const target = controls.current?.target;
    if (!target || seconds <= 0) {
      camera.position.set(...to.position);
      target?.set(...to.target);
      controls.current?.update();
      invalidate();
      done?.();
      return;
    }
    const timeline = gsap.timeline({
      onUpdate: () => {
        controls.current?.update();
        invalidate();
      },
      onComplete: () => done?.(),
    });
    timeline.to(camera.position, { x: to.position[0], y: to.position[1], z: to.position[2], duration: seconds, ease: 'power2.inOut' }, 0);
    timeline.to(target, { x: to.target[0], y: to.target[1], z: to.target[2], duration: seconds, ease: 'power2.inOut' }, 0);
    tween.current = timeline;
  };

  useImperativeHandle(handleRef, () => ({
    fit: () => apply(fitPose(extent), policy.transitionSeconds * 0.8),
    focus: (id) => {
      const node = scene.nodes.find((n) => n.id === id);
      if (node) apply(focusPose(pose(), node.position, node.radius), policy.transitionSeconds);
    },
    zoom: (factor) => {
      const p = pose();
      const k = factor;
      apply(
        {
          target: p.target,
          position: [
            p.target[0] + (p.position[0] - p.target[0]) * k,
            p.target[1] + (p.position[1] - p.target[1]) * k,
            p.target[2] + (p.position[2] - p.target[2]) * k,
          ],
        },
        policy.transitionSeconds * 0.4,
      );
    },
    diveInto: (id, arrive) => {
      const node = scene.nodes.find((n) => n.id === id);
      if (!node) return arrive();
      apply(approachPose(pose(), node.position, node.radius), policy.transitionSeconds * 0.75, arrive);
    },
  }));

  // Scope changes: remember where we were; restore a remembered scope, or fly out of the portal.
  useLayoutEffect(() => {
    const previous = previousPath.current;
    previousPath.current = scopePath;
    if (previous && controls.current) memory.save(previous, pose());
    const entering = previous !== null && scopePath.length > previous.length;
    if (entering) memory.forgetBelow(previous);
    const remembered = entering ? undefined : memory.restore(scopePath);
    if (remembered) {
      apply(remembered, policy.transitionSeconds * 0.5);
      return;
    }
    const fit = fitPose(extent);
    if (entering && policy.transitionSeconds > 0) {
      // Start close to the center (just "through" the node) and pull back to show the interior.
      apply({ target: fit.target, position: [fit.position[0] * 0.15, fit.position[1] * 0.15, fit.position[2] * 0.15] }, 0);
      apply(fit, policy.transitionSeconds);
    } else {
      apply(fit, 0);
    }
    // Only scope identity matters here; extent/policy are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CameraMemory.key(scopePath)]);

  useEffect(() => () => void tween.current?.kill(), []);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={10}
      maxDistance={Math.max(4000, extent * 8)}
      onStart={() => tween.current?.kill()}
    />
  );
}
