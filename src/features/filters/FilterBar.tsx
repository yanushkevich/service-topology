import { useId, type ReactNode } from 'react';
import { ENTITY_GROUPS, hasActiveFilters, type RegistryRow } from '../../domain/registry';
import { HEALTH_STATUSES, PROVIDERS } from '../../domain/types';
import { GROUP_LABELS, healthLabel, providerLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { toggleValue, useUiStore } from '../../state/uiStore';
import styles from './filterBar.module.css';

/**
 * Shared filters (search, kind, health, provider). Every view reads the same store state, so
 * filtering the registry also filters the map and vice versa.
 */
export function FilterBar({ rows, label, showSearch = true }: { rows: readonly RegistryRow[]; label: string; showSearch?: boolean }) {
  const filters = useUiStore((s) => s.filters);
  const setFilters = useUiStore((s) => s.setFilters);
  const resetFilters = useUiStore((s) => s.resetFilters);
  const searchId = useId();
  // Only offer chips that can match something in scope.
  const groups = ENTITY_GROUPS.filter((g) => rows.some((row) => row.group === g) || filters.groups.includes(g));
  const providers = PROVIDERS.filter((p) => rows.some((row) => row.provider === p) || filters.providers.includes(p));

  return (
    <div className={styles.filters} role="search" aria-label={label}>
      {showSearch && (
        <>
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
        </>
      )}
      <ChipGroup label="Kind">
        {groups.map((group) => (
          <Chip key={group} pressed={filters.groups.includes(group)} onClick={() => setFilters({ groups: toggleValue(filters.groups, group) })}>
            {GROUP_LABELS[group]}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Health">
        {HEALTH_STATUSES.map((health) => (
          <Chip key={health} pressed={filters.health.includes(health)} onClick={() => setFilters({ health: toggleValue(filters.health, health) })}>
            <StatusShape health={health} />
            {healthLabel(health)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup label="Provider">
        {providers.map((provider) => (
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
