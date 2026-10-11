import { DEFAULT_LAYOUT_OPTIONS, NODE_SIZE, type LayoutOptions, type LayoutRequest } from '../layout/GraphLayoutService';
import type { TopologyGraph } from './topologyGraph';

export const COLLAPSED_NODE_SIZE = { width: 196, height: 52 } as const;

/** Graph view model → serializable layout request. */
export function toLayoutRequest(graph: TopologyGraph, options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS): LayoutRequest {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      ...(n.kind === 'collapsed-group' ? COLLAPSED_NODE_SIZE : NODE_SIZE),
      parentId: n.groupId,
    })),
    groups: graph.groups.map((g) => ({ id: g.id, parentId: g.parentId })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    options,
  };
}
