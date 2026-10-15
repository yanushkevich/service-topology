import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { SourceIntegration } from '../../data/integrations/sourceIntegration';
import { useTopologyEditing } from '../../data/topologyContext';
import { Button } from '../../shared/ui/primitives';
import { SelectInput, TextInput } from '../../shared/ui/form';
import { Row } from './SettingsRow';

/**
 * The alias list (ADR-034): a Dynatrace service name mapped to a service that exists here, so the
 * next sync links it instead of adding a new service (for example PaymentService → Payment
 * Service). Revision-guarded on the backend.
 */

type Pair = { key: number; name: string; serviceId: string };

export function DynatraceAliases({ integration, onSaved }: { integration: SourceIntegration; onSaved: () => void }) {
  const { baseline } = useTopologyEditing();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    integration
      .aliases(controller.signal)
      .then((stored) => {
        const entries = Object.entries(stored.aliases).sort(([a], [b]) => a.localeCompare(b));
        setPairs(entries.map(([name, serviceId], key) => ({ key, name, serviceId })));
        setNextKey(entries.length);
        setRevision(stored.revision);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(`Aliases unavailable: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => controller.abort();
  }, [integration]);

  const services = useMemo(
    () => (baseline?.serviceDefinitions ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })).sort((a, b) => a.label.localeCompare(b.label)),
    [baseline],
  );
  if (!pairs) {
    return (
      <Row label="Aliases" hint="Dynatrace service names mapped to services here.">
        <span className="text-sm text-fg-2">{message || 'Loading…'}</span>
      </Row>
    );
  }

  const change = (key: number, patch: Partial<Pair>) => setPairs(pairs.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const add = () => {
    setPairs([...pairs, { key: nextKey, name: '', serviceId: '' }]);
    setNextKey(nextKey + 1);
  };
  const problem = aliasProblem(pairs);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await integration.saveAliases(Object.fromEntries(pairs.map((p) => [p.name.trim(), p.serviceId])), revision);
      setRevision(saved.revision);
      setMessage(`Saved ${pairs.length} alias${pairs.length === 1 ? '' : 'es'}. The next preview uses them.`);
      onSaved();
    } catch (error) {
      setMessage(error instanceof ApiError && error.status === 412 ? 'Someone else changed the aliases. Reload the page to see them.' : `Not saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row label="Aliases" hint="When a Dynatrace service has another name than the service here, map it, so a sync links them instead of adding a second service.">
      <div className="flex w-full flex-col items-start gap-2">
        {pairs.length === 0 && <p className="m-0 text-sm text-fg-2">No aliases. Names that match a service ID (as a slug) link on their own.</p>}
        <ul aria-label="Aliases" className="m-0 flex w-full list-none flex-col gap-2 p-0">
          {pairs.map((p, i) => (
            <li key={p.key} className="grid w-full grid-cols-[1fr_1fr_auto] items-end gap-2 max-md:grid-cols-1">
              <TextInput label={`Dynatrace name ${i + 1}`} compact mono value={p.name} onChange={(name) => change(p.key, { name })} />
              <SelectInput label={`Service for alias ${i + 1}`} compact value={p.serviceId} options={services} onChange={(serviceId) => change(p.key, { serviceId })} />
              <Button variant="secondary" onClick={() => setPairs(pairs.filter((q) => q.key !== p.key))} aria-label={`Remove alias ${i + 1}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={add}>
            Add alias
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || problem !== null}>
            {busy ? 'Saving…' : 'Save aliases'}
          </Button>
          {problem && <span className="text-sm text-fg-2">{problem}</span>}
        </div>
        <p role="status" className="m-0 text-sm text-fg-2">
          {message}
        </p>
      </div>
    </Row>
  );
}

/** Why the list cannot be saved yet, or null. */
function aliasProblem(pairs: readonly Pair[]): string | null {
  if (pairs.some((p) => p.name.trim() === '' || p.serviceId === '')) return 'Give every alias a name and a service.';
  const names = pairs.map((p) => p.name.trim());
  if (new Set(names).size !== names.length) return 'Each Dynatrace name can have one alias.';
  return null;
}
