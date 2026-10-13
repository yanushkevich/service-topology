import { MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { BusinessFlow } from '../../domain/types';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import { activeTxSteps, type FlowTransaction } from '../../transit/flows/observed';
import type { SwimlaneLayout } from '../../transit/flows/swimlane';
import { isMotionReduced } from '../../state/motion';
import { Icon } from '../../shared/ui/Icon';
import { buttonClass, cx, floatClass } from '../../shared/ui/classes';
import { usePlayback, type Playback } from '../boards/playback';
import { flowColor } from './flowVisuals';
import { applyView, swimlaneElements, type RoutedEdge, type StoreRef, type SwimlaneNode, type SwimlaneView } from './swimlaneAdapter';
import { LaneCaptions, LaneView, OutcomeView, RoutedEdgeView, StepView } from './SwimlaneParts';

const nodeTypes = { lane: LaneView, step: StepView, outcome: OutcomeView };
/** Below this zoom, step names are hard to read: the flow opens at it and pans instead of shrinking. */
const READABLE_ZOOM = 0.72;
const edgeTypes = { routed: RoutedEdgeView };

export interface SwimlaneReplay {
  tx: FlowTransaction;
  playback: Playback;
  divergence: { stepIndex: number } | null;
}

/**
 * The flow board's map (ADR-023): one flow as swimlanes on React Flow. Positions come from the
 * layout and never change; selection, search, findings focus, and replay only change data. The
 * page scrolls with the wheel; zoom with the controls or a pinch. Steps take focus, and Enter or
 * Space selects one. The step strip is the accessible equivalent.
 */
export function FlowSwimlane(props: {
  fx: FlowBoardIndex;
  flow: BusinessFlow;
  layout: SwimlaneLayout;
  serviceName: (id: string) => string;
  eventName: (id: string) => string;
  shares: ReadonlyMap<string, number>;
  /** Data stores of a service in the environment (ADR-027). */
  storesOf: (serviceDefinitionId: string) => StoreRef[];
  view: Omit<SwimlaneView, 'replay'>;
  replay: SwimlaneReplay | null;
  playback: Playback;
  onSelectStep: (stepId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ fx, flow, layout, serviceName, eventName, shares, storesOf, view, replay, playback, onSelectStep }: Parameters<typeof FlowSwimlane>[0]) {
  const base = useMemo(() => swimlaneElements(layout, flow, { fx, color: flowColor(fx, flow.id), serviceName, eventName, shares, storesOf }), [layout, flow, fx, serviceName, eventName, shares, storesOf]);
  // The replay cursor, read here so the page does not re-render on every tick.
  const cursor = usePlayback(playback, (s) => (replay ? `${s.step}|${activeTxSteps(replay.tx.steps, s.t, s.step).map((x) => replay.tx.steps.indexOf(x)).join(',')}` : ''));
  const replayState = useMemo(() => replayView(replay, cursor), [replay, cursor]);
  const elements = useMemo(() => applyView(base, { ...view, replay: replayState }), [base, view, replayState]);
  const steps = new Set(flow.steps.map((s) => s.id));
  const box = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState({ zoom: READABLE_ZOOM, fitsWidth: false, ready: false });
  // Keep the replay's step, else the selected step, in view.
  useFollow(layout, opened.ready ? (replayState?.active[0]?.stepId ?? view.selectedStepId) : null, box);
  // Fit the width when that stays readable; otherwise open at a readable zoom at the flow's start.
  const openAtStart = (instance: ReactFlowInstance<SwimlaneNode, RoutedEdge>) => {
    const width = box.current?.clientWidth ?? 0;
    const z = Math.min(1, Math.max(READABLE_ZOOM, width / layout.width));
    setOpened({ zoom: z, fitsWidth: width >= layout.width * z, ready: true });
    void instance.setViewport({ x: Math.max(0, (width - layout.width * z) / 2), y: 8, zoom: z });
  };
  const services = new Set(flow.steps.map((s) => s.serviceDefinitionId)).size;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const id = (e.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');
    if (id && steps.has(id)) {
      e.preventDefault();
      onSelectStep(id);
    }
  };

  return (
    <div ref={box} className="flow-swimlane relative" style={{ height: Math.min(780, Math.max(320, Math.round(layout.height * opened.zoom + 24))) }}>
      <ReactFlow
        nodes={elements.nodes}
        edges={elements.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }}
        onNodeClick={(_, node) => steps.has(node.id) && onSelectStep(node.id)}
        onKeyDown={onKeyDown}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        onInit={openAtStart}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        aria-label={`Swimlanes of ${flow.name}: ${flow.steps.length} steps in ${services} services and ${flow.outcomes.length} outcomes. Use the step strip for details.`}
      >
        {!opened.fitsWidth && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            ariaLabel={`${flow.name} overview`}
            className="swimlane-minimap max-md:hidden"
            style={{ width: 168, height: 96 }}
            nodeColor={(n) => (n.type === 'lane' ? 'transparent' : 'var(--color-indigo)')}
            nodeStrokeColor={(n) => (n.type === 'lane' ? 'var(--color-line)' : 'transparent')}
          />
        )}
      </ReactFlow>
      <Captions layout={layout} />
      <Controls />
    </div>
  );
}

/** The frozen lane captions, following the viewport's vertical pan and zoom. */
function Captions({ layout }: { layout: SwimlaneLayout }) {
  const transform = useStore((s) => s.transform);
  return <LaneCaptions lanes={layout.lanes} transform={transform} />;
}

/**
 * Brings a step into view when it is outside the visible area: the replay's current step, or a
 * selected one (an effect on the step change, never per frame; instant with reduced motion).
 */
function useFollow(layout: SwimlaneLayout, stepId: string | null, box: RefObject<HTMLDivElement | null>) {
  const reactFlow = useReactFlow();
  useEffect(() => {
    const node = stepId ? layout.nodes.find((n) => n.id === stepId) : undefined;
    const el = box.current;
    if (!node || !el) return;
    const { x, y, zoom } = reactFlow.getViewport();
    const left = node.x * zoom + x;
    const right = (node.x + node.width) * zoom + x;
    const top = node.y * zoom + y;
    const bottom = (node.y + node.height) * zoom + y;
    if (left >= 110 && right <= el.clientWidth - 12 && top >= 0 && bottom <= el.clientHeight - 12) return;
    void reactFlow.setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom, duration: isMotionReduced() ? 0 : 300 });
  }, [stepId, layout, reactFlow, box]);
}

/** Which steps the transaction is in, which transitions it has taken, and where it diverged. */
function replayView(replay: SwimlaneReplay | null, cursor: string): SwimlaneView['replay'] {
  if (!replay) return null;
  const [stepPart = '0', activePart = ''] = cursor.split('|');
  const at = Number(stepPart);
  const { tx, divergence } = replay;
  const active = activePart
    .split(',')
    .filter(Boolean)
    .flatMap((i) => {
      const s = tx.steps[Number(i)];
      return s ? [{ stepId: s.stepId, status: s.status, correlated: s.correlated }] : [];
    });
  const traversed = new Set(tx.steps.slice(0, at + 1).flatMap((s) => (s.transitionId ? [s.transitionId] : [])));
  const off = divergence ? tx.steps[divergence.stepIndex] : undefined;
  return { active, traversed, divergence: off && divergence && divergence.stepIndex <= at ? { stepId: off.stepId, transitionId: off.transitionId ?? null } : null };
}

function Controls() {
  const reactFlow = useReactFlow();
  const duration = isMotionReduced() ? 0 : 200;
  return (
    <div className={cx(floatClass, 'top-3 right-3 flex gap-0.5 p-1 max-md:top-auto max-md:bottom-3')} role="toolbar" aria-label="Map controls">
      <button type="button" className={buttonClass('icon')} onClick={() => void reactFlow.zoomOut({ duration })} aria-label="Zoom out" title="Zoom out">
        <Icon name="minus" />
      </button>
      <button type="button" className={buttonClass('icon')} onClick={() => void reactFlow.zoomIn({ duration })} aria-label="Zoom in" title="Zoom in">
        <Icon name="plus" />
      </button>
      <button type="button" className={buttonClass('icon')} onClick={() => void reactFlow.fitView({ padding: 0.04, duration })} aria-label="Fit to view" title="Fit to view">
        <Icon name="fit" />
      </button>
    </div>
  );
}
