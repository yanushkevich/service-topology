import { Link, useLocation } from 'react-router';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { Icon } from '../../shared/ui/Icon';
import { useUiStore } from '../../state/uiStore';
import { useEventHighlight } from './useEventHighlight';

/** Names the highlighted event flow on the map and clears it (PRODUCT_SPEC §M.3). */
export function EventHighlightChip({ index }: { index: TopologyIndex | null }) {
  const highlight = useEventHighlight(index);
  const eventId = useUiStore((s) => s.eventHighlight);
  const hasSelection = useUiStore((s) => s.selection !== null);
  const environmentName = useUiStore((s) => (index?.environments.get(s.environmentId)?.name ?? s.environmentId));
  const { search } = useLocation();
  if (!eventId || !highlight) return null;
  const name = highlight.eventType?.name ?? eventId;
  const note = !highlight.eventType
    ? 'unknown event type'
    : !highlight.flow
      ? `not carried in ${environmentName}`
      : hasSelection
        ? 'paused while something is selected'
        : null;
  return (
    <div role="status" className="flex items-center gap-1 rounded-full border border-edge-event bg-surface-2 py-0.5 pr-0.5 pl-2.5 text-sm">
      <Icon name="events" />
      <span>
        Event flow:{' '}
        {highlight.eventType ? (
          <Link to={{ pathname: `/events/${encodeURIComponent(eventId)}`, search }} className="font-mono font-medium text-fg underline-offset-2 hover:underline">
            {name}
          </Link>
        ) : (
          <span className="font-mono">{name}</span>
        )}
        {note && <span className="text-fg-2"> ({note})</span>}
      </span>
      <button
        type="button"
        className="grid size-6 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
        aria-label={`Clear event highlight ${name}`}
        onClick={() => useUiStore.getState().setEventHighlight(null)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
