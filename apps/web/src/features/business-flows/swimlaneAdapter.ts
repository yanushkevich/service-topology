import type { Edge, Node } from '@xyflow/react';
import type { BusinessFlow, FlowOutcome, FlowStep, FlowTransition, HealthStatus } from '../../domain/types';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import type { TxStep } from '../../transit/flows/observed';
import { edgeLabelText, type SwimlaneEdge, type SwimlaneLane, type SwimlaneLayout } from '../../transit/flows/swimlane';
import { isUndoTransition } from './flowVisuals';

/**
 * React Flow view model of the swimlane (ADR-023). Positions and paths come from the pure layout
 * and are fixed; `applyView` only rewrites `data`, so selection, search, findings focus, and replay
 * never move a node or reroute an edge.
 */

export type Emphasis = 'normal' | 'dim' | 'focus';

export interface StepData extends Record<string, unknown> {
  step: FlowStep;
  serviceName: string;
  /** Other flows that run this step (same service and entry point). */
  alsoIn: { id: string; name: string; code: string }[];
  /** Data stores of the step's service in this environment (ADR-027). */
  stores: StoreRef[];
  emphasis: Emphasis;
  selected: boolean;
  /** The replayed transaction is here now. */
  train: Pick<TxStep, 'status' | 'correlated'> | null;
  /** The replay left the typical path here. */
  divergence: boolean;
}

export interface OutcomeData extends Record<string, unknown> {
  outcome: FlowOutcome;
  emphasis: Emphasis;
  train: Pick<TxStep, 'status' | 'correlated'> | null;
}

export interface LaneData extends Record<string, unknown> {
  lane: SwimlaneLane;
  width: number;
}

/** A data store as a step or policy shows it. */
export interface StoreRef {
  id: string;
  name: string;
  health: HealthStatus | undefined;
}

export interface RoutedData extends Record<string, unknown> {
  flowId: string;
  /** Per policy: the database it lives in (outbox and relay: the source's; inbox: the target's). */
  policyStores: (string | null)[];
  route: SwimlaneEdge;
  transition: FlowTransition;
  /** "if declined · 2%", "OrderPlaced", or ''. */
  label: string;
  /** Compensation track: dashed. */
  undo: boolean;
  color: string;
  emphasis: Emphasis | 'traversed';
  divergence: boolean;
  /** For tooltips: "Await settlement → Post to ledger". */
  title: string;
}

export type StepNode = Node<StepData, 'step'>;
export type OutcomeNode = Node<OutcomeData, 'outcome'>;
export type LaneNode = Node<LaneData, 'lane'>;
export type SwimlaneNode = StepNode | OutcomeNode | LaneNode;
export type RoutedEdge = Edge<RoutedData, 'routed'>;

export interface SwimlaneView {
  selectedStepId: string | null;
  /** The focused finding's steps and transitions. */
  focus: { steps: ReadonlySet<string>; transitions: ReadonlySet<string> } | null;
  /** Steps matching the search, or null without a query. */
  matches: ReadonlySet<string> | null;
  replay: {
    /** Steps the transaction is in now. */
    active: { stepId: string; status: TxStep['status']; correlated: boolean }[];
    /** Transitions taken so far. */
    traversed: ReadonlySet<string>;
    /** Where it left the typical path (step and the transition into it). */
    divergence: { stepId: string; transitionId: string | null } | null;
  } | null;
}

export const NO_VIEW: SwimlaneView = { selectedStepId: null, focus: null, matches: null, replay: null };

/** Nodes and edges at their fixed positions, with neutral view data. Build once per flow. */
export function swimlaneElements(
  layout: SwimlaneLayout,
  flow: BusinessFlow,
  options: {
    fx: FlowBoardIndex;
    color: string;
    serviceName: (id: string) => string;
    eventName: (id: string) => string;
    shares: ReadonlyMap<string, number>;
    /** Data stores of a service in the environment. */
    storesOf: (serviceDefinitionId: string) => StoreRef[];
  },
): { nodes: SwimlaneNode[]; edges: RoutedEdge[] } {
  const lanes: LaneNode[] = layout.lanes.map((lane) => ({
    id: `lane:${lane.id}`,
    type: 'lane',
    position: { x: 0, y: lane.y },
    width: layout.width,
    height: lane.height,
    draggable: false,
    selectable: false,
    focusable: false,
    zIndex: -1,
    data: { lane, width: layout.width },
  }));
  const steps = new Map(flow.steps.map((s) => [s.id, s]));
  const outcomes = new Map(flow.outcomes.map((o) => [o.id, o]));
  const nodes: SwimlaneNode[] = [...lanes];
  for (const n of layout.nodes) {
    const common = { id: n.id, position: { x: n.x, y: n.y }, width: n.width, height: n.height, draggable: false, selectable: false, zIndex: 10 };
    const step = steps.get(n.id);
    if (step) {
      const alsoIn = (options.fx.flowsByStation.get(options.fx.stationOf(flow.id, step.id)) ?? [])
        .filter((id) => id !== flow.id)
        .flatMap((id) => {
          const other = options.fx.flowById.get(id);
          return other ? [{ id, name: other.name, code: options.fx.codes.get(id) ?? '' }] : [];
        });
      const service = options.serviceName(step.serviceDefinitionId);
      const stores = options.storesOf(step.serviceDefinitionId);
      const storeText = stores.length ? `, using ${stores.map((s) => s.name).join(', ')}` : '';
      nodes.push({ ...common, type: 'step', ariaLabel: `${step.name}, ${step.kind} step of ${service}${storeText}`, data: { step, serviceName: service, alsoIn, stores, emphasis: 'normal', selected: false, train: null, divergence: false } });
      continue;
    }
    const outcome = outcomes.get(n.id);
    if (outcome) nodes.push({ ...common, type: 'outcome', focusable: false, data: { outcome, emphasis: 'normal', train: null } });
  }

  const name = (id: string) => steps.get(id)?.name ?? outcomes.get(id)?.name ?? id;
  const edges: RoutedEdge[] = [];
  for (const route of layout.edges) {
    const transition = flow.transitions.find((t) => t.id === route.id);
    if (!transition) continue;
    edges.push({
      id: route.id,
      type: 'routed',
      source: route.from,
      target: route.to,
      focusable: false,
      selectable: false,
      data: {
        flowId: flow.id,
        policyStores: transition.policies.map((p) => storeOfPolicy(p.type, transition, steps, options.storesOf)),
        route,
        transition,
        label: edgeLabel(transition, options.shares.get(transition.id), options.eventName),
        undo: isUndoTransition(flow, transition.id),
        color: options.color,
        emphasis: 'normal',
        divergence: false,
        title: `${name(transition.from)} → ${name(transition.to)}`,
      },
    });
  }
  return { nodes, edges };
}

/** The database a store pattern lives in: the source service's for an outbox or its relay, the target's for an inbox. */
function storeOfPolicy(type: string, t: FlowTransition, steps: ReadonlyMap<string, FlowStep>, storesOf: (id: string) => StoreRef[]): string | null {
  const side = type === 'inbox' ? t.to : type === 'outbox' || type === 'polling-publisher' ? t.from : null;
  const step = side ? steps.get(side) : undefined;
  return step ? (storesOf(step.serviceDefinitionId)[0]?.name ?? null) : null;
}

/** The layout's label text (it reserved room for it) plus the observed share. */
function edgeLabel(t: FlowTransition, share: number | undefined, eventName: (id: string) => string): string {
  const text = edgeLabelText(t, eventName);
  return text && share !== undefined ? `${text} · ${Number((share * 100).toFixed(1))}%` : text;
}

/** The same elements with the view state applied to their data (positions and paths untouched). */
export function applyView(elements: { nodes: SwimlaneNode[]; edges: RoutedEdge[] }, view: SwimlaneView): { nodes: SwimlaneNode[]; edges: RoutedEdge[] } {
  const lit = (id: string): Emphasis => {
    if (view.focus) return view.focus.steps.has(id) ? 'focus' : 'dim';
    if (view.matches) return view.matches.has(id) ? 'focus' : 'dim';
    return 'normal';
  };
  const trainAt = new Map((view.replay?.active ?? []).map((a) => [a.stepId, { status: a.status, correlated: a.correlated }]));
  const nodes = elements.nodes.map((n): SwimlaneNode => {
    switch (n.type) {
      case 'step':
        return { ...n, data: { ...n.data, emphasis: lit(n.id), selected: view.selectedStepId === n.id, train: trainAt.get(n.id) ?? null, divergence: view.replay?.divergence?.stepId === n.id } };
      case 'outcome':
        return { ...n, data: { ...n.data, emphasis: view.focus || view.matches ? 'dim' : 'normal', train: trainAt.get(n.id) ?? null } };
      default:
        return n;
    }
  });
  const edges = elements.edges.map((e): RoutedEdge => {
    if (!e.data) return e;
    let emphasis: RoutedData['emphasis'] = 'normal';
    if (view.replay) emphasis = view.replay.traversed.has(e.id) ? 'traversed' : 'dim';
    else if (view.focus) emphasis = view.focus.transitions.has(e.id) || (view.focus.steps.has(e.source) && view.focus.steps.has(e.target)) ? 'focus' : 'dim';
    else if (view.matches) emphasis = view.matches.has(e.source) || view.matches.has(e.target) ? 'normal' : 'dim';
    return { ...e, data: { ...e.data, emphasis, divergence: view.replay?.divergence?.transitionId === e.id } };
  });
  return { nodes, edges };
}
