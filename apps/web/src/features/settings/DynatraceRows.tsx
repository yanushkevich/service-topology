import { useEffect, useState } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { IntegrationStatus, SourceCheck, SourceIntegration } from '../../data/integrations/sourceIntegration';
import { useSourceIntegration } from '../../data/topologyContext';
import { Button } from '../../shared/ui/primitives';
import { cx, kickerClass } from '../../shared/ui/classes';
import { DynatraceAliases } from './DynatraceAliases';
import { DynatraceSync } from './DynatraceSync';
import { AUTH_LABELS, dateTime, observationText, summaryText } from './dynatraceText';
import { Row } from './SettingsRow';

/**
 * Settings → Data source → Dynatrace (ADR-034, docs/DYNATRACE_CONNECTOR.md): the connection the
 * backend is configured with, a connection check, a sync preview to apply, and the alias list.
 * Only with the backend API; the connection itself is configured on the server, never here.
 */
export function DynatraceRows() {
  const integration = useSourceIntegration();
  if (!integration) return null;
  return <DynatraceConnection integration={integration} />;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; connection: IntegrationStatus | null };

function DynatraceConnection({ integration }: { integration: SourceIntegration }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    integration
      .status(controller.signal)
      .then((connection) => setLoad({ status: 'ready', connection }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [integration, version]);
  const refresh = () => setVersion((v) => v + 1);

  const hint = 'Services, databases, Kubernetes, calls, health, and metrics from Smartscape on Grail. The connection is configured on the backend.';
  if (load.status !== 'ready') {
    return (
      <Row label="Dynatrace" hint={hint}>
        <span className="text-sm text-fg-2">{load.status === 'loading' ? 'Loading…' : `Unavailable: ${load.message}`}</span>
      </Row>
    );
  }
  const { connection } = load;
  if (!connection) {
    return (
      <Row label="Dynatrace" hint={hint}>
        <span className="text-sm text-fg-2">
          Not connected. Set <code className="font-mono">DYNATRACE_CONFIG_FILE</code> on the backend (docs/DYNATRACE_CONNECTOR.md).
        </span>
      </Row>
    );
  }
  return (
    <>
      <Row label="Dynatrace" hint={hint}>
        <ConnectionDetails connection={connection} />
      </Row>
      <ConnectionCheckRow integration={integration} />
      <DynatraceSync integration={integration} isExample={connection.isExample} onApplied={refresh} />
      <DynatraceAliases integration={integration} onSaved={refresh} />
    </>
  );
}

function ConnectionDetails({ connection }: { connection: IntegrationStatus }) {
  return (
    <dl className="m-0 grid w-full grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm" data-dynatrace-connection>
      <dt className="text-fg-2">Tenants</dt>
      <dd className="m-0">
        {connection.tenants.map((t) => (
          <span key={t.id} className="mr-2 inline-flex flex-wrap items-center gap-1.5">
            <span className="font-mono">{t.host}</span>
            <span className="text-fg-2">({AUTH_LABELS[t.auth]})</span>
            {t.isExample && <span className="tag tag-simulated">example tenant, invented data</span>}
          </span>
        ))}
      </dd>
      <dt className="text-fg-2">Environments</dt>
      <dd className="m-0">
        <ul className="m-0 list-none p-0">
          {connection.environments.map((e) => (
            <li key={e.id}>
              {e.name} <span className="text-fg-2">← {e.match}</span>
            </li>
          ))}
        </ul>
      </dd>
      <dt className="text-fg-2">Last sync</dt>
      <dd className="m-0">{connection.lastSync ? `${dateTime(connection.lastSync.appliedAt)}: ${summaryText(connection.lastSync.summary)}` : 'Never applied'}</dd>
      <dt className="text-fg-2">Health and metrics</dt>
      <dd className="m-0">{observationText(connection)}</dd>
    </dl>
  );
}

function ConnectionCheckRow({ integration }: { integration: SourceIntegration }) {
  const [checks, setChecks] = useState<SourceCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async () => {
    setBusy(true);
    setMessage('');
    try {
      const results = await integration.check();
      setChecks(results);
      setMessage(checkSummary(results));
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 409 ? 'A preview or check is already running. Try again when it finishes.' : `Check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row label="Connection check" hint="Runs every query once and reports what came back. Field names come from Dynatrace's public documentation; missing ones show up here.">
      <div className="flex w-full flex-col items-start gap-1.5">
        <Button variant="secondary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Checking…' : 'Check connection'}
        </Button>
        <p role="status" className="m-0 text-sm text-fg-2">
          {message}
        </p>
        {checks && checks.length > 0 && <CheckTable checks={checks} />}
      </div>
    </Row>
  );
}

/** One line about a check: failures first; all-empty results usually mean a missing bucket scope. */
function checkSummary(results: readonly SourceCheck[]): string {
  const failed = results.filter((c) => !c.ok).length;
  if (failed > 0) return `${failed} of ${results.length} queries failed.`;
  if (results.length > 0 && results.every((c) => c.records === 0)) return 'Every query returned nothing. Check that the token has storage:buckets:read.';
  return `All ${results.length} queries answered.`;
}

function CheckTable({ checks }: { checks: readonly SourceCheck[] }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm" aria-label="Connection check">
        <thead>
          <tr className={cx(kickerClass, 'text-left')}>
            <th scope="col" className="py-1 pr-3 font-normal">Query</th>
            <th scope="col" className="py-1 pr-3 font-normal">Result</th>
            <th scope="col" className="py-1 pr-3 text-right font-normal">Records</th>
            <th scope="col" className="py-1 font-normal">Notes</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={`${c.tenant}:${c.query}`} className="border-t border-line align-top" data-check={c.query} data-ok={c.ok}>
              <th scope="row" className="py-1.5 pr-3 text-left font-mono font-normal">
                {c.query}
              </th>
              <td className={cx('py-1.5 pr-3', c.ok ? 'text-ok-fg' : 'text-crit-fg')}>{c.ok ? 'OK' : 'Failed'}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{c.records}</td>
              <td className="py-1.5 text-fg-2">
                {[c.message, c.missingFields?.length ? `Missing fields: ${c.missingFields.join(', ')}` : '', `${c.durationMs} ms`].filter(Boolean).join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
