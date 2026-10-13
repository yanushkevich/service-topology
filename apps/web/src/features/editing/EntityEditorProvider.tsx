import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTopology, useTopologyEditing } from '../../data/topologyContext';
import type { WritableKind } from '../../data/repositories/TopologyRepository';
import { buildTopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow, EntityId } from '../../domain/types';
import { FlowEditorDialog } from '../business-flows/FlowEditorDialog';
import { newFlowTemplate } from '../business-flows/flowForm';
import { useUiStore } from '../../state/uiStore';
import { DeleteEntityDialog } from './DeleteEntityDialog';
import { EntityEditorDialog } from './EntityEditorDialog';
import { selectionFor, type FormContext } from './entityForms';
import { EntityEditingContext, findEntity, type EntityEditing } from './editingContext';

type Request = { mode: 'create'; kind: WritableKind; template?: BusinessFlow } | { mode: 'edit' | 'delete'; kind: WritableKind; id: EntityId };

/**
 * Create, edit, and delete canonical entities (ADR-020). Offered only when the data source can be
 * written (the backend API) and the current state is shown (not history). Forms start from the
 * stored topology, not the simulated one; saving reloads the topology from the backend.
 */
export function EntityEditorProvider({ children }: { children: ReactNode }) {
  const topology = useTopology();
  const { writer, baseline, reload } = useTopologyEditing();
  const environmentId = useUiStore((s) => s.environmentId);
  const navigate = useNavigate();
  const { search } = useLocation();
  const [request, setRequest] = useState<Request | null>(null);

  const loading = topology.status !== 'ready' || !baseline;
  const viewingHistory = topology.status === 'ready' && topology.history !== null;
  const unavailable = useMemo<EntityEditing['unavailable']>(
    () =>
      loading
        ? { reason: 'The topology is still loading.', hint: 'loading' }
        : !writer
          ? { reason: 'Built-in mock data is read-only. Connect to the backend API to create, edit, or delete.', hint: 'backend' }
          : viewingHistory
            ? { reason: 'You are viewing history. Return to the current state to edit.', hint: 'history' }
            : null,
    [loading, writer, viewingHistory],
  );
  const available = unavailable === null;

  const openCreate = useCallback((kind: WritableKind, template?: BusinessFlow) => available && setRequest(template ? { mode: 'create', kind, template } : { mode: 'create', kind }), [available]);
  const openEdit = useCallback((kind: WritableKind, id: EntityId) => available && setRequest({ mode: 'edit', kind, id }), [available]);
  const openDelete = useCallback((kind: WritableKind, id: EntityId) => available && setRequest({ mode: 'delete', kind, id }), [available]);
  const value = useMemo(() => ({ unavailable, openCreate, openEdit, openDelete }), [unavailable, openCreate, openEdit, openDelete]);

  const ctx: FormContext | null = useMemo(
    () => (baseline && request ? { data: baseline, index: buildTopologyIndex(baseline), environmentId, editingId: request.mode === 'create' ? null : request.id } : null),
    [baseline, request, environmentId],
  );

  const close = () => setRequest(null);
  const afterSave = (kind: WritableKind, id: EntityId) => {
    setRequest(null);
    const ref = selectionFor(kind, id);
    if (ref) useUiStore.getState().select(ref);
    else navigate({ pathname: `/${kind === 'business-flow' ? 'flows' : 'events'}/${encodeURIComponent(id)}`, search });
  };
  const afterDelete = (kind: WritableKind, id: EntityId) => {
    setRequest(null);
    const ui = useUiStore.getState();
    if (ui.selection?.id === id) ui.select(null);
    if (kind === 'event-type') {
      if (ui.eventHighlight === id) ui.setEventHighlight(null);
      navigate({ pathname: '/events', search });
    }
    if (kind === 'business-flow') navigate({ pathname: '/flows', search });
  };

  let dialog: ReactNode = null;
  if (request && ctx && writer && available) {
    if (request.mode === 'delete') {
      const entity = findEntity(ctx.data, request.kind, request.id);
      dialog = entity ? (
        <DeleteEntityDialog kind={request.kind} entity={entity} ctx={ctx} writer={writer} reload={reload} onClose={close} onDeleted={() => afterDelete(request.kind, request.id)} />
      ) : null;
    } else if (request.kind === 'business-flow') {
      // Business flows have their own structured editor (ADR-022).
      const existing = request.mode === 'edit' ? (findEntity(ctx.data, 'business-flow', request.id) ?? null) : null;
      const initial = request.mode === 'create' ? (request.template ?? newFlowTemplate(ctx.data)) : existing;
      if (initial) {
        dialog = (
          <FlowEditorDialog
            key={`${request.mode}:${request.mode === 'create' ? (request.template?.id ?? '') : request.id}`}
            initial={initial}
            creating={request.mode === 'create'}
            ctx={ctx}
            writer={writer}
            reload={reload}
            onClose={close}
            onSaved={(id) => afterSave('business-flow', id)}
          />
        );
      }
    } else {
      const existing = request.mode === 'edit' ? (findEntity(ctx.data, request.kind, request.id) ?? null) : null;
      if (request.mode === 'create' || existing) {
        dialog = (
          <EntityEditorDialog
            key={`${request.mode}:${request.kind}:${request.mode === 'edit' ? request.id : ''}`}
            kind={request.kind}
            existing={existing}
            ctx={ctx}
            writer={writer}
            reload={reload}
            onClose={close}
            onSaved={(id) => afterSave(request.kind, id)}
          />
        );
      }
    }
  }

  return (
    <EntityEditingContext.Provider value={value}>
      {children}
      {dialog}
    </EntityEditingContext.Provider>
  );
}
