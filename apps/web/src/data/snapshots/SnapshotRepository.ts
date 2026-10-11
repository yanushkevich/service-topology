import { parseSnapshot, summarize, type SnapshotSummary, type TopologySnapshot } from '../../domain/snapshot';

/** History boundary; a future API adapter (GET /api/v1/topology/snapshots) implements the same interface. */
export interface SnapshotRepository {
  /** Oldest first. */
  list(): Promise<SnapshotSummary[]>;
  get(id: string): Promise<TopologySnapshot | null>;
  /** Store a captured snapshot (e.g. of the current simulation). */
  save(snapshot: TopologySnapshot): Promise<void>;
}

/** In-memory history seeded with fixtures. Captures last for the session only. */
export function createInMemorySnapshotRepository(initial: readonly TopologySnapshot[] = []): SnapshotRepository {
  let snapshots = initial.map((s) => structuredClone(s));
  const byTime = (a: SnapshotSummary, b: SnapshotSummary) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id);
  return {
    async list() {
      return snapshots.map(summarize).sort(byTime);
    },
    async get(id) {
      const found = snapshots.find((s) => s.id === id);
      return found ? structuredClone(found) : null;
    },
    async save(snapshot) {
      const valid = parseSnapshot(JSON.parse(JSON.stringify(snapshot)));
      if (!valid) throw new Error('Refusing to save an invalid snapshot');
      snapshots = [...snapshots.filter((s) => s.id !== valid.id), valid];
    },
  };
}
