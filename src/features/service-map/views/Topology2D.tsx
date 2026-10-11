import {
  applyNodeChanges,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTopology } from '../../../data/topologyContext';
import { buildRegistryRows, hasActiveFilters, inEnvironment } from '../../../domain/registry';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { HIGHLIGHT_MODES, type HighlightMode } from '../../../domain/traversal';
import { CONTAINMENT_ONLY_RESOURCE_TYPES } from '../../../domain/types';
import { EDGE_KINDS, EDGE_KIND_LABELS } from '../../../shared/mappings';
import { Icon } from '../../../shared/ui/Icon';
import { LoadState } from '../../../shared/ui/LoadState';
import { NEIGHBORHOOD_DEPTHS, useUiStore, type LayoutMode } from '../../../state/uiStore';
import { FilterBar } from '../../filters/FilterBar';
import {
  computeHighlight,
  refForEdge,
  reuseUnchanged,
  refForNode,
  toFlowEdges,
  toFlowNodes,
  type ManualPositions,
  type RelationshipFlowEdge,
  type TopologyFlowNode,
} from '../adapters/reactFlowAdapter';
import { toLayoutRequest } from '../graph/layoutRequest';
import { buildTopologyGraph, groupIdsAtDepth, type GraphGroup, type TopologyGraph } from '../graph/topologyGraph';
import type { LayoutResult } from '../layout/GraphLayoutService';
import { useLayoutService } from '../layout/layoutServiceContext';
import { EntityNode } from './flow/EntityNode';
import { GroupNode } from './flow/GroupNode';
import { MapActionsContext, type MapActions } from './flow/mapActions';
import { RelationshipEdge } from './flow/RelationshipEdge';
import { LayoutsMenu } from './LayoutsMenu';
import type { SavedLayout } from '../../../data/savedLayouts/savedLayout';
import styles from './topology2d.module.css';

/** Above this many visible nodes the map asks the user to narrow the view (ADR-005 target: 250). */
export const MAX_VISIBLE_NODES = 300;

const nodeTypes = { entity: EntityNode, group: GroupNode };
const edgeTypes = { relationship: RelationshipEdge };
const HIGHLIGHT_LABELS: Record<HighlightMode, { label: string; hint: string }> = {
  direct: { label: 'Direct', hint: 'Immediate relationships' },
  upstream: { label: 'Upstream', hint: 'Everything this depends on' },
  downstream: { label: 'Downstream', hint: 'Everything that depends on this' },
};

/** Ref that always holds the latest value (read inside async callbacks). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Topology2D() {
  const topology = useTopology();
  if (topology.status !== 'ready') {
    return (
      <div className={styles.centered}>
        <LoadState state={topology} />
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <TopologyCanvas index={topology.index} />
    </ReactFlowProvider>
  );
}

interface LaidOut {
  /** Structural key of the graph that was laid out (see layoutKey). */
  key: string;
  graph: TopologyGraph;
  result: LayoutResult;
}

function TopologyCanvas({ index }: { index: TopologyIndex }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const filters = useUiStore((s) => s.filters);
  const mode = useUiStore((s) => s.layoutMode);
  const neighborhood = useUiStore((s) => s.neighborhood);
  const selection = useUiStore((s) => s.selection);
  const highlightMode = useUiStore((s) => s.highlightMode);
  const select = useUiStore((s) => s.select);

  const layoutService = useLayoutService();
  const reactFlow = useReactFlow();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [manual, setManual] = useState<Record<LayoutMode, ManualPositions>>({ topology: {}, infrastructure: {} });
  const [renderAnyway, setRenderAnyway] = useState(false);
  const [laidOut, setLaidOut] = useState<LaidOut | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);

  const graph = useMemo(
    () =>
      buildTopologyGraph(index, {
        environmentId,
        filters,
        mode,
        collapsedGroupIds: collapsed,
        neighborhood: neighborhood ?? undefined,
      }),
    [index, environmentId, filters, mode, collapsed, neighborhood],
  );
  const tooMany = graph.nodes.length > MAX_VISIBLE_NODES && !renderAnyway;
  // Layout depends only on structure (nodes, groups, edges, sizes). Health/metric changes from the
  // simulation rebuild the graph but keep the key, so they never trigger a relayout.
  const layoutRequest = useMemo(() => toLayoutRequest(graph), [graph]);
  const layoutKey = useMemo(() => JSON.stringify(layoutRequest), [layoutRequest]);
  const latestGraph = useLatest(graph);

  // Layout runs off the render path; the previous layout stays on screen until the new one is ready.
  useEffect(() => {
    if (tooMany) return;
    const controller = new AbortController();
    const request = JSON.parse(layoutKey) as ReturnType<typeof toLayoutRequest>;
    const timer = window.setTimeout(() => {
      performance.mark('topology-layout-start');
      layoutService
        .layout(request, controller.signal)
        .then((result) => {
          performance.measure('topology-layout', 'topology-layout-start');
          setLayoutError(null);
          setLaidOut({ key: layoutKey, graph: latestGraph.current, result });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setLayoutError(error instanceof Error ? error.message : String(error));
        });
    }, 60);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [layoutKey, layoutService, tooMany, latestGraph]);

  // Current graph on the latest layout when the structure matches; otherwise keep showing the
  // previous graph+layout until the new layout arrives.
  const shown = useMemo<LaidOut | null>(() => {
    if (tooMany || !laidOut) return null;
    return laidOut.key === layoutKey ? { ...laidOut, graph } : laidOut;
  }, [tooMany, laidOut, layoutKey, graph]);
  const highlight = useMemo(
    () => (shown ? computeHighlight(index, shown.graph, selection, highlightMode) : null),
    [index, shown, selection, highlightMode],
  );
  const derivedNodes = useMemo(
    () => (shown && highlight ? toFlowNodes(shown.graph, shown.result, highlight, manual[mode]) : []),
    [shown, highlight, manual, mode],
  );
  const derivedEdges = useMemo(() => (shown && highlight ? toFlowEdges(shown.graph, highlight) : []), [shown, highlight]);

  // Controlled React Flow nodes: derived from canonical data, plus React Flow's own measurements and
  // in-progress drags. Re-derive during render when inputs change (no effect round-trip).
  const [nodes, setNodes] = useState<TopologyFlowNode[]>(derivedNodes);
  const [nodesSource, setNodesSource] = useState(derivedNodes);
  if (nodesSource !== derivedNodes) {
    const measured = new Map(nodes.map((n) => [n.id, n.measured]));
    setNodesSource(derivedNodes);
    const withMeasured = derivedNodes.map((n) => {
      const m = measured.get(n.id);
      return m ? { ...n, measured: m } : n;
    });
    setNodes(
      reuseUnchanged(
        nodes,
        withMeasured,
        (a, b) => a.position.x === b.position.x && a.position.y === b.position.y && a.parentId === b.parentId,
      ),
    );
  }
  const [edges, setEdges] = useState<RelationshipFlowEdge[]>(derivedEdges);
  const [edgesSource, setEdgesSource] = useState(derivedEdges);
  if (edgesSource !== derivedEdges) {
    setEdgesSource(derivedEdges);
    setEdges(reuseUnchanged(edges, derivedEdges, (a, b) => a.zIndex === b.zIndex));
  }

  const graphById = useMemo(() => new Map(shown?.graph.nodes.map((n) => [n.id, n]) ?? []), [shown]);
  const edgeById = useMemo(() => new Map(shown?.graph.edges.map((e) => [e.id, e]) ?? []), [shown]);

  const onNodesChange = useCallback(
    (changes: NodeChange<TopologyFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          const node = graphById.get(change.id);
          const ref = node ? refForNode(node) : null;
          if (ref) select(ref);
        }
        if (change.type === 'position' && change.position && change.dragging === false) {
          const { id, position } = change;
          setManual((prev) => ({ ...prev, [mode]: { ...prev[mode], [id]: position } }));
        }
      }
      // Selection is owned by the shared store; apply everything else (dimensions, drag positions).
      setNodes((current) => applyNodeChanges(changes.filter((c) => c.type !== 'select'), current));
    },
    [graphById, mode, select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationshipFlowEdge>[]) => {
      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          const edge = edgeById.get(change.id);
          const ref = edge ? refForEdge(edge) : null;
          if (ref) select(ref);
        }
      }
      // Edges are fully derived; React Flow only reports selection on them.
    },
    [edgeById, select],
  );

  // Fit the whole graph whenever a new layout lands (not on data-only updates).
  const shownKey = tooMany ? null : (laidOut?.key ?? null);
  useEffect(() => {
    if (!shownKey) return;
    const frame = requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.12, duration: prefersReducedMotion() ? 0 : 250 });
      performance.mark('topology-rendered');
    });
    return () => cancelAnimationFrame(frame);
  }, [shownKey, reactFlow]);

  // Bring an externally selected entity (registry, search, inspector) into view if it is off-screen.
  // Keyed on the selected element and layout, so simulation ticks do not re-run it.
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const [selectedElement] = highlight?.selectedIds ?? [];
  const layoutResult = shown?.result;
  useEffect(() => {
    if (!layoutResult || !selectedElement) return;
    const id = selectedElement;
    const box = layoutResult.nodes[id] ?? layoutResult.groups[id];
    if (!box) return;
    const { x, y, zoom } = reactFlow.getViewport();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const sx = cx * zoom + x;
    const sy = cy * zoom + y;
    if (width > 0 && height > 0 && (sx < 0 || sy < 0 || sx > width || sy > height)) {
      void reactFlow.setCenter(cx, cy, { zoom: Math.max(zoom, 0.8), duration: prefersReducedMotion() ? 0 : 300 });
    }
  }, [layoutResult, selectedElement, reactFlow, width, height]);

  const actions = useMemo<MapActions>(
    () => ({
      toggleGroup: (groupId) =>
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(groupId)) next.delete(groupId);
          else next.add(groupId);
          return next;
        }),
      selectGroup: (group: GraphGroup) => {
        if (group.ref) select(group.ref);
      },
    }),
    [select],
  );

  return (
    <MapActionsContext.Provider value={actions}>
      {/* `topology-dim-others` dims every element that is neither selected nor highlighted (flow.module.css). */}
      <div className={`${styles.canvas} ${highlight?.active ? 'topology-dim-others' : ''}`}>
        <ReactFlow<TopologyFlowNode, RelationshipFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onPaneClick={() => select(null)}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }}
          nodesConnectable={false}
          elementsSelectable
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          deleteKeyCode={null}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          aria-label="Service topology"
        >
          <MiniMap
            pannable
            zoomable
            ariaLabel="Topology overview"
            className={styles.minimap}
            nodeClassName={(n) => (n.type === 'group' ? styles.miniGroup ?? '' : styles.miniNode ?? '')}
          />
        </ReactFlow>

        <ScopeBar
          index={index}
          graph={graph}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
        />
        {filtersOpen && <MapFilters index={index} onClose={() => setFiltersOpen(false)} />}
        <HiddenSelectionNotice index={index} graph={graph} />
        {layoutsOpen && (
          <LayoutsMenu
            collapsedGroupIds={collapsed}
            currentPositions={() =>
              Object.fromEntries(
                nodes.filter((n) => n.type === 'entity').map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]),
              )
            }
            onApply={(layout: SavedLayout) => {
              useUiStore.setState({
                environmentId: layout.view.environmentId,
                layoutMode: layout.view.layoutMode,
                filters: layout.view.filters,
              });
              setCollapsed(new Set(layout.view.collapsedGroupIds));
              setManual((prev) => ({ ...prev, [layout.view.layoutMode]: layout.positions }));
            }}
            onClose={() => setLayoutsOpen(false)}
          />
        )}
        <CanvasControls
          layoutsOpen={layoutsOpen}
          onToggleLayouts={() => setLayoutsOpen((open) => !open)}
          onResetLayout={() => setManual((prev) => ({ ...prev, [mode]: {} }))}
          hasManualPositions={Object.keys(manual[mode]).length > 0}
          collapsedCount={collapsed.size}
          onExpandAll={() => setCollapsed(new Set())}
        />
        <Legend />

        {tooMany && (
          <Overlay title={`${graph.nodes.length} entities match`}>
            <p>
              That is more than the {MAX_VISIBLE_NODES}-node limit for full detail. Narrow the view with search or filters,
              explore a neighborhood from the registry or inspector, or group by infrastructure.
            </p>
            <div className={styles.overlayActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  const grouped = buildTopologyGraph(index, { environmentId, filters, mode: 'infrastructure' });
                  setCollapsed(new Set(groupIdsAtDepth(grouped, 0)));
                  useUiStore.getState().setLayoutMode('infrastructure');
                }}
              >
                Group by provider (collapsed)
              </button>
              <button type="button" className={styles.secondary} onClick={() => setRenderAnyway(true)}>
                Render all anyway
              </button>
            </div>
          </Overlay>
        )}
        {!tooMany && graph.nodes.length === 0 && <EmptyGraph index={index} graph={graph} />}
        {!tooMany && graph.nodes.length > 0 && !shown && !layoutError && (
          <div className={styles.centered} role="status">
            Laying out {graph.nodes.length} nodes…
          </div>
        )}
        {layoutError && (
          <Overlay title="Layout failed">
            <p className="mono">{layoutError}</p>
          </Overlay>
        )}
      </div>
    </MapActionsContext.Provider>
  );
}

function ScopeBar({
  index,
  graph,
  filtersOpen,
  onToggleFilters,
}: {
  index: TopologyIndex;
  graph: TopologyGraph;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}) {
  const environmentId = useUiStore((s) => s.environmentId);
  const filters = useUiStore((s) => s.filters);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const neighborhood = useUiStore((s) => s.neighborhood);
  const setNeighborhood = useUiStore((s) => s.setNeighborhood);
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const activeFilterCount =
    (filters.query.trim() ? 1 : 0) + filters.providers.length + filters.health.length + filters.groups.length;

  return (
    <div className={`${styles.float} ${styles.scopeBar}`}>
      <span className="mono" aria-live="polite">
        {environmentName} · {graph.nodes.length} nodes · {graph.edges.length} connections
      </span>
      <button type="button" className={styles.chip} aria-expanded={filtersOpen} onClick={onToggleFilters}>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>
      {hasActiveFilters(filters) && (
        <button type="button" className={`${styles.chip} ${styles.chipOn}`} onClick={resetFilters}>
          Clear filters
        </button>
      )}
      {neighborhood && (
        <span className={styles.neighborhood} role="group" aria-label="Neighborhood">
          <span>
            Neighborhood of <b>{neighborhoodName(index, neighborhood.centerId)}</b>
          </span>
          {NEIGHBORHOOD_DEPTHS.map((depth) => (
            <button
              key={depth}
              type="button"
              className={styles.depth}
              aria-pressed={neighborhood.depth === depth}
              aria-label={`${depth} ${depth === 1 ? 'hop' : 'hops'}`}
              onClick={() => setNeighborhood({ ...neighborhood, depth })}
            >
              {depth}
            </button>
          ))}
          <button type="button" className={styles.chip} onClick={() => setNeighborhood(null)}>
            Show all
          </button>
        </span>
      )}
    </div>
  );
}

function neighborhoodName(index: TopologyIndex, id: string): string {
  const instance = index.instances.get(id);
  if (instance) return index.definitions.get(instance.serviceDefinitionId)?.name ?? id;
  return index.resources.get(id)?.name ?? id;
}

function MapFilters({ index, onClose }: { index: TopologyIndex; onClose: () => void }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const rows = useMemo(
    () => buildRegistryRows(index).filter((row) => inEnvironment(row, environmentId)),
    [index, environmentId],
  );
  return (
    <div className={`${styles.float} ${styles.filterPanel}`} role="dialog" aria-label="Map filters">
      <FilterBar rows={rows} label="Filter map" />
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close filters">
        <Icon name="close" />
      </button>
    </div>
  );
}

function CanvasControls({
  layoutsOpen,
  onToggleLayouts,
  onResetLayout,
  hasManualPositions,
  collapsedCount,
  onExpandAll,
}: {
  layoutsOpen: boolean;
  onToggleLayouts: () => void;
  onResetLayout: () => void;
  hasManualPositions: boolean;
  collapsedCount: number;
  onExpandAll: () => void;
}) {
  const reactFlow = useReactFlow();
  const highlightMode = useUiStore((s) => s.highlightMode);
  const setHighlightMode = useUiStore((s) => s.setHighlightMode);
  const duration = prefersReducedMotion() ? 0 : 200;
  return (
    <div className={`${styles.float} ${styles.controls}`} role="toolbar" aria-label="Canvas controls">
      <button type="button" className={styles.iconButton} onClick={() => void reactFlow.zoomOut({ duration })} aria-label="Zoom out" title="Zoom out">
        <Icon name="minus" />
      </button>
      <button type="button" className={styles.iconButton} onClick={() => void reactFlow.zoomIn({ duration })} aria-label="Zoom in" title="Zoom in">
        <Icon name="plus" />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        onClick={() => void reactFlow.fitView({ padding: 0.12, duration })}
        aria-label="Fit to screen"
        title="Fit to screen"
      >
        <Icon name="fit" />
      </button>
      <button type="button" className={styles.textButton} aria-expanded={layoutsOpen} onClick={onToggleLayouts}>
        Layouts
      </button>
      {hasManualPositions && (
        <button type="button" className={styles.textButton} onClick={onResetLayout}>
          Reset positions
        </button>
      )}
      {collapsedCount > 0 && (
        <button type="button" className={styles.textButton} onClick={onExpandAll}>
          Expand all
        </button>
      )}
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.k} aria-hidden="true">
        Highlight
      </span>
      <div className={styles.segmented} role="group" aria-label="Highlight dependencies">
        {HIGHLIGHT_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={styles.segment}
            aria-pressed={highlightMode === m}
            title={HIGHLIGHT_LABELS[m].hint}
            onClick={() => setHighlightMode(m)}
          >
            {HIGHLIGHT_LABELS[m].label}
          </button>
        ))}
      </div>
    </div>
  );
}

const DASH: Record<string, string> = { http: 'none', grpc: '9 4', data: '1.5 5', event: '9 4 2 4', other: '2 3' };

function Legend() {
  return (
    <div className={`${styles.float} ${styles.legend}`} aria-label="Connection types">
      <span className={styles.k}>Connections</span>
      {EDGE_KINDS.filter((k) => k !== 'other').map((kind) => (
        <span key={kind} className={styles.legendItem}>
          <svg width="36" height="12" viewBox="0 0 36 12" aria-hidden="true">
            <path d="M2 6H28" stroke={`var(--edge-${kind})`} strokeWidth="1.6" strokeDasharray={DASH[kind]} fill="none" />
            <path d="M34 6l-6 -3v6z" fill={`var(--edge-${kind})`} />
          </svg>
          {EDGE_KIND_LABELS[kind]}
        </span>
      ))}
    </div>
  );
}

function Overlay({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.overlay}>
      <div className={`${styles.float} ${styles.overlayCard}`} role="status">
        <h2 className={styles.overlayTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function EmptyGraph({ index, graph }: { index: TopologyIndex; graph: TopologyGraph }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const neighborhood = useUiStore((s) => s.neighborhood);
  const setNeighborhood = useUiStore((s) => s.setNeighborhood);
  const name = index.environments.get(environmentId)?.name ?? environmentId;
  if (graph.environmentEntityCount === 0) {
    return (
      <Overlay title={`No entities in ${name}`}>
        <p>The repository has no services or connected resources for this environment.</p>
      </Overlay>
    );
  }
  return (
    <Overlay title="No matches">
      <p>Nothing in {name} matches the current search, filters{neighborhood ? ', and neighborhood' : ''}.</p>
      <div className={styles.overlayActions}>
        <button type="button" className={styles.secondary} onClick={resetFilters}>
          Clear filters
        </button>
        {neighborhood && (
          <button type="button" className={styles.secondary} onClick={() => setNeighborhood(null)}>
            Show all
          </button>
        )}
      </div>
    </Overlay>
  );
}

/** The selection exists but the map cannot show it: say so instead of silently desynchronizing. */
function HiddenSelectionNotice({ index, graph }: { index: TopologyIndex; graph: TopologyGraph }) {
  const selection = useUiStore((s) => s.selection);
  const environmentId = useUiStore((s) => s.environmentId);
  const mode = useUiStore((s) => s.layoutMode);
  if (!selection) return null;
  const { kind, id } = selection;
  if (kind === 'relationship') {
    if (!index.relationships.has(id) || graph.edges.some((e) => e.relationshipIds.includes(id))) return null;
  } else if (kind === 'service-instance' || kind === 'resource') {
    const resource = index.resources.get(id);
    if (!index.instances.has(id) && !resource) return null;
    if (graph.nodes.some((n) => n.memberIds.includes(id) || n.id === id) || graph.groups.some((g) => g.id === id)) return null;
    // Containment levels only appear as groups in infrastructure mode; that is not "hidden".
    if (resource && CONTAINMENT_ONLY_RESOURCE_TYPES.has(resource.type) && mode === 'topology') return null;
  } else {
    return null;
  }
  return <HiddenNotice index={index} environmentId={environmentId} />;
}

function HiddenNotice({ index, environmentId }: { index: TopologyIndex; environmentId: string }) {
  const selection = useUiStore((s) => s.selection);
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const setNeighborhood = useUiStore((s) => s.setNeighborhood);
  if (!selection) return null;
  const id = selection.kind === 'relationship' ? index.relationships.get(selection.id)?.sourceEntityId : selection.id;
  const instanceEnv = id ? index.instances.get(id)?.environmentId : undefined;
  const otherEnvironment = instanceEnv && instanceEnv !== environmentId ? instanceEnv : undefined;
  return (
    <div className={`${styles.float} ${styles.notice}`} role="status">
      <span>The selected entity is not on the map with the current {otherEnvironment ? 'environment' : 'filters or neighborhood'}.</span>
      <button
        type="button"
        className={styles.chip}
        onClick={() => {
          if (otherEnvironment) setEnvironmentId(otherEnvironment);
          resetFilters();
          setNeighborhood(null);
        }}
      >
        Show it
      </button>
    </div>
  );
}
