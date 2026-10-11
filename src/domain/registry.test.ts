import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import {
  buildRegistryRows,
  EMPTY_FILTERS,
  filterRegistryRows,
  hasActiveFilters,
  sortRegistryRows,
  type RegistryRow,
} from './registry';
import { buildTopologyIndex } from './topologyIndex';

const index = buildTopologyIndex(mockTopology);
const rows = buildRegistryRows(index);
const ids = (list: readonly RegistryRow[]) => list.map((r) => r.ref.id);

describe('registry rows', () => {
  it('lists every instance and communicating resource, but no containment levels', () => {
    expect(ids(rows)).toContain('order-service.staging');
    expect(ids(rows)).toContain('topic-orders-events-prod');
    expect(ids(rows)).not.toContain('eks-commerce-prod');
    expect(ids(rows)).not.toContain('order-service'); // logical definitions are not rows
    expect(new Set(ids(rows)).size).toBe(rows.length);
  });

  it('keys rows by canonical kind and ID', () => {
    const row = rows.find((r) => r.ref.id === 'payment-service.production')!;
    expect(row.ref).toEqual({ kind: 'service-instance', id: 'payment-service.production' });
    expect(row).toMatchObject({ name: 'Payment Service', provider: 'azure', environmentId: 'production' });
    expect(row.outgoingCount).toBe(4);
    expect(row.incomingCount).toBe(1);
  });

  it('inherits environment through containment and reports unknown health when unmodeled', () => {
    expect(rows.find((r) => r.ref.id === 'queue-notifications-email-prod')?.environmentId).toBe('production');
    const saas = rows.find((r) => r.ref.id === 'ext-card-processor')!;
    expect(saas.environmentId).toBeUndefined();
  });
});

describe('filterRegistryRows', () => {
  it('scopes to an environment and always keeps environment-independent rows', () => {
    const staging = filterRegistryRows(rows, EMPTY_FILTERS, 'staging');
    expect(ids(staging)).toContain('order-service.staging');
    expect(ids(staging)).toContain('ext-card-processor');
    expect(ids(staging)).not.toContain('order-service.production');
    expect(filterRegistryRows(rows, EMPTY_FILTERS, null)).toHaveLength(rows.length);
  });

  it('matches every search term against name, ID, owner, and team', () => {
    const result = filterRegistryRows(rows, { ...EMPTY_FILTERS, query: 'payments  topic' }, 'production');
    expect(ids(result)).toEqual(['topic-payments-events-prod']);
    expect(ids(filterRegistryRows(rows, { ...EMPTY_FILTERS, query: 'ENGAGEMENT' }, 'production'))).toEqual(
      expect.arrayContaining(['notification-service.production', 'email-dispatcher.production']),
    );
  });

  it('combines provider, health, and group filters with AND across fields and OR within one', () => {
    const result = filterRegistryRows(
      rows,
      { ...EMPTY_FILTERS, providers: ['aws', 'azure'], health: ['degraded', 'unavailable'], groups: ['service'] },
      'production',
    );
    expect(ids(result).sort()).toEqual(['fraud-scoring.production', 'inventory-service.production']);
  });

  it('detects active filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '  ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, groups: ['data'] })).toBe(true);
  });
});

describe('sortRegistryRows', () => {
  it('sorts by health severity, then canonical ID for ties', () => {
    const prod = filterRegistryRows(rows, EMPTY_FILTERS, 'production');
    const sorted = sortRegistryRows(prod, { key: 'health', direction: 'asc' });
    expect(sorted[0]!.health).toBe('unavailable');
    expect(sorted.at(-1)!.health).toBe('healthy');
    expect(sortRegistryRows(prod, { key: 'health', direction: 'asc' })).toEqual(sorted);
  });

  it('sorts by name in both directions without mutating the input', () => {
    const input = [...rows];
    const asc = sortRegistryRows(input, { key: 'name', direction: 'asc' });
    const desc = sortRegistryRows(input, { key: 'name', direction: 'desc' });
    expect(asc[0]!.name.localeCompare(asc.at(-1)!.name)).toBeLessThanOrEqual(0);
    expect(desc[0]!.name).toBe(asc.at(-1)!.name);
    expect(input).toEqual(rows);
  });
});
