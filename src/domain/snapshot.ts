import type { EntityId, EntityKind, HealthStatus, RelationshipStatus, TopologyData } from './types';
import { validateTopology } from './validation';

/**
 * Point-in-time topology (ARCHITECTURE Revision 2 §5, `TopologySnapshot`). JSON Schema:
 * docs/schemas/topology-snapshot.v1.schema.json. Snapshots are read-only values: browsing one never
 * changes current state.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Where a snapshot's data came from. Only `observed` would be real telemetry (none exists yet). */
export type SnapshotSource = 'fixture' | 'simulation' | 'observed';

export interface SnapshotSummary {
  id: string;
  label: string;
  /** When the state was true (ISO 8601). */
  takenAt: string;
  source: SnapshotSource;
  /** True unless the data is observed telemetry. */
  isSimulated: boolean;
}

export interface TopologySnapshot extends SnapshotSummary {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  data: TopologyData;
}

export function summarize(snapshot: TopologySnapshot): SnapshotSummary {
  const { id, label, takenAt, source, isSimulated } = snapshot;
  return { id, label, takenAt, source, isSimulated };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates an untrusted snapshot (storage, future API). Returns null unless it is a valid v1 snapshot. */
export function parseSnapshot(value: unknown): TopologySnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
  const { id, label, takenAt, source, isSimulated, data } = value;
  if (typeof id !== 'string' || !id || typeof label !== 'string' || typeof takenAt !== 'string') return null;
  if (Number.isNaN(Date.parse(takenAt))) return null;
  if (source !== 'fixture' && source !== 'simulation' && source !== 'observed') return null;
  if (typeof isSimulated !== 'boolean' || (source !== 'observed' && !isSimulated)) return null;
  if (!isRecord(data)) return null;
  for (const key of ['environments', 'serviceDefinitions', 'serviceInstances', 'resources', 'relationships']) {
    if (!Array.isArray(data[key])) return null;
  }
  const topology = data as unknown as TopologyData;
  if (validateTopology(topology).some((issue) => issue.severity === 'error')) return null;
  return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, id, label, takenAt, source, isSimulated, data: topology };
}

export type SnapshotChange =
  | { type: 'added' | 'removed'; kind: EntityKind; id: EntityId }
  | { type: 'health-changed'; kind: 'service-instance' | 'resource'; id: EntityId; from: HealthStatus; to: HealthStatus }
  | { type: 'status-changed'; kind: 'relationship'; id: EntityId; from: RelationshipStatus; to: RelationshipStatus };

/** Structural and health differences from `before` to `after`, sorted by kind then ID. */
export function diffTopology(before: TopologyData, after: TopologyData): SnapshotChange[] {
  const changes: SnapshotChange[] = [];
  const compare = <T extends { id: EntityId }>(
    kind: EntityKind,
    a: readonly T[],
    b: readonly T[],
    changed?: (x: T, y: T) => SnapshotChange | null,
  ) => {
    const left = new Map(a.map((x) => [x.id, x]));
    const right = new Map(b.map((x) => [x.id, x]));
    for (const [id, x] of left) {
      const y = right.get(id);
      if (!y) changes.push({ type: 'removed', kind, id });
      else if (changed) {
        const change = changed(x, y);
        if (change) changes.push(change);
      }
    }
    for (const id of right.keys()) if (!left.has(id)) changes.push({ type: 'added', kind, id });
  };

  compare('environment', before.environments, after.environments);
  compare('service-definition', before.serviceDefinitions, after.serviceDefinitions);
  compare('service-instance', before.serviceInstances, after.serviceInstances, (x, y) =>
    x.health !== y.health ? { type: 'health-changed', kind: 'service-instance', id: x.id, from: x.health, to: y.health } : null,
  );
  compare('resource', before.resources, after.resources, (x, y) => {
    const from = x.health ?? 'unknown';
    const to = y.health ?? 'unknown';
    return from !== to ? { type: 'health-changed', kind: 'resource', id: x.id, from, to } : null;
  });
  compare('relationship', before.relationships, after.relationships, (x, y) =>
    x.status !== y.status ? { type: 'status-changed', kind: 'relationship', id: x.id, from: x.status, to: y.status } : null,
  );

  const order: Record<SnapshotChange['type'], number> = { 'health-changed': 0, 'status-changed': 1, added: 2, removed: 3 };
  return changes.sort((a, b) => order[a.type] - order[b.type] || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
