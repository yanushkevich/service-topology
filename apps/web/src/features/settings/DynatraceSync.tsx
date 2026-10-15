import { useState } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { SourceIntegration, SyncChange, SyncPreview } from '../../data/integrations/sourceIntegration';
import { useTopologyEditing } from '../../data/topologyContext';
import { Button } from '../../shared/ui/primitives';
import { cx, kickerClass } from '../../shared/ui/classes';
import { clockTime, KIND_LABELS, OP_LABELS, OP_MEANINGS, SYNC_KINDS, SYNC_OPS, summaryText } from './dynatraceText';
import { Row } from './SettingsRow';

/**
 * Preview, then apply (ADR-034): the backend discovers Dynatrace, reconciles it with the stored
 * topology, and holds the result for 10 minutes. Nothing changes until Apply.
 */

const SHOWN_CHANGES = 100;
const SHOWN_ISSUES = 20;

export function DynatraceSync({ integration, isExample, onApplied }: { integration: SourceIntegration; isExample: boolean; onApplied: () => void }) {
  const { reload } = useTopologyEditing();
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState('');

  const run = async () => {
    setBusy('preview');
    setMessage('');
    try {
      const next = await integration.preview();
      setPreview(next);
      setMessage(next.changes.length ? `Preview ready: ${summaryText(next.summary)}.` : 'Everything is in sync: no changes.');
    } catch (error) {
      setPreview(null);
      setMessage(`Preview failed: ${failureText(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const apply = async (held: SyncPreview) => {
    setBusy('apply');
    try {
      await integration.apply(held);
      await reload();
      setPreview(null);
      setMessage(`Applied: ${summaryText(held.summary)}.`);
      onApplied();
    } catch (error) {
      setPreview(null);
      setMessage(`Not applied: ${failureText(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Row
      label="Sync from Dynatrace"
      hint={`Preview what a sync would change; nothing is stored until you apply it. Services already here are linked, never overwritten.${isExample ? ' This tenant is an example: what it adds is invented data.' : ''}`}
    >
      <div className="flex w-full flex-col items-start gap-2">
        <Button variant="secondary" onClick={() => void run()} disabled={busy !== null}>
          {busy === 'preview' ? 'Reading Dynatrace…' : 'Preview sync'}
        </Button>
        <p role="status" className="m-0 text-sm text-fg-2">
          {message}
        </p>
        {preview && <PreviewDetails preview={preview} busy={busy === 'apply'} onApply={() => void apply(preview)} />}
      </div>
    </Row>
  );
}

function PreviewDetails({ preview, busy, onApply }: { preview: SyncPreview; busy: boolean; onApply: () => void }) {
  const errors = preview.issues;
  return (
    <div className="flex w-full flex-col gap-2" data-sync-preview>
      {preview.changes.length > 0 && <SummaryTable preview={preview} />}
      {preview.notes.length > 0 && (
        <ul aria-label="Notes on this sync" className="m-0 list-disc pl-5 text-sm text-fg-2">
          {preview.notes.map((n) => (
            <li key={n.code}>{n.message}</li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <div role="alert" className="text-sm text-crit-fg">
          <p className="m-0">This sync cannot be applied: the result would not validate ({errors.length} issue{errors.length === 1 ? '' : 's'}).</p>
          <ul className="m-0 pl-5">
            {errors.slice(0, SHOWN_ISSUES).map((issue, i) => (
              <li key={i}>
                {issue.entityId && <span className="font-mono">{issue.entityId}: </span>}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.changes.length > 0 && <ChangeList changes={preview.changes} />}
      {preview.changes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={onApply} disabled={busy || !preview.canApply}>
            {busy ? 'Applying…' : `Apply ${preview.changes.length} change${preview.changes.length === 1 ? '' : 's'}`}
          </Button>
          <span className="text-sm text-fg-2">Can be applied until {clockTime(preview.expiresAt)}.</span>
        </div>
      )}
    </div>
  );
}

function SummaryTable({ preview }: { preview: SyncPreview }) {
  const ops = SYNC_OPS.filter((op) => SYNC_KINDS.some((kind) => preview.summary[kind]?.[op]));
  const kinds = SYNC_KINDS.filter((kind) => preview.summary[kind]);
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm" aria-label="Changes by kind">
        <thead>
          <tr className={cx(kickerClass, 'text-left')}>
            <th scope="col" className="py-1 pr-3 font-normal">Kind</th>
            {ops.map((op) => (
              <th key={op} scope="col" className="py-1 pr-3 text-right font-normal" title={OP_MEANINGS[op]}>
                {OP_LABELS[op]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind} className="border-t border-line">
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {KIND_LABELS[kind]}
              </th>
              {ops.map((op) => (
                <td key={op} className="py-1 pr-3 text-right font-mono">
                  {preview.summary[kind]?.[op] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangeList({ changes }: { changes: readonly SyncChange[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, SHOWN_CHANGES);
  return (
    <details className="w-full text-sm">
      <summary className="cursor-pointer text-accent-fg">Every change ({changes.length})</summary>
      <ul aria-label="Every change" className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
        {shown.map((c) => (
          <li key={`${c.kind}:${c.id}`} className="flex flex-wrap gap-x-2" data-change={c.op}>
            <span className="w-28 shrink-0 text-fg-2">{OP_LABELS[c.op]}</span>
            <span className="text-fg-2">{KIND_LABELS[c.kind]}</span>
            <span className="font-medium">{c.name}</span>
            {c.name !== c.id && <span className="font-mono text-xs text-fg-3">{c.id}</span>}
            {c.usedBy && c.usedBy.length > 0 && <span className="text-warn-fg">used by {c.usedBy.join(', ')}</span>}
          </li>
        ))}
      </ul>
      {!all && changes.length > SHOWN_CHANGES && (
        <Button variant="secondary" className="mt-1" onClick={() => setAll(true)}>
          Show all {changes.length}
        </Button>
      )}
    </details>
  );
}

/** A sync failure in words: the backend's safe detail when it has one. */
function failureText(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  if (error.status === 412) return 'the topology changed after the preview. Preview again.';
  if (error.status === 410) return 'the preview expired. Preview again.';
  if (error.status === 409) return 'a preview or check is already running. Try again when it finishes.';
  return error.detail ?? error.message;
}
