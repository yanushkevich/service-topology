import { useContext, useEffect, useId, useState } from 'react';
import { BUNDLE_MODULES, countsOf, type BundleIssue, type DataBundle, type ModuleCounts } from '../../data/bundle/bundle';
import { collectBundle } from '../../data/bundle/collect';
import { bundleFileName, formatOfFileName, readBundle, serializeBundle, type BundleFormat } from '../../data/bundle/format';
import { ApiError } from '../../data/http/apiClient';
import { useTopology, useTopologyEditing } from '../../data/topologyContext';
import type { TopologyData } from '../../domain/types';
import { TransitRepositoryContext } from '../../transit/repository';
import { downloadText } from '../../shared/download';
import { Button } from '../../shared/ui/primitives';
import { FormField } from '../../shared/ui/form';
import { cx, fieldClass } from '../../shared/ui/classes';
import { Row } from './SettingsRow';

/**
 * Export and import of all data as one JSON or YAML file (ADR-032, docs/DATA_BUNDLE.md): the
 * export is what the app has loaded; an import is checked and previewed before it replaces the
 * data in the sandbox or on the backend.
 */

const MAX_FILE_BYTES = 16 * 1024 * 1024;

type Counts = Record<keyof ModuleCounts, number | null>;

/** Counts of the loaded data; transit boards (stored or example) once they are listed. */
function useCurrentCounts(baseline: TopologyData | null): Counts | null {
  const transit = useContext(TransitRepositoryContext);
  const [boards, setBoards] = useState<{ of: TopologyData; n: number } | null>(null);
  useEffect(() => {
    if (!baseline) return;
    const controller = new AbortController();
    const services = new Set(baseline.serviceDefinitions.map((d) => d.id));
    transit
      .boardDefinitions(controller.signal)
      .then((defs) => setBoards({ of: baseline, n: defs.filter((d) => services.has(d.serviceDefinitionId)).length }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [baseline, transit]);
  if (!baseline) return null;
  return { ...countsOf(baseline), transitBoards: boards?.of === baseline ? boards.n : null };
}
const SHOWN_ISSUES = 20;

export function ExportDataRow() {
  const topology = useTopology();
  const { baseline } = useTopologyEditing();
  const transit = useContext(TransitRepositoryContext);
  const [busy, setBusy] = useState<BundleFormat | null>(null);
  const [message, setMessage] = useState('');
  const current = useCurrentCounts(baseline);
  if (topology.status !== 'ready' || !baseline || !current) return null;
  const viewingHistory = topology.history !== null;

  const exportAs = async (format: BundleFormat) => {
    setBusy(format);
    try {
      const bundle = await collectBundle({ topology: baseline, sourceLabel: topology.sourceLabel, isMock: topology.isMock, transit, now: new Date() });
      const name = bundleFileName(topology.sourceLabel, bundle.exportedAt, format);
      downloadText(name, serializeBundle(bundle, format), format === 'json' ? 'application/json' : 'application/yaml');
      setMessage(`Exported ${name}.`);
    } catch (error) {
      setMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Row
      label="Export data"
      hint={`Every module as one file: environments, services and their instances, infrastructure, relationships, event types, business flows, and transit boards (declared structure). Statistics and traces are not included.${viewingHistory ? ' You are viewing history: the export holds the current data, not the snapshot.' : ''}`}
    >
      <div className="flex flex-col items-start gap-1.5">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void exportAs('json')} disabled={busy !== null} data-export="json">
            {busy === 'json' ? 'Exporting…' : 'Export JSON'}
          </Button>
          <Button variant="secondary" onClick={() => void exportAs('yaml')} disabled={busy !== null} data-export="yaml">
            {busy === 'yaml' ? 'Exporting…' : 'Export YAML'}
          </Button>
        </div>
        <p role="status" className="m-0 text-sm text-fg-2">
          {message}
        </p>
      </div>
      <CountsTable label="What an export contains" columns={[{ heading: 'Current data', counts: current }]} />
    </Row>
  );
}

type Picked = { name: string; issues: BundleIssue[]; bundle: DataBundle | null };

export function ImportDataRow() {
  const topology = useTopology();
  const { baseline, importer, sandbox, reload } = useTopologyEditing();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const current = useCurrentCounts(baseline);
  if (topology.status !== 'ready' || !baseline || !current) return null;

  if (!importer) {
    return (
      <Row label="Import data" hint="Not available for generated datasets: they are rebuilt on every load. Switch to the built-in data (the local sandbox) or the backend to import a file.">
        <span className="text-sm text-fg-2">Unavailable</span>
      </Row>
    );
  }
  const where = sandbox ? 'the local sandbox (this browser only)' : 'the backend';

  const choose = async (file: File | undefined) => {
    setConfirming(false);
    setMessage('');
    if (!file) return setPicked(null);
    const format = formatOfFileName(file.name);
    const fail = (message: string) => setPicked({ name: file.name, bundle: null, issues: [{ code: 'bundle-unreadable', path: '', message }] });
    if (!format) return fail('Choose a .json, .yaml, or .yml file.');
    if (file.size > MAX_FILE_BYTES) return fail('The file is larger than 16 MB.');
    const read = readBundle(await file.text(), format);
    setPicked(read.ok ? { name: file.name, issues: [], bundle: read.bundle } : { name: file.name, issues: read.issues, bundle: null });
  };

  const replace = async (bundle: DataBundle) => {
    setBusy(true);
    try {
      const { counts } = await importer.importBundle(bundle);
      await reload();
      setPicked(null);
      setInputKey((k) => k + 1);
      setMessage(`Imported into ${where}: ${BUNDLE_MODULES.map((m) => `${counts[m.key]} ${m.label.toLowerCase()}`).join(', ')}.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) setPicked({ name: picked?.name ?? '', bundle: null, issues: error.issues.map((i) => ({ code: i.code, path: i.path ?? '', entityId: i.entityId, message: i.message })) });
      else if (error instanceof ApiError && error.status === 412) setMessage('The data changed since this page loaded it. Reload the page and import again.');
      else setMessage(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <Row label="Import data" hint={`Replaces all data in ${where} with a JSON or YAML file exported here. The file is checked and previewed first.`}>
      <div className="flex w-full flex-col gap-2">
        <FormField key={inputKey} label="Data file" hint=".json, .yaml, or .yml, up to 16 MB">
          {(control) => <input {...control} type="file" accept=".json,.yaml,.yml,application/json,application/yaml" className={cx(fieldClass, 'h-auto py-1')} onChange={(e) => void choose(e.target.files?.[0])} />}
        </FormField>
        {picked && <ImportPreview picked={picked} current={current} />}
        {picked?.bundle && (
          <div className="flex flex-wrap items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm">Replace all data in {where}?</span>
                <Button variant="danger" disabled={busy} onClick={() => picked.bundle && void replace(picked.bundle)}>
                  {busy ? 'Importing…' : 'Confirm replace'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Replace data
              </Button>
            )}
          </div>
        )}
        <p role="status" className="m-0 text-sm text-fg-2">
          {message}
        </p>
      </div>
    </Row>
  );
}

function ImportPreview({ picked, current }: { picked: Picked; current: Counts }) {
  const id = useId();
  const { issues, bundle } = picked;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5" data-import-preview={bundle ? 'ready' : 'invalid'}>
      <h3 id={id} className="m-0 text-sm font-semibold">
        {picked.name}
      </h3>
      {bundle ? (
        <>
          <p className="m-0 text-sm text-ok-fg">
            Ready to import. Exported {bundle.exportedAt} from “{bundle.source.label}”.
          </p>
          <CountsTable label="Current data and the file" columns={[{ heading: 'Now', counts: current }, { heading: 'In the file', counts: countsOf(bundle) }]} />
        </>
      ) : (
        <>
          <p className="m-0 text-sm text-crit-fg">
            {issues.length} issue{issues.length === 1 ? '' : 's'}: this file cannot be imported.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Issues">
            {issues.slice(0, SHOWN_ISSUES).map((issue, i) => (
              <li key={i}>
                <code className="font-mono text-xs text-fg-2">{issue.path || issue.entityId || issue.code}</code> {issue.message}
              </li>
            ))}
            {issues.length > SHOWN_ISSUES && <li className="text-fg-2">and {issues.length - SHOWN_ISSUES} more</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function CountsTable({ label, columns }: { label: string; columns: { heading: string; counts: Counts }[] }) {
  return (
    <table className="w-full basis-full border-collapse text-sm" aria-label={label}>
      <thead>
        <tr className="text-left text-xs text-fg-3">
          <th scope="col" className="py-1 font-medium">
            Module
          </th>
          {columns.map((c) => (
            <th key={c.heading} scope="col" className="py-1 text-right font-medium">
              {c.heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {BUNDLE_MODULES.map((m) => (
          <tr key={m.key} className="border-t border-line">
            <th scope="row" className="py-1 text-left font-normal text-fg-2">
              {m.label}
            </th>
            {columns.map((c) => (
              <td key={c.heading} className="py-1 text-right font-mono tabular-nums" data-module={m.key}>
                {c.counts[m.key] ?? '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
