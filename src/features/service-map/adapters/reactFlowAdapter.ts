import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { TopologyIndex } from '../../../domain/topologyIndex';
import { reachFrom, type HighlightMode } from '../../../domain/traversal';
import type { EntityRef } from '../../../domain/types';
import type { LayoutResult } from '../layout/GraphLayoutService';
import type { GraphEdge, GraphGroup, GraphNode, TopologyGraph } from '../graph/topologyGraph';

/**
 * Graph view model + layout → React Flow nodes/edges. React Flow objects are view models only:
 * their IDs are canonical entity/group/relationship IDs, and nothing here is written back to
 * domain data or global state.
 */

export type Emphasis = 'none' | 'selected' | 'highlighted' | 'dimmed';

export interface EntityNodeData extends Record<string, unknown> {
  node: GraphNode;
  emphasis: Emphasis;
}

export interface GroupNodeData extends Record<string, unknown> {
  group: GraphGroup;
  emphasis: Emphasis;
}

export interface RelationshipEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
  emphasis: Emphasis;
  sourceName: string;
  targetName: string;
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>;
export type GroupFlowNode = Node<GroupNodeData, 'group'>;
export type TopologyFlowNode = EntityFlowNode | GroupFlowNode;
export type RelationshipFlowEdge = Edge<RelationshipEdgeData, 'relationship'>;

/** Manual positions keyed by canonical ID, relative to the containing group (if any). */
export type ManualPositions = Readonly<Record<string, XYPosition>>;

export interface HighlightState {
  /** Node/group IDs that represent the selection. */
  selectedIds: Set<string>;
  /** Node IDs on the highlighted dependency set (includes selected). Empty → nothing dimmed. */
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  active: boolean;
}

/** Which graph elements represent the selection, and what to emphasize, under a highlight mode. */
export function computeHighlight(
  index: TopologyIndex,
  graph: TopologyGraph,
  selection: EntityRef | null,
  mode: HighlightMode,
): HighlightState {
  const empty: HighlightState = { selectedIds: new Set(), nodeIds: new Set(), edgeIds: new Set(), active: false };
  if (!selection) return empty;

  const nodeFor = (entityId: string) => graph.nodes.find((n) => n.memberIds.includes(entityId) || n.id === entityId);

  if (selection.kind === 'relationship') {
    const edge = graph.edges.find((e) => e.relationshipIds.includes(selection.id));
    if (!edge) return empty;
    return {
      selectedIds: new Set([edge.id]),
      nodeIds: new Set([edge.source, edge.target]),
      edgeIds: new Set([edge.id]),
      active: true,
    };
  }

  if (graph.groups.some((g) => g.id === selection.id)) {
    return { ...empty, selectedIds: new Set([selection.id]) };
  }

  const node = nodeFor(selection.id);
  if (!node) return empty;
  // A collapsed group reaches everything its members reach.
  const reach = node.memberIds.map((id) => reachFrom(index, id, mode));
  const entityIds = new Set(reach.flatMap((r) => [...r.entityIds]));
  const relationshipIds = new Set(reach.flatMap((r) => [...r.relationshipIds]));
  return {
    selectedIds: new Set([node.id]),
    nodeIds: new Set(graph.nodes.filter((n) => n.memberIds.some((id) => entityIds.has(id))).map((n) => n.id)),
    edgeIds: new Set(graph.edges.filter((e) => e.relationshipIds.some((id) => relationshipIds.has(id))).map((e) => e.id)),
    active: true,
  };
}

function emphasisOf(id: string, highlight: HighlightState, set: Set<string>): Emphasis {
  if (highlight.selectedIds.has(id)) return 'selected';
  if (!highlight.active) return 'none';
  return set.has(id) ? 'highlighted' : 'dimmed';
}

export function toFlowNodes(
  graph: TopologyGraph,
  layout: LayoutResult,
  highlight: HighlightState,
  manualPositions: ManualPositions,
): TopologyFlowNode[] {
  const groupBox = (id: string | undefined) => (id ? layout.groups[id] : undefined);
  const relative = (box: { x: number; y: number }, parentId: string | undefined): XYPosition => {
    const parent = groupBox(parentId);
    return parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y };
  };

  // React Flow requires parents before children; graph.groups is already ordered by depth.
  const groups: GroupFlowNode[] = graph.groups.flatMap((group) => {
    const box = layout.groups[group.id];
    if (!box) return [];
    return [
      {
        id: group.id,
        type: 'group' as const,
        position: relative(box, group.parentId),
        ...(group.parentId ? { parentId: group.parentId, extent: 'parent' as const } : {}),
        width: box.width,
        height: box.height,
        draggable: false,
        selectable: false,
        focusable: false,
        selected: highlight.selectedIds.has(group.id),
        zIndex: group.depth,
        data: { group, emphasis: emphasisOf(group.id, highlight, new Set()) },
      },
    ];
  });

  const entities: EntityFlowNode[] = graph.nodes.flatMap((node) => {
    const box = layout.nodes[node.id];
    if (!box) return [];
    const position = manualPositions[node.id] ?? relative(box, node.groupId);
    return [
      {
        id: node.id,
        type: 'entity' as const,
        position,
        ...(node.groupId ? { parentId: node.groupId, extent: 'parent' as const } : {}),
        width: box.width,
        height: box.height,
        selected: highlight.selectedIds.has(node.id),
        zIndex: 100,
        ariaLabel: `${node.name}, ${node.kind === 'collapsed-group' ? node.subtitle : node.type}, health ${node.health}`,
        data: { node, emphasis: emphasisOf(node.id, highlight, highlight.nodeIds) },
      },
    ];
  });

  return [...groups, ...entities];
}

export function toFlowEdges(graph: TopologyGraph, highlight: HighlightState): RelationshipFlowEdge[] {
  const names = new Map(graph.nodes.map((n) => [n.id, n.name]));
  return graph.edges.map((edge) => ({
    id: edge.id,
    type: 'relationship' as const,
    source: edge.source,
    target: edge.target,
    selected: highlight.selectedIds.has(edge.id),
    zIndex: highlight.edgeIds.has(edge.id) ? 50 : 1,
    ariaLabel: `${edge.protocol} connection from ${names.get(edge.source) ?? edge.source} to ${names.get(edge.target) ?? edge.target}, ${edge.status}`,
    data: {
      edge,
      emphasis: emphasisOf(edge.id, highlight, highlight.edgeIds),
      sourceName: names.get(edge.source) ?? edge.source,
      targetName: names.get(edge.target) ?? edge.target,
    },
  }));
}

/** Translate a clicked React Flow element back to the canonical selection. */
export function refForNode(node: GraphNode): EntityRef | null {
  return node.ref;
}

export function refForEdge(edge: GraphEdge): EntityRef | null {
  // A merged edge (collapsed groups) has no single canonical relationship to select.
  const [only] = edge.relationshipIds;
  return edge.relationshipIds.length === 1 && only ? { kind: 'relationship', id: only } : null;
}
