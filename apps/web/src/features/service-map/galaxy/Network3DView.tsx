import { Canvas } from '@react-three/fiber';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useEventHighlight } from '../../event-catalog/useEventHighlight';
import { useTopology } from '../../../data/topologyContext';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { HIGHLIGHT_MODES, type HighlightMode } from '../../../domain/traversal';
import { EDGE_KINDS, EDGE_KIND_LABELS, healthLabel, typeLabel } from '../../../shared/mappings';
import { SimulatedTag } from '../../../shared/ui/DataSourceTag';
import { Icon } from '../../../shared/ui/Icon';
import { LoadState } from '../../../shared/ui/LoadState';
import { StatusShape } from '../../../shared/ui/StatusShape';
import { useUiStore } from '../../../state/uiStore';
import { useMotionReduced } from '../../../state/motion';
import { usePreferencesStore } from '../../../state/preferencesStore';
import { CameraMemory, fitPose } from './cameraMath';
import { GalaxyScene, type GalaxyHandle } from './GalaxyScene';
import { layoutGalaxy } from './layout3d';
import { readGalaxyColors, type GalaxyColors } from './palette';
import { buildScene, motionPolicy, type LabelMode, type SceneModel, type SceneNode } from './sceneModel';
import { canExplore, effectivePath, resolveGalaxyScope } from './scope';
import { detectWebGL, watchContextLoss } from './webgl';

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
      <div className="pointer-events-none absolute inset-0 grid place-items-center p-4 text-fg-2">
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
    <div className="pointer-events-none absolute inset-0 z-18 grid place-items-center p-4" role="alert">
      <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] pointer-events-auto relative max-w-[440px] px-6.5 py-5.5 text-center text-fg-2 [&_p]:m-0 [&_p]:mb-3.5`}>
        <h2 className="m-0 mb-1.5 text-lg font-semibold text-fg">{title}</h2>
        <p>{body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 font-semibold whitespace-nowrap text-on-accent hover:brightness-110 disabled:opacity-50" onClick={() => setActiveView('2d')}>
            Open the 2D map
          </button>
          <Link className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg no-underline hover:bg-surface-3" to={{ pathname: '/registry', search }}>
            Open the registry
          </Link>
          {onRetry && (
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg no-underline hover:bg-surface-3" onClick={onRetry}>
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

/** Theme colours from the tokens, re-read when the theme changes. */
function useGalaxyColors(theme: string): GalaxyColors {
  return useMemo(() => {
    void theme; // the tokens change with the theme attribute
    return readGalaxyColors();
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

  const [labelMode, setLabelMode] = useState<LabelMode>(() => usePreferencesStore.getState().preferences.galaxyLabels);
  const [particlesOn, setParticlesOn] = useState(() => usePreferencesStore.getState().preferences.galaxyTraffic);
  const [showContainment, setShowContainment] = useState(true);
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const reducedMotion = useMotionReduced();
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
  const eventReach = useEventHighlight(index)?.reach ?? null;
  const scene = useMemo(
    () => buildScene(index, model, layout, { selection, highlightMode, labelMode, eventReach }),
    [index, model, layout, selection, highlightMode, labelMode, eventReach],
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
    <div className="absolute inset-0">
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
          className="!absolute inset-0 touch-none"
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
        <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] top-3 left-1/2 z-16 flex -translate-x-1/2 items-center gap-2 py-1.5 pr-2 pl-3 text-sm`} role="group" aria-label="Selected entity">
          <span className="font-semibold whitespace-nowrap">
            {selectedNode ? selectedNode.name : selection.id}
            {!selectedNode && <span className="font-normal text-fg-3"> · not in this scope</span>}
          </span>
          {selectedNode && (
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg no-underline hover:bg-surface-3" onClick={() => handle.current?.focus(selectedNode.id)}>
              Focus
            </button>
          )}
          {explorable && (
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 font-semibold whitespace-nowrap text-on-accent hover:brightness-110 disabled:opacity-50" onClick={() => enter(explorable)}>
              Explore inside
            </button>
          )}
        </div>
      )}

      <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] bottom-3 left-3 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-0.5 p-[5px]`} role="toolbar" aria-label="3D controls">
        <button type="button" className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={() => handle.current?.zoom(1.35)} aria-label="Zoom out" title="Zoom out">
          <Icon name="minus" />
        </button>
        <button type="button" className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={() => handle.current?.zoom(0.7)} aria-label="Zoom in" title="Zoom in">
          <Icon name="plus" />
        </button>
        <button type="button" className="grid size-8.5 flex-none place-items-center rounded-md text-fg-2 hover:bg-surface-3 hover:text-fg" onClick={() => handle.current?.fit()} aria-label="Fit scope" title="Fit scope">
          <Icon name="fit" />
        </button>
        <span className="mx-[5px] h-5 w-px bg-line-strong" aria-hidden="true" />
        <span className="mx-1 text-[10px] tracking-[0.07em] text-fg-3 uppercase">Labels</span>
        <div className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]" role="group" aria-label="Labels">
          {LABEL_MODES.map((m) => (
            <button key={m.id} type="button" className="flex h-6.5 items-center gap-1.5 rounded-sm px-2.75 text-sm whitespace-nowrap text-fg-2 hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)] aria-pressed:[&_svg]:text-accent" aria-pressed={labelMode === m.id} onClick={() => setLabelMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]" role="group" aria-label="Highlight dependencies">
          {HIGHLIGHT_MODES.map((m: HighlightMode) => (
            <button key={m} type="button" className="flex h-6.5 items-center gap-1.5 rounded-sm px-2.75 text-sm whitespace-nowrap text-fg-2 hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)] aria-pressed:[&_svg]:text-accent" aria-pressed={highlightMode === m} onClick={() => setHighlightMode(m)}>
              {m === 'direct' ? 'Direct' : m === 'upstream' ? 'Upstream' : 'Downstream'}
            </button>
          ))}
        </div>
        <button type="button" className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50" aria-pressed={showContainment} onClick={() => setShowContainment((v) => !v)}>
          Containment
        </button>
        <button
          type="button"
          className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50"
          aria-pressed={particlesOn}
          onClick={() => setParticlesOn((v) => !v)}
          disabled={!hasTraffic}
          title={hasTraffic ? 'Moving dots follow relationship throughput (simulated)' : 'No throughput data in this scope'}
        >
          Simulated traffic
        </button>
        <button type="button" className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50" aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>
          {motionPaused ? 'Resume motion' : 'Pause motion'}
        </button>
      </div>

      <Legend reducedMotion={reducedMotion} particles={policy.particles} />
      <EntityList scene={scene} open={listOpen} onToggle={() => setListOpen((v) => !v)} onSelect={select} onEnter={enter} centerId={center?.id} index={index} />
      <p className="pointer-events-none absolute top-[58px] right-3.5 m-0 max-w-[44%] text-right text-xs text-fg-3 max-md:hidden" aria-hidden="true">
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
    <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] top-3 left-3 flex max-w-[min(640px,calc(100%-24px))] flex-col gap-1.5 px-2.5 py-2 text-sm`}>
      <nav aria-label="Exploration path" className="[&_li]:inline-flex [&_li]:items-center [&_li]:gap-0.5 [&_ol]:m-0 [&_ol]:flex [&_ol]:list-none [&_ol]:flex-wrap [&_ol]:items-center [&_ol]:gap-0.5 [&_ol]:p-0">
        <ol>
          <li>
            <button type="button" className="rounded-sm px-1.5 py-0.5 text-fg-2 hover:bg-surface-3 hover:text-fg aria-[current=location]:font-semibold aria-[current=location]:text-fg" aria-current={path.length === 0 ? 'location' : undefined} onClick={onOverview}>
              Galaxy overview
            </button>
          </li>
          {path.map((id, i) => (
            <li key={`${id}-${i}`}>
              <span aria-hidden="true" className="mx-0.5 text-fg-3">
                /
              </span>
              <button type="button" className="rounded-sm px-1.5 py-0.5 text-fg-2 hover:bg-surface-3 hover:text-fg aria-[current=location]:font-semibold aria-[current=location]:text-fg" aria-current={i === path.length - 1 ? 'location' : undefined} onClick={() => onCrumb(i + 1)}>
                {name(id)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {path.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg no-underline hover:bg-surface-3" onClick={onBack}>
            Back one level
          </button>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg no-underline hover:bg-surface-3" onClick={onOverview}>
            Return to overview
          </button>
        </div>
      )}
      {model.note && <p className="m-0 text-fg-2">{model.note}</p>}
    </div>
  );
}

function Legend({ reducedMotion, particles }: { reducedMotion: boolean; particles: boolean }) {
  return (
    <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] bottom-16 left-3 z-14 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-x-3.5 gap-y-1.5 px-3 py-[7px] text-[11.5px] text-fg-2 max-md:hidden`} aria-label="3D legend">
      <span className="mx-1 text-[10px] tracking-[0.07em] text-fg-3 uppercase">Paths (communication)</span>
      {EDGE_KINDS.filter((k) => k !== 'other').map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
            <path d="M2 5H22" stroke={`var(--edge-${kind})`} strokeWidth="1.6" strokeDasharray={{ http: 'none', grpc: '9 4', data: '1.5 5', event: '9 4' }[kind]} fill="none" />
            <path d="M28 5l-6 -3v6z" fill={`var(--edge-${kind})`} />
          </svg>
          {EDGE_KIND_LABELS[kind]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true">
          <path d="M2 5H28" stroke="var(--color-indigo)" strokeWidth="1.4" strokeDasharray="3 3" fill="none" />
        </svg>
        Containment (rings, spokes; no direction)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusShape health="degraded" /> one ring · <StatusShape health="unavailable" /> two rings
      </span>
      <span className="inline-flex items-center gap-1.5">
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
    <div className={`absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px] top-3 right-3 max-h-[calc(100%-140px)] max-w-[320px] overflow-auto p-1 text-sm max-md:top-auto max-md:bottom-16`}>
      <button type="button" className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50" aria-expanded={open} onClick={onToggle}>
        Entities in this scope ({scene.nodes.length})
      </button>
      {open && (
        <div className="px-1.5 pb-1.5 [&_li]:flex [&_li]:items-center [&_li]:gap-0.5 [&_ul]:m-0 [&_ul]:mb-2 [&_ul]:list-none [&_ul]:p-0">
          {ROLE_GROUPS.map((group) => {
            const nodes = scene.nodes.filter((n) => group.roles.includes(n.role));
            if (nodes.length === 0) return null;
            return (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mx-1 text-[10px] tracking-[0.07em] text-fg-3 uppercase">{group.title}</h3>
                <ul>
                  {nodes.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-[5px] text-left hover:bg-surface-3 aria-pressed:bg-surface-3"
                        aria-pressed={selection?.id === n.id}
                        onClick={() => n.ref && onSelect(n.ref)}
                        disabled={!n.ref}
                      >
                        <StatusShape health={n.health} />
                        <span className="min-w-0 truncate text-fg">{n.name}</span>
                        <span className="font-normal text-fg-3">
                          {n.memberCount > 1 ? `${n.memberCount} entities` : typeLabel(n.type)} · {healthLabel(n.health)}
                        </span>
                      </button>
                      {n.id !== centerId && canExplore(index, n.id) && (
                        <button type="button" className="h-7.5 rounded-md px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg disabled:opacity-50" onClick={() => onEnter(n.id)} aria-label={`Explore inside ${n.name}`}>
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
