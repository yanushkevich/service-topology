import type { BusinessFlow } from '../../domain/types';

/** Edit, delete, and duplicate for a business flow (Milestone 10 phase 6). */
export function FlowEditActions({ flow }: { flow: BusinessFlow }) {
  void flow;
  return null;
}

/** Shortcut to create a flow; the header's New menu explains when editing is unavailable. */
export function NewFlowButton() {
  return null;
}
