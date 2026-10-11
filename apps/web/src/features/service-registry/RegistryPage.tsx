import { useMemo, useState } from 'react';
import { useTopology } from '../../data/topologyContext';
import {
  buildRegistryRows,
  filterRegistryRows,
  inEnvironment,
  matchesFilters,
  sortRegistryRows,
  type RegistrySort,
  type RegistrySortKey,
} from '../../domain/registry';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { providerLabel, typeLabel } from '../../shared/mappings';
import { formatTimestamp } from '../../shared/format';
import { DataSourceTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { LoadState } from '../../shared/ui/LoadState';
import { useUiStore } from '../../state/uiStore';
import { FilterBar } from '../filters/FilterBar';
import { InspectorPanel } from '../inspector/InspectorPanel';

const COLUMNS: readonly { key: RegistrySortKey; label: string }[] = [
  { key: 'name', label: 'Resource' },
  { key: 'type', label: 'Type' },
  { key: 'provider', label: 'Provider' },
  { key: 'owner', label: 'Owner' },
  { key: 'health', label: 'Health' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'updated', label: 'Updated' },
];

export function RegistryPage() {
  const topology = useTopology();

  return (
    <div className="absolute inset-0 flex max-md:flex-col">
      <div className="flex min-w-0 flex-1 flex-col px-5 pt-[18px] max-md:min-h-0 max-md:px-3 max-md:pt-3">
        {topology.status === 'ready' ? (
          <Registry index={topology.index} sourceLabel={topology.sourceLabel} isMock={topology.isMock} />
        ) : (
          <>
            <h1 className="m-0 text-xl font-semibold">Service Registry</h1>
            <LoadState state={topology} />
          </>
        )}
      </div>
      <InspectorPanel />
    </div>
  );
}

function Registry({ index, sourceLabel, isMock }: { index: TopologyIndex; sourceLabel: string; isMock: boolean }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const setEnvironmentId = useUiStore((s) => s.setEnvironmentId);
  const filters = useUiStore((s) => s.filters);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const [sort, setSort] = useState<RegistrySort>({ key: 'health', direction: 'asc' });

  const allRows = useMemo(() => buildRegistryRows(index), [index]);
  const environmentRows = useMemo(
    () => allRows.filter((row) => inEnvironment(row, environmentId)),
    [allRows, environmentId],
  );
  const rows = useMemo(
    () => sortRegistryRows(filterRegistryRows(allRows, filters, environmentId), sort),
    [allRows, filters, environmentId, sort],
  );

  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  const selectedRow = selection ? allRows.find((row) => row.ref.id === selection.id) : undefined;
  const selectionHidden = selectedRow !== undefined && !rows.some((row) => row.ref.id === selectedRow.ref.id);

  const revealSelection = () => {
    if (!selectedRow) return;
    if (!inEnvironment(selectedRow, environmentId) && selectedRow.environmentId) {
      setEnvironmentId(selectedRow.environmentId);
    }
    if (!matchesFilters(selectedRow, filters)) resetFilters();
  };

  const toggleSort = (key: RegistrySortKey) =>
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-xl font-semibold">Service Registry</h1>
        <span className={`font-mono text-[11.5px] text-fg-3`} aria-live="polite">
          {rows.length} of {environmentRows.length} in {environmentName}
        </span>
        <DataSourceTag sourceLabel={sourceLabel} isMock={isMock} />
      </div>

      <FilterBar rows={environmentRows} label="Filter registry" />

      {selectionHidden && selectedRow && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5 rounded-[9px] border border-dashed border-line-strong px-[11px] py-2 text-sm text-fg-2 [&_b]:text-fg" role="status">
          <span>
            Selected <b>{selectedRow.name}</b> is hidden by the current{' '}
            {inEnvironment(selectedRow, environmentId) ? 'filters' : 'environment'}.
          </span>
          <button type="button" className="h-7 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={revealSelection}>
            Show it
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-t-xl border border-b-0 border-line bg-surface-1">
        <table className="w-full min-w-[900px] border-collapse [&_th]:sticky [&_th]:top-0 [&_th]:z-2 [&_th]:h-[34px] [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3.5 [&_th]:text-left [&_th]:font-normal [&_td]:h-11 [&_td]:border-b [&_td]:border-line [&_td]:px-3.5 [&_td]:whitespace-nowrap [&_td]:text-fg-2 [&_td.font-mono]:text-[11.5px] [&_td:first-child]:max-w-[320px] [&_tbody_tr:not([aria-selected=true]):hover]:bg-surface-3 [&_tbody_tr[aria-selected=true]]:bg-accent-soft [&_tbody_tr[aria-selected=true]]:shadow-[inset_0_0_0_1px_var(--color-accent-ring)]" aria-label={`Registry entities in ${environmentName}`}>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  <button type="button" className="inline-flex items-center gap-1 text-[10px] tracking-[0.08em] text-fg-3 uppercase hover:text-fg [[aria-sort]_&]:text-fg" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    <span aria-hidden="true" className="w-[1ch]">
                      {sort.key === column.key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selection?.id === row.ref.id;
              return (
                <tr key={row.ref.id}  aria-selected={selected}>
                  <td>
                    <button
                      type="button"
                      className="flex min-h-11 w-full min-w-0 items-center gap-2.5 text-left"
                      onClick={() => select(row.ref)}
                      aria-pressed={selected}
                    >
                      <TypeGlyph type={row.type} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[12.5px] font-semibold text-fg">{row.name}</span>
                        <span className={`font-mono truncate text-[10px] text-fg-3`}>{row.ref.id}</span>
                      </span>
                    </button>
                  </td>
                  <td>{typeLabel(row.type)}</td>
                  <td>{providerLabel(row.provider)}</td>
                  <td>{row.team ?? row.owner ?? <span className="text-fg-3">Unassigned</span>}</td>
                  <td>
                    <StatusShape health={row.health} label />
                  </td>
                  <td className="font-mono">
                    <span aria-label={`${row.outgoingCount} outgoing, ${row.incomingCount} incoming`}>
                      {row.outgoingCount} out · {row.incomingCount} in
                    </span>
                  </td>
                  <td className={`font-mono text-fg-3`}>{formatTimestamp(row.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="px-5 py-14 text-center">
            {environmentRows.length === 0 ? (
              <>
                <p className="m-0 text-lg font-semibold">No entities in {environmentName}</p>
                <p className="mt-1.5 mb-3.5 text-fg-2">The repository has no service instances or resources for this environment.</p>
              </>
            ) : (
              <>
                <p className="m-0 text-lg font-semibold">No matches</p>
                <p className="mt-1.5 mb-3.5 text-fg-2">No entities in {environmentName} match the current search and filters.</p>
                <button type="button" className="h-7 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={resetFilters}>
                  Clear filters
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
