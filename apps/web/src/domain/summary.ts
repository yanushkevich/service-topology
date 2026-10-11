import { buildRegistryRows, inEnvironment, type RegistryRow } from './registry';
import { environmentOf, type TopologyIndex } from './topologyIndex';
import type { EntityId, HealthStatus, Provider } from './types';

/** Counts for the Overview page (PRODUCT_SPEC Revision 5 §K.1). */
export interface EnvironmentSummary {
  instances: number;
  resources: number;
  relationships: number;
  byHealth: Record<HealthStatus, number>;
  byProvider: { provider: Provider; entities: number; unhealthy: number }[];
  /** Unhealthy rows, worst first. */
  needsAttention: RegistryRow[];
}

const SEVERITY: Record<HealthStatus, number> = { unavailable: 0, degraded: 1, unknown: 2, healthy: 3 };

export function environmentSummary(index: TopologyIndex, environmentId: EntityId): EnvironmentSummary {
  const rows = buildRegistryRows(index).filter((row) => inEnvironment(row, environmentId));
  const byHealth: Record<HealthStatus, number> = { healthy: 0, degraded: 0, unavailable: 0, unknown: 0 };
  const providers = new Map<Provider, { entities: number; unhealthy: number }>();
  for (const row of rows) {
    byHealth[row.health]++;
    const p = providers.get(row.provider) ?? { entities: 0, unhealthy: 0 };
    p.entities++;
    if (row.health === 'degraded' || row.health === 'unavailable') p.unhealthy++;
    providers.set(row.provider, p);
  }
  const inEnv = (id: EntityId) => {
    const env = environmentOf(index, id);
    return env === undefined || env === environmentId;
  };
  const relationships = index.data.relationships.filter((r) => {
    const s = environmentOf(index, r.sourceEntityId);
    const t = environmentOf(index, r.targetEntityId);
    return (s === environmentId || t === environmentId) && inEnv(r.sourceEntityId) && inEnv(r.targetEntityId);
  }).length;
  return {
    instances: rows.filter((r) => r.ref.kind === 'service-instance').length,
    resources: rows.filter((r) => r.ref.kind === 'resource').length,
    relationships,
    byHealth,
    byProvider: [...providers.entries()]
      .map(([provider, v]) => ({ provider, ...v }))
      .sort((a, b) => b.entities - a.entities || a.provider.localeCompare(b.provider)),
    needsAttention: rows
      .filter((r) => r.health === 'degraded' || r.health === 'unavailable')
      .sort((a, b) => SEVERITY[a.health] - SEVERITY[b.health] || a.name.localeCompare(b.name)),
  };
}
