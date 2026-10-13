import { useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../data/http/apiClient';
import { buildTopologyIndex } from '../../../domain/topologyIndex';
import type { TopologyData } from '../../../domain/types';
import { indexBoard } from '../../../transit/board';
import type { BoardStore } from '../../../transit/boardStore';
import { boardFromDefinition, validateBoardDefinition, type BoardDefinition } from '../../../transit/definition';
import { computeMapGeometry } from '../../../transit/layout';
import type { TransitBoard } from '../../../transit/types';
import { Modal } from '../../../shared/ui/Modal';
import { Button, Kicker, Segment, Segmented } from '../../../shared/ui/primitives';
import { problemMessage } from '../../editing/issueMessages';
import { TransitMap } from '../TransitMap';
import { LinesSection, PoliciesSection, StationsSection, TablesSection } from './BoardSections';

type Section = 'endpoints' | 'stations' | 'policies' | 'tables';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'stations', label: 'Stations' },
  { id: 'policies', label: 'Policies' },
  { id: 'tables', label: 'Tables' },
];
const SECTION_OF: Record<string, Section> = { lines: 'endpoints', stations: 'stations', policies: 'policies', tables: 'tables' };

/**
 * The transit board editor (ADR-031): the declared structure in four sections, a live preview of
 * the board and its issues, and a save to the board store (the backend or the local sandbox).
 * Observed data is not editable; it merges onto the saved definition by ID.
 */
export function BoardEditorDialog({
  initial,
  revision,
  store,
  topology,
  serviceName,
  observed,
  fromExample = false,
  onClose,
  onSaved,
}: {
  initial: BoardDefinition;
  /** The stored revision; null creates a new stored definition (also when editing the example). */
  revision: string | null;
  store: BoardStore;
  topology: TopologyData;
  serviceName: string;
  /** Observed data to preview with (the example's), if any. */
  observed: TransitBoard | null;
  /** Editing the example board: saving stores the user's own copy, which then replaces the example. */
  fromExample?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<BoardDefinition>(() => structuredClone(initial));
  const [section, setSection] = useState<Section>('endpoints');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const index = useMemo(() => buildTopologyIndex(topology), [topology]);
  const issues = useMemo(() => validateBoardDefinition(draft, index), [draft, index]);
  const creating = revision === null;
  const where = store.kind === 'sandbox' ? 'the local sandbox (this browser only)' : 'the backend';

  const update = (change: (d: BoardDefinition) => BoardDefinition | undefined) => {
    setDraft((current) => {
      const next = structuredClone(current);
      return change(next) ?? next;
    });
    setErrors({});
  };

  /** Shows issues next to their fields, opening the section of the first and focusing it. */
  const showIssues = (list: readonly { path?: string | undefined; message: string }[]) => {
    const byPath: Record<string, string> = {};
    for (const i of list) if (i.path && !byPath[i.path]) byPath[i.path] = i.message;
    setErrors(byPath);
    const first = list.find((i) => i.path)?.path;
    if (!first) return;
    setSection(SECTION_OF[first.split(/[.[]/)[0] ?? ''] ?? 'endpoints');
    // After the section renders: open the row's <details> and focus the field.
    requestAnimationFrame(() => {
      const field = form.current?.querySelector<HTMLElement>(`[data-path="${first}"]`);
      field?.closest('details')?.setAttribute('open', '');
      field?.focus();
    });
  };

  const submit = async () => {
    setMessage(null);
    if (issues.length > 0) {
      showIssues(issues);
      setMessage(`${issues.length} issue${issues.length === 1 ? '' : 's'} to fix before saving.`);
      return;
    }
    setSaving(true);
    try {
      if (creating) await store.create(draft);
      else await store.replace(draft, revision);
      onSaved();
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 422) {
        showIssues(e.issues);
        setMessage(e.detail ?? 'The board is not valid.');
      } else if (e instanceof ApiError && e.status === 412) setMessage('Someone changed this board since it was loaded. Close the editor, reopen it, and apply your changes again.');
      else if (e instanceof ApiError && e.status === 409) setMessage('A board for this service was saved meanwhile. Close the editor and edit that one.');
      else setMessage(problemMessage(e));
    }
  };

  const title = creating && !fromExample ? `New transit board: ${serviceName}` : `Edit transit board: ${serviceName}`;
  const copyNote = fromExample ? ' This board is example data: saving stores your copy, which then replaces the example for this service.' : '';
  return (
    <Modal
      side
      wide
      title={title}
      description={`The declared structure: endpoints and their routes, stations, client policies, and tables. Saved to ${where}. Statistics and traces are observed, never typed in.${copyNote}`}
      onClose={onClose}
      closeLabel="Close the board editor"
      busy={saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? 'Saving…' : creating && !fromExample ? 'Create board' : 'Save board'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <form
          id={formId}
          ref={form}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex min-w-0 flex-col gap-3"
        >
          {message && (
            <p role="alert" className="m-0 rounded-lg border border-crit px-3 py-2 text-sm text-crit-fg">
              {message}
            </p>
          )}
          <Segmented aria-label="Board section" className="w-max">
            {SECTIONS.map((s) => (
              <Segment key={s.id} pressed={section === s.id} onClick={() => setSection(s.id)}>
                {s.label}
              </Segment>
            ))}
          </Segmented>
          {section === 'endpoints' && <LinesSection def={draft} update={update} errors={errors} />}
          {section === 'stations' && <StationsSection def={draft} update={update} errors={errors} topology={topology} />}
          {section === 'policies' && <PoliciesSection def={draft} update={update} errors={errors} />}
          {section === 'tables' && <TablesSection def={draft} update={update} errors={errors} />}
        </form>
        <Preview draft={draft} issues={issues} observed={observed} serviceName={serviceName} onIssue={(i) => showIssues([i])} />
      </div>
    </Modal>
  );
}

/** The board as it would look, and the issues still open; an issue links to its field. */
function Preview({
  draft,
  issues,
  observed,
  serviceName,
  onIssue,
}: {
  draft: BoardDefinition;
  issues: ReturnType<typeof validateBoardDefinition>;
  observed: TransitBoard | null;
  serviceName: string;
  onIssue: (issue: { path: string; message: string }) => void;
}) {
  // Routes through unknown stations cannot be drawn; everything else previews while you type.
  const drawable = !issues.some((i) => i.code === 'invalid-board-line');
  const preview = useMemo(() => {
    if (!drawable) return null;
    try {
      const index = indexBoard(boardFromDefinition(draft, { environmentId: observed?.environmentId ?? 'production', window: observed?.window ?? '24h', observed }));
      return { index, geometry: computeMapGeometry(index, { flat: true }) };
    } catch {
      return null;
    }
  }, [draft, observed, drawable]);
  return (
    <section aria-label="Preview" className="flex min-w-0 flex-col gap-2 min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:self-start">
      <Kicker as="h3">Preview</Kicker>
      <div className="rounded-lg border border-line bg-stage p-1">
        {preview ? (
          <TransitMap index={preview.index} geometry={preview.geometry} serviceName={serviceName} selectedId={null} matches={null} focusStations={new Set()} showStepStats={false} onSelect={() => {}} />
        ) : (
          <p className="m-0 p-4 text-sm text-fg-2">Fix the route issues to see the board.</p>
        )}
      </div>
      <p className="m-0 text-xs text-fg-3">
        {count(draft.lines.length, 'endpoint', 'endpoints')} · {count(draft.stations.length, 'station', 'stations')} · {count(draft.policies.length, 'policy', 'policies')} ·{' '}
        {count(draft.tables.length, 'table', 'tables')}
      </p>
      {issues.length === 0 ? (
        <p className="m-0 text-sm text-ok-fg" role="status">
          No issues: ready to save.
        </p>
      ) : (
        <section aria-label="Issues">
          <Kicker as="h3" className="mb-1">
            {issues.length} issue{issues.length === 1 ? '' : 's'}
          </Kicker>
          <ul className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-auto p-0">
            {issues.map((i, n) => (
              <li key={n}>
                <button type="button" className="text-left text-xs text-warn-fg underline" onClick={() => onIssue(i)} data-issue={i.code}>
                  {i.message}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
