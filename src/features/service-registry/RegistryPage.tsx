import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTopology } from '../../data/topologyContext';
import {
  buildRegistryRows,
  ENTITY_GROUPS,
  filterRegistryRows,
  hasActiveFilters,
  inEnvironment,
  matchesFilters,
  sortRegistryRows,
  type RegistrySort,
  type RegistrySortKey,
} from '../../domain/registry';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { HEALTH_STATUSES, PROVIDERS, type Provider } from '../../domain/types';
import { GROUP_LABELS, healthLabel, providerLabel, typeLabel } from '../../shared/mappings';
import { formatTimestamp } from '../../shared/format';
import { DataSourceTag } from '../../shared/ui/DataSourceTag';
import { StatusShape } from '../../shared/ui/StatusShape';
import { TypeGlyph } from '../../shared/ui/TypeGlyph';
import { LoadState } from '../../shared/ui/LoadState';
import { toggleValue, useUiStore } from '../../state/uiStore';
import { InspectorPanel } from '../inspector/InspectorPanel';
import styles from './registry.module.css';

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
    <div className={styles.page}>
      <div className={styles.main}>
        {topology.status === 'ready' ? (
          <Registry index={topology.index} sourceLabel={topology.sourceLabel} isMock={topology.isMock} />
        ) : (
          <>
            <h1 className={styles.title}>Service Registry</h1>
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
  const setFilters = useUiStore((s) => s.setFilters);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const [sort, setSort] = useState<RegistrySort>({ key: 'health', direction: 'asc' });
  const searchId = useId();

  const allRows = useMemo(() => buildRegistryRows(index), [index]);
  const environmentRows = useMemo(
    () => allRows.filter((row) => inEnvironment(row, environmentId)),
    [allRows, environmentId],
  );
  const rows = useMemo(
    () => sortRegistryRows(filterRegistryRows(allRows, filters, environmentId), sort),
    [allRows, filters, environmentId, sort],
  );
  // Providers present in this environment; filter chips for absent providers would only produce empty results.
  const providers = useMemo(
    () => PROVIDERS.filter((p) => environmentRows.some((row) => row.provider === p)),
    [environmentRows],
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
      <div className={styles.heading}>
        <h1 className={styles.title}>Service Registry</h1>
        <span className={`mono ${styles.count}`} aria-live="polite">
          {rows.length} of {environmentRows.length} in {environmentName}
        </span>
        <DataSourceTag sourceLabel={sourceLabel} isMock={isMock} />
      </div>

      <div className={styles.filters} role="search" aria-label="Filter registry">
        <label htmlFor={searchId} className="visually-hidden">
          Search by name, ID, owner, or team
        </label>
        <input
          id={searchId}
          className={styles.input}
          type="search"
          placeholder="Search name, ID, owner, team"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
        />
        <ChipGroup label="Kind">
          {ENTITY_GROUPS.filter((g) => environmentRows.some((row) => row.group === g)).map((group) => (
            <Chip
              key={group}
              pressed={filters.groups.includes(group)}
              onClick={() => setFilters({ groups: toggleValue(filters.groups, group) })}
            >
              {GROUP_LABELS[group]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Health">
          {HEALTH_STATUSES.map((health) => (
            <Chip
              key={health}
              pressed={filters.health.includes(health)}
              onClick={() => setFilters({ health: toggleValue(filters.health, health) })}
            >
              <StatusShape health={health} />
              {healthLabel(health)}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Provider">
          {providers.map((provider: Provider) => (
            <Chip
              key={provider}
              pressed={filters.providers.includes(provider)}
              onClick={() => setFilters({ providers: toggleValue(filters.providers, provider) })}
            >
              {providerLabel(provider)}
            </Chip>
          ))}
        </ChipGroup>
        {hasActiveFilters(filters) && (
          <button type="button" className={styles.clear} onClick={resetFilters}>
            Clear filters
          </button>
        )}
      </div>

      {selectionHidden && selectedRow && (
        <div className={styles.notice} role="status">
          <span>
            Selected <b>{selectedRow.name}</b> is hidden by the current{' '}
            {inEnvironment(selectedRow, environmentId) ? 'filters' : 'environment'}.
          </span>
          <button type="button" className={styles.clear} onClick={revealSelection}>
            Show it
          </button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={`Registry entities in ${environmentName}`}>
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
                  <button type="button" className={styles.sortButton} onClick={() => toggleSort(column.key)}>
                    {column.label}
                    <span aria-hidden="true" className={styles.sortMark}>
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
                <tr key={row.ref.id} className={selected ? styles.selected : undefined} aria-selected={selected}>
                  <td>
                    <button
                      type="button"
                      className={styles.rowButton}
                      onClick={() => select(row.ref)}
                      aria-pressed={selected}
                    >
                      <TypeGlyph type={row.type} />
                      <span className={styles.nameBlock}>
                        <span className={styles.name}>{row.name}</span>
                        <span className={`mono ${styles.id}`}>{row.ref.id}</span>
                      </span>
                    </button>
                  </td>
                  <td>{typeLabel(row.type)}</td>
                  <td>{providerLabel(row.provider)}</td>
                  <td>{row.team ?? row.owner ?? <span className={styles.muted}>Unassigned</span>}</td>
                  <td>
                    <StatusShape health={row.health} label />
                  </td>
                  <td className="mono">
                    <span aria-label={`${row.outgoingCount} outgoing, ${row.incomingCount} incoming`}>
                      {row.outgoingCount} out · {row.incomingCount} in
                    </span>
                  </td>
                  <td className={`mono ${styles.muted}`}>{formatTimestamp(row.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className={styles.empty}>
            {environmentRows.length === 0 ? (
              <>
                <p className={styles.emptyTitle}>No entities in {environmentName}</p>
                <p className={styles.emptyBody}>The repository has no service instances or resources for this environment.</p>
              </>
            ) : (
              <>
                <p className={styles.emptyTitle}>No matches</p>
                <p className={styles.emptyBody}>No entities in {environmentName} match the current search and filters.</p>
                <button type="button" className={styles.clear} onClick={resetFilters}>
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

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.chipGroup} role="group" aria-label={label}>
      {children}
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={styles.chip} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
