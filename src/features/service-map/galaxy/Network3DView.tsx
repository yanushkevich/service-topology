import { Canvas } from '@react-three/fiber';
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useTopology } from '../../../data/topologyContext';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { HIGHLIGHT_MODES, type HighlightMode } from '../../../domain/traversal';
import { EDGE_KINDS, EDGE_KIND_LABELS, healthLabel, typeLabel } from '../../../shared/mappings';
import { SimulatedTag } from '../../../shared/ui/DataSourceTag';
import { Icon } from '../../../shared/ui/Icon';
import { LoadState } from '../../../shared/ui/LoadState';
import { StatusShape } from '../../../shared/ui/StatusShape';
import { useUiStore } from '../../../state/uiStore';
import mapStyles from '../views/topology2d.module.css';
import { CameraMemory, fitPose } from './cameraMath';
import { GalaxyScene, type GalaxyColors, type GalaxyHandle } from './GalaxyScene';
import { layoutGalaxy } from './layout3d';
import { buildScene, motionPolicy, type LabelMode, type SceneModel, type SceneNode } from './sceneModel';
import { canExplore, effectivePath, resolveGalaxyScope } from './scope';
import { detectWebGL, watchContextLoss } from './webgl';
import styles from './galaxy.module.css';

/**
 * Lazy-loaded 3D boundary (spec §11 `Network3DView`): loading, WebGL detection, context-loss and
 * error fallbacks, plus the DOM overlay (scope navigation, controls, legend, accessible entity list).
 * The 2D map and registry never depend on anything here.
 */
export function Network3DView() {
  const topology = useTopology();
  const [webgl] = useState(() => detectWebGL());
  if (topology.status !== 'ready') {
    return (
      <div className={mapStyles.centered}>
        <LoadState state={topology} />
      </div>
    );
  }
  if (!webgl) return <Fallback title="3D needs WebGL" body="This browser or device cannot create a WebGL context, so the 3D galaxy is unavailable. Everything it shows is also in the 2D map and the registry." />;
  return (
    <GalaxyErrorBoundary>
      <GalaxyExperience index={topology.index} />
    </GalaxyErrorBoundary>
  );
}

function Fallback({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  const { search } = useLocation();
  const setActiveView = useUiStore((s) => s.setActiveView);
  return (
    <div className={mapStyles.overlay} role="alert">
      <div className={`${mapStyles.float} ${mapStyles.overlayCard}`}>
        <h2 className={mapStyles.overlayTitle}>{title}</h2>
        <p>{body}</p>
        <div className={mapStyles.overlayActions}>
          <button type="button" className={mapStyles.primary} onClick={() => setActiveView('2d')}>
            Open the 2D map
          </button>
          <Link className={mapStyles.secondary} to={{ pathname: '/registry', search }}>
            Open the registry
          </Link>
          {onRetry && (
            <button type="button" className={mapStyles.secondary} onClick={onRetry}>
              Try 3D again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

class GalaxyErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    if (this.state.error) {
      return <Fallback title="The 3D view stopped" body={`The 2D map and registry are unaffected. (${this.state.error})`} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(reducedMotionQuery);
      query?.addEventListener?.('change', notify);
      return () => query?.removeEventListener?.('change', notify);
    },
    () => Boolean(window.matchMedia?.(reducedMotionQuery).matches),
  );
}

/** Theme colors from CSS tokens so the scene follows light/dark like the rest of the UI. */
function useGalaxyColors(theme: string): GalaxyColors {
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    void theme;
    return {
      background: v('--color-stage', '#070a13'),
      accent: v('--color-accent', '#5fe1ff'),
      ok: v('--color-ok', '#3dd6b0'),
      warn: v('--color-warn', '#f5b454'),
      crit: v('--color-crit', '#ff7b7b'),
      text3: v('--color-text-3', '#7f8cab'),
      edge: {
        http: v('--edge-http', '#a9c8ff'),
        grpc: v('--edge-grpc', '#5fe1ff'),
        data: v('--edge-data', '#b79cff'),
        event: v('--edge-event', '#8ef0c0'),
        other: v('--color-text-3', '#7f8cab'),
      },
    };
  }, [theme]);
}

const LABEL_MODES: { id: LabelMode; label: string }[] = [
  { id: 'minimal', label: 'Few' },
  { id: 'auto', label: 'Auto' },
  { id: 'all', label: 'All' },
];

function GalaxyExperience({ index }: { index: TopologyIndex }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const filters = useUiStore((s) => s.filters);
  const neighborhood = useUiStore((s) => s.neighborhood);
  const selection = useUiStore((s) => s.selection);
  const highlightMode = useUiStore((s) => s.highlightMode);
  const scopePath = useUiStore((s) => s.galaxyScope);
  const motionPaused = useUiStore((s) => s.motionPaused);
  const theme = useUiStore((s) => s.theme);
  const { select, enterScope, exitScopeTo, setMotionPaused, setHighlightMode } = useUiStore.getState();

  const [labelMode, setLabelMode] = useState<LabelMode>('auto');
  const [particlesOn, setParticlesOn] = useState(true);
  const [showContainment, setShowContainment] = useState(true);
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const colors = useGalaxyColors(theme);
  const handle = useRef<GalaxyHandle>(null);
  const [memory] = useState(() => new CameraMemory());
  const stopWatching = useRef<() => void>(() => {});
  useEffect(() => () => stopWatching.current(), []);

  const path = useMemo(() => effectivePath(index, scopePath), [index, scopePath]);
  // Unknown IDs (stale deep link, other dataset) are dropped from the shared path, visibly.
  useEffect(() => {
    if (path.length !== scopePath.length) exitScopeTo(path.length);
  }, [path.length, scopePath.length, exitScopeTo]);

  const model = useMemo(
    () => resolveGalaxyScope(index, { environmentId, filters, path, neighborhood }),
    [index, environmentId, filters, path, neighborhood],
  );
  const layout = useMemo(() => layoutGalaxy(model), [model]);
  const scene = useMemo(
    () => buildScene(index, model, layout, { selection, highlightMode, labelMode }),
    [index, model, layout, selection, highlightMode, labelMode],
  );
  const policy = motionPolicy({ reducedMotion, paused: motionPaused, particlesEnabled: particlesOn });

  const selectedNode = selection ? scene.nodes.find((n) => n.id === selection.id) : undefined;
  const center = scene.nodes.find((n) => n.role === 'center');
  const explorable = selection && canExplore(index, selection.id) && selection.id !== center?.id ? selection.id : null;

  const enter = (id: string) => {
    if (id === center?.id || !canExplore(index, id)) return;
    const go = () => enterScope(id);
    if (handle.current && scene.nodes.some((n) => n.id === id)) handle.current.diveInto(id, go);
    else go();
  };

  // A selection made elsewhere (registry, 2D, inspector, entity list) is brought into focus.
  const lastFocused = useRef<string | null>(null);
  const selectedInScene = selectedNode?.id ?? null;
  useEffect(() => {
    if (selectedInScene && selectedInScene !== lastFocused.current) handle.current?.focus(selectedInScene);
    lastFocused.current = selectedInScene;
  }, [selectedInScene]);

  const initialPose = useMemo(() => fitPose(scene.extent), [scene.extent]);
  const hasTraffic = scene.edges.some((e) => e.trafficRate !== null);

  return (
    <div className={styles.galaxy}>
      {contextLost ? (
        <Fallback
          title="The 3D view lost its graphics context"
          body="The GPU context was lost (for example after a driver reset or too many 3D tabs). Nothing else is affected."
          onRetry={() => {
            setContextLost(false);
            setCanvasKey((k) => k + 1);
          }}
        />
      ) : (
        <Canvas
          key={canvasKey}
          className={styles.canvas}
          dpr={[1, 1.75]}
          frameloop={policy.particles ? 'always' : 'demand'}
          camera={{ fov: 50, near: 1, far: 30000, position: initialPose.position as [number, number, number] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            stopWatching.current();
            stopWatching.current = watchContextLoss(gl.domElement, () => setContextLost(true), () => undefined);
          }}
          onPointerMissed={() => select(null)}
          aria-label={`3D galaxy: ${model.title}. Use the entity list for keyboard access.`}
          role="img"
        >
          <GalaxyScene
            scene={scene}
            scopePath={path}
            policy={policy}
            showContainment={showContainment}
            colors={colors}
            onSelect={(ref) => {
              lastFocused.current = ref.id;
              select(ref);
            }}
            onEnter={enter}
            handleRef={handle}
            memory={memory}
          />
        </Canvas>
      )}

      <ScopeBar index={index} model={{ title: model.title, note: model.note, kind: model.kind }} path={path} onBack={() => exitScopeTo(path.length - 1)} onOverview={() => exitScopeTo(0)} onCrumb={exitScopeTo} />

      {selection && (
        <div className={`${mapStyles.float} ${styles.selectionBar}`} role="group" aria-label="Selected entity">
          <span className={styles.selectionName}>
            {selectedNode ? selectedNode.name : selection.id}
            {!selectedNode && <span className={styles.muted}> · not in this scope</span>}
          </span>
          {selectedNode && (
            <button type="button" className={mapStyles.secondary} onClick={() => handle.current?.focus(selectedNode.id)}>
              Focus
            </button>
          )}
          {explorable && (
            <button type="button" className={mapStyles.primary} onClick={() => enter(explorable)}>
              Explore inside
            </button>
          )}
        </div>
      )}

      <div className={`${mapStyles.float} ${mapStyles.controls}`} role="toolbar" aria-label="3D controls">
        <button type="button" className={mapStyles.iconButton} onClick={() => handle.current?.zoom(1.35)} aria-label="Zoom out" title="Zoom out">
          <Icon name="minus" />
        </button>
        <button type="button" className={mapStyles.iconButton} onClick={() => handle.current?.zoom(0.7)} aria-label="Zoom in" title="Zoom in">
          <Icon name="plus" />
        </button>
        <button type="button" className={mapStyles.iconButton} onClick={() => handle.current?.fit()} aria-label="Fit scope" title="Fit scope">
          <Icon name="fit" />
        </button>
        <span className={mapStyles.divider} aria-hidden="true" />
        <span className={mapStyles.k}>Labels</span>
        <div className={mapStyles.segmented} role="group" aria-label="Labels">
          {LABEL_MODES.map((m) => (
            <button key={m.id} type="button" className={mapStyles.segment} aria-pressed={labelMode === m.id} onClick={() => setLabelMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className={mapStyles.segmented} role="group" aria-label="Highlight dependencies">
          {HIGHLIGHT_MODES.map((m: HighlightMode) => (
            <button key={m} type="button" className={mapStyles.segment} aria-pressed={highlightMode === m} onClick={() => setHighlightMode(m)}>
              {m === 'direct' ? 'Direct' : m === 'upstream' ? 'Upstream' : 'Downstream'}
            </button>
          ))}
        </div>
        <button type="button" className={mapStyles.textButton} aria-pressed={showContainment} onClick={() => setShowContainment((v) => !v)}>
          Containment
        </button>
        <button
          type="button"
          className={mapStyles.textButton}
          aria-pressed={particlesOn}
          onClick={() => setParticlesOn((v) => !v)}
          disabled={!hasTraffic}
          title={hasTraffic ? 'Moving dots follow relationship throughput (simulated)' : 'No throughput data in this scope'}
        >
          Simulated traffic
        </button>
        <button type="button" className={mapStyles.textButton} aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>
          {motionPaused ? 'Resume motion' : 'Pause motion'}
        </button>
      </div>

      <Legend reducedMotion={reducedMotion} particles={policy.particles} />
      <EntityList scene={scene} open={listOpen} onToggle={() => setListOpen((v) => !v)} onSelect={select} onEnter={enter} centerId={center?.id} index={index} />
      <p className={styles.hint} aria-hidden="true">
        Drag to rotate · Right-drag to pan · Scroll to zoom · Double-click or “Explore inside” to enter
      </p>
    </div>
  );
}

function ScopeBar({
  index,
  model,
  path,
  onBack,
  onOverview,
  onCrumb,
}: {
  index: TopologyIndex;
  model: { title: string; note: string | undefined; kind: string };
  path: readonly string[];
  onBack: () => void;
  onOverview: () => void;
  onCrumb: (depth: number) => void;
}) {
  const name = (id: string) => {
    const instance = index.instances.get(id);
    if (instance) return `${index.definitions.get(instance.serviceDefinitionId)?.name ?? id} (${instance.environmentId})`;
    return index.resources.get(id)?.name ?? index.definitions.get(id)?.name ?? id;
  };
  return (
    <div className={`${mapStyles.float} ${styles.scopeBar}`}>
      <nav aria-label="Exploration path" className={styles.crumbs}>
        <ol>
          <li>
            <button type="button" className={styles.crumb} aria-current={path.length === 0 ? 'location' : undefined} onClick={onOverview}>
              Galaxy overview
            </button>
          </li>
          {path.map((id, i) => (
            <li key={`${id}-${i}`}>
              <span aria-hidden="true" className={styles.crumbSep}>
                /
              </span>
              <button type="button" className={styles.crumb} aria-current={i === path.length - 1 ? 'location' : undefined} onClick={() => onCrumb(i + 1)}>
                {name(id)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {path.length > 0 && (
        <div className={styles.scopeActions}>
          <button type="button" className={mapStyles.secondary} onClick={onBack}>
            Back one level
          </button>
          <button type="button" className={mapStyles.secondary} onClick={onOverview}>
            Return to overview
          </button>
        </div>
      )}
      {model.note && <p className={styles.note}>{model.note}</p>}
    </div>
  );
}

function Legend({ reducedMotion, particles }: { reducedMotion: boolean; particles: boolean }) {
  return (
    <div className={`${mapStyles.float} ${styles.legend}`} aria-label="3D legend">
      <span className={mapStyles.k}>Paths (communication)</span>
      {EDGE_KINDS.filter((k) => k !== 'other').map((kind) => (
        <span key={kind} className={mapStyles.legendItem}>
          <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
            <path d="M2 5H22" stroke={`var(--edge-${kind})`} strokeWidth="1.6" strokeDasharray={{ http: 'none', grpc: '9 4', data: '1.5 5', event: '9 4' }[kind]} fill="none" />
            <path d="M28 5l-6 -3v6z" fill={`var(--edge-${kind})`} />
          </svg>
          {EDGE_KIND_LABELS[kind]}
        </span>
      ))}
      <span className={mapStyles.legendItem}>
        <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
          <path d="M2 5H28" stroke="var(--color-indigo)" strokeWidth="1.4" strokeDasharray="3 3" fill="none" />
        </svg>
        Containment (rings, spokes; no direction)
      </span>
      <span className={mapStyles.legendItem}>
        <StatusShape health="degraded" /> one ring · <StatusShape health="unavailable" /> two rings
      </span>
      <span className={mapStyles.legendItem}>
        <SimulatedTag simulated />
        {reducedMotion ? 'Reduced motion: no moving dots; arrows show direction' : particles ? 'Moving dots = simulated throughput' : 'Traffic dots off'}
      </span>
    </div>
  );
}

const ROLE_GROUPS: { title: string; roles: SceneNode['role'][] }[] = [
  { title: 'Current scope', roles: ['center'] },
  { title: 'Constellations', roles: ['core'] },
  { title: 'Inside', roles: ['child', 'grandchild', 'member'] },
  { title: 'Outside: sends into this scope', roles: ['inbound'] },
  { title: 'Outside: receives from this scope', roles: ['outbound'] },
];

/** Keyboard/screen-reader alternative to picking in 3D (spec §5). */
function EntityList({
  scene,
  open,
  onToggle,
  onSelect,
  onEnter,
  centerId,
  index,
}: {
  scene: SceneModel;
  open: boolean;
  onToggle: () => void;
  onSelect: (ref: NonNullable<SceneNode['ref']>) => void;
  onEnter: (id: string) => void;
  centerId: string | undefined;
  index: TopologyIndex;
}) {
  const selection = useUiStore((s) => s.selection);
  return (
    <div className={`${mapStyles.float} ${styles.entityList}`}>
      <button type="button" className={mapStyles.textButton} aria-expanded={open} onClick={onToggle}>
        Entities in this scope ({scene.nodes.length})
      </button>
      {open && (
        <div className={styles.entityGroups}>
          {ROLE_GROUPS.map((group) => {
            const nodes = scene.nodes.filter((n) => group.roles.includes(n.role));
            if (nodes.length === 0) return null;
            return (
              <section key={group.title} aria-label={group.title}>
                <h3 className={mapStyles.k}>{group.title}</h3>
                <ul>
                  {nodes.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={styles.entityButton}
                        aria-pressed={selection?.id === n.id}
                        onClick={() => n.ref && onSelect(n.ref)}
                        disabled={!n.ref}
                      >
                        <StatusShape health={n.health} />
                        <span className={styles.entityName}>{n.name}</span>
                        <span className={styles.muted}>
                          {n.memberCount > 1 ? `${n.memberCount} entities` : typeLabel(n.type)} · {healthLabel(n.health)}
                        </span>
                      </button>
                      {n.id !== centerId && canExplore(index, n.id) && (
                        <button type="button" className={mapStyles.textButton} onClick={() => onEnter(n.id)} aria-label={`Explore inside ${n.name}`}>
                          Explore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
