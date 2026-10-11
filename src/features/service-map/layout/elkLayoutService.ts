import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { Box, GraphLayoutService, LayoutRequest, LayoutResult } from './GraphLayoutService';
import { loadElk, type ElkApi } from './loadElk';

/**
 * ELK "layered" layout with nested groups (hierarchyHandling INCLUDE_CHILDREN). Inputs are sorted by
 * ID and the random seed is fixed, so identical inputs give identical output.
 * Pass an ELK instance (tests, benchmarks) or let it load lazily (worker in the browser).
 */
export function createElkLayoutService(elkOrLoader: ElkApi | (() => Promise<ElkApi>) = loadElk): GraphLayoutService {
  let elkPromise: Promise<ElkApi> | undefined;
  const getElk = () => {
    elkPromise ??= typeof elkOrLoader === 'function' ? elkOrLoader() : Promise.resolve(elkOrLoader);
    return elkPromise;
  };
  return {
    async layout(request: LayoutRequest, signal?: AbortSignal): Promise<LayoutResult> {
      signal?.throwIfAborted();
      const { options } = request;
      const pad = options.groupPadding;

      const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);
      const elkNodes = new Map<string, ElkNode>();
      const childrenOf = new Map<string | undefined, ElkNode[]>();
      const add = (parentId: string | undefined, node: ElkNode) => {
        const list = childrenOf.get(parentId);
        if (list) list.push(node);
        else childrenOf.set(parentId, [node]);
      };

      for (const group of [...request.groups].sort(byId)) {
        const node: ElkNode = {
          id: group.id,
          layoutOptions: {
            'elk.padding': `[top=${pad.top},left=${pad.left},bottom=${pad.bottom},right=${pad.right}]`,
          },
        };
        elkNodes.set(group.id, node);
        add(group.parentId, node);
      }
      for (const n of [...request.nodes].sort(byId)) {
        const node: ElkNode = { id: n.id, width: n.width, height: n.height };
        elkNodes.set(n.id, node);
        add(n.parentId, node);
      }
      for (const [parentId, children] of childrenOf) {
        if (parentId === undefined) continue;
        const parent = elkNodes.get(parentId);
        if (!parent) throw new Error(`Layout parent "${parentId}" is not a group`);
        parent.children = children;
      }

      const edges: ElkExtendedEdge[] = [...request.edges]
        .sort(byId)
        .filter((e) => elkNodes.has(e.source) && elkNodes.has(e.target))
        .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));

      const graph: ElkNode = {
        id: '__root__',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': options.direction,
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          'elk.randomSeed': '1',
          'elk.spacing.nodeNode': String(options.nodeSpacing),
          'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing),
          'elk.spacing.componentComponent': String(options.layerSpacing),
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        },
        children: childrenOf.get(undefined) ?? [],
        edges,
      };

      const elk = await getElk();
      const laidOut = await elk.layout(graph);
      signal?.throwIfAborted();

      const groupIds = new Set(request.groups.map((g) => g.id));
      const result: LayoutResult = { nodes: {}, groups: {} };
      // ELK child coordinates are relative to the parent; accumulate to absolute.
      const visit = (node: ElkNode, offsetX: number, offsetY: number) => {
        for (const child of node.children ?? []) {
          const box: Box = {
            x: offsetX + (child.x ?? 0),
            y: offsetY + (child.y ?? 0),
            width: child.width ?? 0,
            height: child.height ?? 0,
          };
          if (groupIds.has(child.id)) result.groups[child.id] = box;
          else result.nodes[child.id] = box;
          visit(child, box.x, box.y);
        }
      };
      visit(laidOut, 0, 0);
      return result;
    },
  };
}
