import { useId, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTopology } from '../../data/topologyContext';
import { analyzeImpact, PROPAGATION_RULES } from '../../domain/propagation';
import { buildRegistryRows, inEnvironment, matchesFilters, EMPTY_FILTERS } from '../../domain/registry';
import { endpointName, kindOfId, type TopologyIndex } from '../../domain/topologyIndex';
import { dependencyTree, type DependencyEntry } from '../../domain/traversal';
import type { EntityId, EntityRef } from '../../domain/types';
import { healthLabel, patternLabel, protocolLabel, typeLabel } from '../../shared/mappings';
import { buttonClass, fieldClass, kickerClass } from '../../shared/ui/classes';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { useSimulationStore } from '../../state/simulationStore';
import { useUiStore } from '../../state/uiStore';
import { Card, Note, PageShell } from '../pages/PageShell';

/**
 * Dependencies (PRODUCT_SPEC Revision 5 §K.2): upstream/downstream analysis for one entity and a
 * read-only "if this failed" preview using the propagation rules.
 */
export function DependenciesPage() {
  return <PageShell title="Dependencies">{(index) => <DependenciesContent index={index} />}</PageShell>;
}

function useEntityInfo(index: TopologyIndex) {
  return (id: EntityId) => {
    const instance = index.instances.get(id);
    const resource = index.resources.get(id);
    const type = instance ? (index.definitions.get(instance.serviceDefinitionId)?.category ?? 'other') : (resource?.type ?? 'other');
    const health = instance?.health ?? resource?.health ?? 'unknown';
    const ref: EntityRef | null = instance ? { kind: 'service-instance', id } : resource ? { kind: 'resource', id } : null;
    return { name: endpointName(index, id), type, health, ref };
  };
}

function DependenciesContent({ index }: { index: TopologyIndex }) {
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const topology = useTopology();
  const history = topology.status === 'ready' ? topology.history : null;
  const target =
    selection && (selection.kind === 'service-instance' || selection.kind === 'resource') && kindOfId(index, selection.id) ? selection.id : null;

  return (
    <>
      <EntityPicker index={index} current={target} onPick={select} />
      {!target ? (
        <Note>
          {selection
            ? 'Dependencies are analyzed for service instances and resources. Pick one above (relationships and logical services are shown in the inspector).'
            : 'Pick a service instance or resource to see what it depends on, what depends on it, and what would be affected if it failed.'}
        </Note>
      ) : (
        <Analysis index={index} target={target} readOnly={history !== null} />
      )}
    </>
  );
}

/** Searchable picker over the environment's instances and resources (keyboard: type, Tab, Enter). */
function EntityPicker({ index, current, onPick }: { index: TopologyIndex; current: EntityId | null; onPick: (ref: EntityRef) => void }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const [query, setQuery] = useState('');
  const inputId = useId();
  const rows = useMemo(() => buildRegistryRows(index).filter((r) => inEnvironment(r, environmentId)), [index, environmentId]);
  const matches = query.trim() ? rows.filter((r) => matchesFilters(r, { ...EMPTY_FILTERS, query })).slice(0, 8) : [];
  const currentName = current ? endpointName(index, current) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <label htmlFor={inputId} className="text-sm text-fg-2">
          Entity
        </label>
        <input
          id={inputId}
          type="search"
          className={`${fieldClass} w-[300px]`}
          placeholder={currentName ? `Analyzing ${currentName}. Search to change` : 'Search services and resources'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {currentName && (
          <span className="text-sm text-fg-2">
            Analyzing <b className="text-fg">{currentName}</b>
          </span>
        )}
      </div>
      {matches.length > 0 && (
        <ul className="m-0 flex max-w-[640px] list-none flex-col rounded-lg border border-line bg-surface-1 p-1" aria-label="Matching entities">
          {matches.map((row) => (
            <li key={row.ref.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                onClick={() => {
                  onPick(row.ref);
                  setQuery('');
                }}
              >
                <TypeGlyph type={row.type} size={14} />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="font-mono text-xs text-fg-3">{row.ref.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Analysis({ index, target, readOnly }: { index: TopologyIndex; target: EntityId; readOnly: boolean }) {
  const info = useEntityInfo(index);
  const upstream = useMemo(() => dependencyTree(index, target, 'upstream'), [index, target]);
  const downstream = useMemo(() => dependencyTree(index, target, 'downstream'), [index, target]);
  // Read-only what-if over the data being viewed; never touches simulation state.
  const impacts = useMemo(() => analyzeImpact(index, [{ entityId: target, mode: 'unavailable' }]), [index, target]);
  const navigate = useNavigate();
  const { search } = useLocation();
  const t = info(target);
  const inject = () => {
    useSimulationStore.getState().inject(target, 'unavailable');
    navigate({ pathname: '/events', search });
  };
  const neighborhoodOnMap = () => {
    const ui = useUiStore.getState();
    ui.setNeighborhood({ centerId: target, depth: 1 });
    ui.setActiveView('2d');
    navigate({ pathname: '/map', search });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-line bg-surface-1 px-4 py-3">
        <TypeGlyph type={t.type} size={20} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{t.name}</div>
          <div className="font-mono text-xs text-fg-3">
            {typeLabel(t.type)} · {target}
          </div>
        </div>
        <StatusShape health={t.health} label />
        <button type="button" className={buttonClass('secondary')} onClick={neighborhoodOnMap}>
          Show neighborhood on map
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <DependencyList
          title="Upstream: what it depends on"
          empty={`${t.name} depends on nothing modeled.`}
          entries={upstream}
          index={index}
        />
        <DependencyList
          title="Downstream: what depends on it"
          empty={`Nothing modeled depends on ${t.name}.`}
          entries={downstream}
          index={index}
        />
      </div>

      <Card
        title={`If ${t.name} became unavailable`}
        aside={
          <>
            <SimulatedTag simulated />
            <span className="text-sm text-fg-2">Preview from the propagation rules; nothing is changed.</span>
          </>
        }
      >
        {impacts.length === 0 ? (
          <Note>No other entity would be affected by the modeled rules (e.g. only asynchronous consumers depend on it).</Note>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="Affected entities">
            {impacts.map((impact) => {
              const a = info(impact.entityId);
              const rule = PROPAGATION_RULES.find((r) => r.id === impact.ruleId);
              const via = impact.viaRelationshipId ? index.relationships.get(impact.viaRelationshipId) : undefined;
              return (
                <li key={impact.entityId} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
                  <StatusShape health={impact.effect} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => a.ref && useUiStore.getState().select(a.ref)}>
                    <span className="font-semibold">{a.name}</span>{' '}
                    <span className="text-sm text-fg-2">
                      would be {healthLabel(impact.effect).toLowerCase()}: {rule?.title ?? impact.ruleId}, via {endpointName(index, impact.causeId)}
                      {via ? ` (${protocolLabel(via.protocol)})` : ' (containment)'}
                    </span>
                  </button>
                  <span className="font-mono text-xs text-fg-3">{impact.path.length - 1} hop{impact.path.length > 2 ? 's' : ''}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClass('danger')} onClick={inject} disabled={readOnly}>
            Simulate this failure
          </button>
          {readOnly && <span className="self-center text-sm text-fg-2">Unavailable while browsing history.</span>}
        </div>
      </Card>
    </>
  );
}

function DependencyList({ title, empty, entries, index }: { title: string; empty: string; entries: DependencyEntry[]; index: TopologyIndex }) {
  const info = useEntityInfo(index);
  const select = useUiStore((s) => s.select);
  const direct = entries.filter((e) => e.depth === 1);
  const transitive = entries.filter((e) => e.depth > 1);
  const render = (list: DependencyEntry[]) => (
    <ul className="m-0 list-none p-0">
      {list.map((entry) => {
        const e = info(entry.entityId);
        const via = index.relationships.get(entry.viaRelationshipId);
        return (
          <li key={entry.entityId} className="border-t border-line py-1.5 first:border-t-0">
            <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => e.ref && select(e.ref)}>
              <TypeGlyph type={e.type} size={13} />
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              {via && <span className="font-mono text-[10px] text-fg-3">{protocolLabel(via.protocol)} · {patternLabel(via.pattern).toLowerCase()}</span>}
              <StatusShape health={e.health} />
            </button>
            {entry.depth > 1 && (
              <div className="pl-6 text-xs text-fg-3">
                {entry.depth} hops: {entry.path.map((id) => endpointName(index, id)).join(' → ')}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <Card title={title} aside={<span className="font-mono text-sm text-fg-3">{entries.length}</span>}>
      {entries.length === 0 ? (
        <Note>{empty}</Note>
      ) : (
        <>
          <h3 className={`m-0 mb-1 ${kickerClass}`}>Direct ({direct.length})</h3>
          {render(direct)}
          {transitive.length > 0 && (
            <>
              <h3 className={`m-0 mt-3 mb-1 ${kickerClass}`}>Transitive ({transitive.length})</h3>
              {render(transitive)}
            </>
          )}
        </>
      )}
    </Card>
  );
}
