import { useId, type ReactNode } from 'react';
import { ENTITY_GROUPS, hasActiveFilters, type RegistryRow } from '../../domain/registry';
import { HEALTH_STATUSES, PROVIDERS } from '../../domain/types';
import { GROUP_LABELS, healthLabel, providerLabel } from '../../shared/mappings';
import { StatusShape } from '../../shared/ui/StatusShape';
import { Chip } from '../../shared/ui/primitives';
import { toggleValue, useUiStore } from '../../state/uiStore';

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
    <div className="my-3.5 flex flex-wrap items-center gap-x-3 gap-y-2" role="search" aria-label={label}>
      {showSearch && (
        <>
          <label htmlFor={searchId} className="sr-only">
            Search by name, ID, owner, or team
          </label>
          <input
            id={searchId}
            className="h-8 min-w-0 flex-[0_1_240px] rounded-md border border-control bg-surface-2 px-2.5 text-fg placeholder:text-fg-3"
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
        <button type="button" className="h-7 rounded-md border border-line-strong px-3 whitespace-nowrap text-fg hover:bg-surface-3" onClick={resetFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-l border-line-strong pl-3 max-md:border-l-0 max-md:pl-0" role="group" aria-label={label}>
      {children}
    </div>
  );
}
