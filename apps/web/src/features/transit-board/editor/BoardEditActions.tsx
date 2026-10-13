import { useContext, useState } from 'react';
import { useTopology, useTopologyEditing } from '../../../data/topologyContext';
import type { ServiceDefinition } from '../../../domain/types';
import type { StoredDefinition } from '../../../transit/boardStore';
import { definitionOf } from '../../../transit/definition';
import { TransitRepositoryContext } from '../../../transit/repository';
import type { TransitBoard } from '../../../transit/types';
import { Modal } from '../../../shared/ui/Modal';
import { Button } from '../../../shared/ui/primitives';
import { problemMessage } from '../../editing/issueMessages';
import { newBoard } from './boardForm';
import { BoardEditorDialog } from './BoardEditorDialog';

/**
 * Create, edit, and delete a service's board (ADR-031), shown when boards can be stored (the
 * backend or the local sandbox). Editing the example board saves a stored copy, which then wins.
 */
export function BoardEditActions({ service, loaded, stored, onChanged }: { service: ServiceDefinition; loaded: TransitBoard | null; stored: StoredDefinition | null; onChanged: () => void }) {
  const store = useContext(TransitRepositoryContext).boards;
  const topology = useTopology();
  const { baseline } = useTopologyEditing();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = baseline ?? (topology.status === 'ready' ? topology.index.data : null);
  if (!store || !data) return null;
  const initial = stored?.definition ?? (loaded ? definitionOf(loaded) : newBoard(service.id, service.name));
  const exists = stored !== null || loaded !== null;
  return (
    <>
      <Button onClick={() => setEditing(true)} data-board-action={exists ? 'edit' : 'create'}>
        {exists ? 'Edit board' : 'Create a transit board'}
      </Button>
      {stored && (
        <Button variant="danger" onClick={() => setDeleting(true)}>
          Delete board
        </Button>
      )}
      {editing && (
        <BoardEditorDialog
          initial={initial}
          revision={stored?.revision ?? null}
          store={store}
          topology={data}
          serviceName={service.name}
          observed={loaded}
          fromExample={!stored && loaded !== null}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
      {deleting && stored && (
        <DeleteBoardDialog
          serviceName={service.name}
          where={store.kind}
          onClose={() => setDeleting(false)}
          onDelete={async () => {
            await store.remove(service.id, stored.revision);
            setDeleting(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function DeleteBoardDialog({ serviceName, where, onClose, onDelete }: { serviceName: string; where: 'backend' | 'sandbox'; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={`Delete the transit board of ${serviceName}?`}
      description={`The stored definition is removed from ${where === 'sandbox' ? 'the local sandbox' : 'the backend'}. Where example data exists, the example board shows again.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onDelete().catch((e: unknown) => {
                setBusy(false);
                setError(problemMessage(e));
              });
            }}
          >
            {busy ? 'Deleting…' : 'Delete board'}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="m-0 text-sm text-crit-fg">
          {error}
        </p>
      )}
    </Modal>
  );
}
