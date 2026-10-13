import { useTopologyEditing } from '../../data/topologyContext';
import type { BusinessFlow } from '../../domain/types';
import { buttonClass } from '../../shared/ui/classes';
import { EditingUnavailableNote, EntityEditActions } from '../editing/EditingControls';
import { useEntityEditing } from '../editing/editingContext';
import { duplicateFlow } from './flowForm';

/**
 * Edit and delete for an authored business flow; an imported one is read-only here (the next
 * import would overwrite edits, ADR-022) and offers an editable copy instead.
 */
export function FlowEditActions({ flow }: { flow: BusinessFlow }) {
  const { unavailable, openCreate } = useEntityEditing();
  const { baseline } = useTopologyEditing();
  if (flow.source.kind !== 'imported') return <EntityEditActions kind="business-flow" id={flow.id} label={flow.name} />;
  if (unavailable) return unavailable.hint === 'loading' ? null : <EditingUnavailableNote className="text-xs" />;
  return (
    <button type="button" className={buttonClass('secondary', 'self-start')} onClick={() => baseline && openCreate('business-flow', duplicateFlow(flow, baseline))}>
      Duplicate as authored flow
    </button>
  );
}

/** Shortcut to create a flow; the header's New menu explains when editing is unavailable. */
export function NewFlowButton() {
  const { unavailable, openCreate } = useEntityEditing();
  if (unavailable) return null;
  return (
    <button type="button" className={buttonClass('secondary', 'h-7 text-sm')} onClick={() => openCreate('business-flow')}>
      New business flow
    </button>
  );
}
