import { useMemo } from 'react';
import { eventFlowReach, resolveEventFlow, type EventFlow } from '../../domain/eventFlow';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { Reach } from '../../domain/traversal';
import type { EventType } from '../../domain/types';
import { useUiStore } from '../../state/uiStore';

export interface EventHighlight {
  /** The highlighted event type, or undefined when the ID is unknown in the data being viewed. */
  eventType: EventType | undefined;
  /** Its flow in the selected environment, or null when it is not carried there. */
  flow: EventFlow | null;
  /** What the map emphasizes; null when there is nothing to show or a selection takes precedence. */
  reach: Reach | null;
}

/** The shared event-flow highlight (PRODUCT_SPEC §M.3) resolved against the data being viewed. */
export function useEventHighlight(index: TopologyIndex | null): EventHighlight | null {
  const eventId = useUiStore((s) => s.eventHighlight);
  const environmentId = useUiStore((s) => s.environmentId);
  const hasSelection = useUiStore((s) => s.selection !== null);
  const resolved = useMemo(() => {
    if (!eventId || !index) return null;
    const eventType = index.eventTypes.get(eventId);
    const flow = eventType ? resolveEventFlow(index, eventType, environmentId) : null;
    return { eventType, flow, reach: flow ? eventFlowReach(flow) : null };
  }, [eventId, index, environmentId]);
  if (!resolved) return null;
  return hasSelection ? { ...resolved, reach: null } : resolved;
}
