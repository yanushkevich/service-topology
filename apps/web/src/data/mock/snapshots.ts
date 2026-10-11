import { SNAPSHOT_SCHEMA_VERSION, type TopologySnapshot } from '../../domain/snapshot';
import type { HealthStatus, RelationshipStatus, TopologyData } from '../../domain/types';
import { mockTopology } from './topology';

/**
 * Deterministic history fixtures for the mock inventory (Milestone 3 "as of" / compare workflow).
 * Derived from the current mock so IDs always line up. All values are fictional and simulated.
 */

interface Overrides {
  health?: Record<string, HealthStatus>;
  status?: Record<string, RelationshipStatus>;
  removeInstances?: string[];
  at: string;
}

/** A snapshot cannot contain timestamps after the moment it describes. */
function clampTimes<T extends { updatedAt?: string; metrics?: { observedAt?: string } }>(entity: T, at: string): T {
  const late = (t?: string) => t !== undefined && t > at;
  return {
    ...entity,
    ...(late(entity.updatedAt) ? { updatedAt: at } : {}),
    ...(entity.metrics && late(entity.metrics.observedAt) ? { metrics: { ...entity.metrics, observedAt: at } } : {}),
  };
}

function variant(base: TopologyData, o: Overrides): TopologyData {
  const removed = new Set(o.removeInstances ?? []);
  const clamped: TopologyData = {
    ...base,
    serviceInstances: base.serviceInstances.map((i) => clampTimes(i, o.at)),
    resources: base.resources.map((r) => clampTimes(r, o.at)),
    relationships: base.relationships.map((r) => clampTimes(r, o.at)),
  };
  base = clamped;
  return {
    ...base,
    serviceInstances: base.serviceInstances
      .filter((i) => !removed.has(i.id))
      .map((i) => (o.health?.[i.id] ? { ...i, health: o.health[i.id] as HealthStatus, updatedAt: o.at } : i)),
    resources: base.resources.map((r) => (o.health?.[r.id] ? { ...r, health: o.health[r.id] as HealthStatus, updatedAt: o.at } : r)),
    relationships: base.relationships
      .filter((r) => !removed.has(r.sourceEntityId) && !removed.has(r.targetEntityId))
      .map((r) => (o.status?.[r.id] ? { ...r, status: o.status[r.id] as RelationshipStatus, updatedAt: o.at } : r)),
  };
}

const HEALTHY_BEFORE_INCIDENT = {
  'notification-service.production': 'healthy',
  'queue-notifications-email-prod': 'healthy',
  'inventory-service.production': 'healthy',
  'rds-inventory-prod': 'healthy',
  'fraud-scoring.production': 'healthy',
} as const;

const ACTIVE_BEFORE_INCIDENT = {
  'rel:order-service.production->inventory-service.production': 'active',
  'rel:inventory-service.production->rds-inventory-prod': 'active',
  'rel:topic-orders-events-prod->notification-service.production': 'active',
  'rel:notification-service.production->exchange-notifications-prod': 'active',
  'rel:payment-service.production->fraud-scoring.production': 'active',
} as const;

const snapshot = (id: string, label: string, takenAt: string, data: TopologyData): TopologySnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  id,
  label,
  takenAt,
  source: 'fixture',
  isSimulated: true,
  data,
});

export function mockSnapshots(base: TopologyData = mockTopology): TopologySnapshot[] {
  return [
    snapshot(
      'fixture-0600',
      'Before incident',
      '2026-10-11T06:00:00Z',
      variant(base, {
        at: '2026-10-11T06:00:00Z',
        health: HEALTHY_BEFORE_INCIDENT,
        status: ACTIVE_BEFORE_INCIDENT,
        removeInstances: ['email-dispatcher.production'],
      }),
    ),
    snapshot(
      'fixture-0730',
      'Inventory DB replica lag',
      '2026-10-11T07:30:00Z',
      variant(base, {
        at: '2026-10-11T07:30:00Z',
        health: { ...HEALTHY_BEFORE_INCIDENT, 'rds-inventory-prod': 'degraded', 'inventory-service.production': 'degraded' },
        status: {
          ...ACTIVE_BEFORE_INCIDENT,
          'rel:order-service.production->inventory-service.production': 'degraded',
          'rel:inventory-service.production->rds-inventory-prod': 'degraded',
        },
      }),
    ),
    snapshot('fixture-0845', 'Notification outage (recorded)', '2026-10-11T08:45:00Z', structuredClone(base)),
  ];
}
