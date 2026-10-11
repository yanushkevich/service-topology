/**
 * Layout boundary (ARCHITECTURE Revision 2 §1). Inputs and outputs are plain serializable data so
 * the engine (ELK today) can be benchmarked, moved to a worker, or replaced without touching
 * domain types or renderers. Implementations must not mutate their input.
 */

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  /** Containing group, if any. */
  parentId?: string | undefined;
}

export interface LayoutGroupInput {
  id: string;
  parentId?: string | undefined;
}

export interface LayoutEdgeInput {
  id: string;
  source: string;
  target: string;
}

export interface LayoutOptions {
  direction: 'RIGHT' | 'DOWN';
  /** Space between sibling nodes. */
  nodeSpacing: number;
  /** Space between layers (columns when direction is RIGHT). */
  layerSpacing: number;
  /** Inner padding of groups; `top` leaves room for the group header. */
  groupPadding: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutRequest {
  nodes: readonly LayoutNodeInput[];
  groups: readonly LayoutGroupInput[];
  edges: readonly LayoutEdgeInput[];
  options: LayoutOptions;
}

/** Absolute (canvas-space) box; x/y is the top-left corner. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Record<string, Box>;
  groups: Record<string, Box>;
}

export interface GraphLayoutService {
  layout(request: LayoutRequest, signal?: AbortSignal): Promise<LayoutResult>;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  direction: 'RIGHT',
  nodeSpacing: 22,
  layerSpacing: 64,
  groupPadding: { top: 38, right: 16, bottom: 16, left: 16 },
};

/** Entity node box from the UI mock (.n2: 176 × 46). */
export const NODE_SIZE = { width: 176, height: 46 } as const;
