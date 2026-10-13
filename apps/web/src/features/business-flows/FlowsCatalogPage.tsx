import { useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { businessFlowsIn } from '../../domain/businessFlow';
import { useTopology } from '../../data/topologyContext';
import { indexFlows } from '../../transit/flows/flowLayout';
import { flowFindings, flowSearchText } from '../../transit/flows/flowModel';
import { fieldClass, kickerClass } from '../../shared/ui/classes';
import { LoadState } from '../../shared/ui/LoadState';
import { useUiStore } from '../../state/uiStore';
import { Note } from '../pages/PageShell';
import { FlowBadge } from './FlowBadge';
import { NewFlowButton } from './FlowEditActions';
import { stripPageParams } from './flowVisuals';

/**
 * Business flows catalog (ADR-022, docs/BUSINESS_FLOWS.md §7): every flow with a step deployed in
 * the selected environment, searchable by flow, step, service, or event.
 */
export function FlowsCatalogPage() {
  const topology = useTopology();
  const environmentId = useUiStore((s) => s.environmentId);
  const { search } = useLocation();
  const [query, setQuery] = useState('');
  const inputId = useId();
  const index = topology.status === 'ready' ? topology.index : null;
  const resolved = useMemo(() => (index ? businessFlowsIn(index, environmentId) : []), [index, environmentId]);
  const fx = useMemo(() => indexFlows(resolved.map((r) => r.flow), (id) => index?.definitions.get(id)?.name ?? id), [resolved, index]);
  if (!index) {
    return (
      <div className="absolute inset-0 overflow-auto px-5 pt-[18px] pb-8">
        <h1 className="m-0 mb-3 text-xl font-semibold">Business flows</h1>
        <LoadState state={topology} />
      </div>
    );
  }
  const serviceName = (id: string) => index.definitions.get(id)?.name ?? id;
  const eventName = (id: string) => index.eventTypes.get(id)?.name ?? id;
  const q = query.trim().toLowerCase();
  const listed = resolved.filter((r) => !q || flowSearchText(r.flow, serviceName, eventName).includes(q));
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;

  return (
    <div className="absolute inset-0 flex flex-col gap-3.5 overflow-auto px-5 pt-[18px] pb-8 max-md:px-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h1 className="m-0 text-xl font-semibold">Business flows</h1>
        <span className="font-mono text-[11.5px] text-fg-3">
          {resolved.length} flow{resolved.length === 1 ? '' : 's'} · {environmentName}
        </span>
        <span className="ml-auto">
          <NewFlowButton />
        </span>
      </div>
      <p className="m-0 max-w-[720px] text-sm text-fg-2">
        Business processes across services, drawn as a transit network: steps in service bands, decisions and outcomes, and the policies on every hand-off. Open a flow for its board, statistics,
        findings, and transaction replay.
      </p>
      <label htmlFor={inputId} className="sr-only">
        Search flows
      </label>
      <input id={inputId} type="search" className={`${fieldClass} max-w-[420px]`} placeholder="Search flows, steps, services, or events" value={query} onChange={(e) => setQuery(e.target.value)} />
      {resolved.length === 0 ? (
        <Note>No business flows have a step in {environmentName}. Flows are created in the editor (with the backend) or imported from a flow file or BPMN.</Note>
      ) : listed.length === 0 ? (
        <Note>No flow matches “{query}”. Try a step such as “Capture”, a service, or an event such as “OrderPlaced”.</Note>
      ) : (
        <ul aria-label="Business flows" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3 p-0">
          {listed.map(({ flow, transitions, steps }) => {
            const warnings = flowFindings(flow, { eventName, serviceName }).filter((f) => f.severity === 'warn').length;
            const gaps = transitions.filter((t) => t.backing.status === 'unbacked').length;
            const notHere = steps.filter((s) => s.instanceId === null).length;
            const services = new Set(flow.steps.map((s) => s.serviceDefinitionId)).size;
            return (
              <li key={flow.id} className="rounded-xl border border-line bg-surface-1 p-4">
                <Link to={{ pathname: `/flows/${encodeURIComponent(flow.id)}`, search: stripPageParams(search) }} className="flex items-center gap-2.5 font-semibold hover:underline">
                  <FlowBadge fx={fx} flowId={flow.id} />
                  {flow.name}
                </Link>
                {flow.description && <p className="m-0 mt-1.5 text-sm text-fg-2">{flow.description}</p>}
                <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className={kickerClass}>Steps</dt>
                  <dd className="m-0 font-mono">
                    {flow.steps.length} in {services} services
                  </dd>
                  <dt className={kickerClass}>Owner</dt>
                  <dd className="m-0">{[flow.owner, flow.team].filter(Boolean).join(' / ') || '—'}</dd>
                  <dt className={kickerClass}>Source</dt>
                  <dd className="m-0">{flow.source.kind === 'imported' ? `imported (${flow.source.format})` : 'authored'}</dd>
                  <dt className={kickerClass}>Review</dt>
                  <dd className={`m-0 ${warnings ? 'text-warn-fg' : ''}`}>
                    {warnings} warning{warnings === 1 ? '' : 's'}
                    {gaps ? ` · ${gaps} unbacked` : ''}
                    {notHere ? ` · ${notHere} step${notHere === 1 ? '' : 's'} not deployed here` : ''}
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
