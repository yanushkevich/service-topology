import { useState } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { EntityOfKind, TopologyWriter, WritableKind } from '../../data/repositories/TopologyRepository';
import { displayName } from '../../domain/topologyIndex';
import { Button } from '../../shared/ui/primitives';
import { Modal } from '../../shared/ui/Modal';
import { KIND_LABELS, applyChange, newIssues, type FormContext } from './entityForms';
import { IssueList } from './issues';
import { asBlockers, problemMessage, type DisplayIssue } from './issueMessages';

/**
 * Confirms a delete (ADR-020). Nothing that is still referenced can be deleted: the references that
 * would break are listed (the same rules the server applies), and Delete stays disabled until they
 * are removed or re-pointed.
 */
export function DeleteEntityDialog<K extends WritableKind>({
  kind,
  entity,
  ctx,
  writer,
  reload,
  onClose,
  onDeleted,
}: {
  kind: K;
  entity: EntityOfKind[K];
  ctx: FormContext;
  writer: TopologyWriter;
  reload: () => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const blockers = newIssues(ctx.data, applyChange(ctx.data, kind, { op: 'delete', id: entity.id }));
  const [serverIssues, setServerIssues] = useState<DisplayIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const name = displayName(ctx.index, entity.id);
  const label = KIND_LABELS[kind].toLowerCase();

  const confirm = async () => {
    setDeleting(true);
    setMessage(null);
    try {
      await writer.remove(kind, entity.id);
      await reload();
      onDeleted();
    } catch (error) {
      setDeleting(false);
      if (error instanceof ApiError && error.status === 422) setServerIssues([...error.issues]);
      else if (error instanceof ApiError && error.status === 412) setMessage('Someone changed the topology since it was loaded. Reload the latest data and try again.');
      else if (error instanceof ApiError && error.status === 404) {
        await reload().catch(() => undefined);
        onDeleted();
      } else setMessage(problemMessage(error));
    }
  };

  const blocked = blockers.length > 0 || serverIssues.length > 0;
  return (
    <Modal
      title={`Delete ${label}?`}
      description={
        <>
          <b className="text-fg">{name}</b> <span className="font-mono">({entity.id})</span>
        </>
      }
      onClose={onClose}
      closeLabel="Cancel delete"
      busy={deleting}
      footer={
        <>
          <Button onClick={onClose} disabled={deleting} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={deleting || blocked}>
            {deleting ? 'Deleting…' : `Delete ${label}`}
          </Button>
        </>
      }
    >
      {blocked ? (
        <IssueList
          issues={asBlockers(serverIssues.length > 0 ? serverIssues : blockers)}
          title={`This ${label} is still referenced. Remove or re-point these first:`}
          ctx={ctx}
        />
      ) : (
        <p className="m-0 text-fg-2">Nothing references it, so the topology stays valid. This cannot be undone, but snapshots taken earlier keep it.</p>
      )}
      {message && (
        <p role="alert" className="m-0 mt-2 text-sm text-crit-fg">
          {message}
        </p>
      )}
    </Modal>
  );
}
