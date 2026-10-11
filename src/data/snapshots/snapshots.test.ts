import { describe, expect, it } from 'vitest';
import { mockSnapshots } from '../mock/snapshots';
import { diffTopology, parseSnapshot } from '../../domain/snapshot';
import { createInMemorySnapshotRepository } from './SnapshotRepository';

describe('snapshot fixtures', () => {
  it('are valid v1 snapshots of simulated fixture data, in time order', () => {
    const fixtures = mockSnapshots();
    for (const s of fixtures) expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(fixtures.map((s) => s.takenAt)).toEqual([...fixtures.map((s) => s.takenAt)].sort());
    expect(fixtures.every((s) => s.source === 'fixture' && s.isSimulated)).toBe(true);
  });

  it('contain no timestamps later than the moment they describe', () => {
    for (const s of mockSnapshots()) {
      const times = [...s.data.serviceInstances, ...s.data.resources, ...s.data.relationships].flatMap((e) => [
        e.updatedAt,
        e.metrics?.observedAt,
      ]);
      for (const t of times) if (t) expect(Date.parse(t)).toBeLessThanOrEqual(Date.parse(s.takenAt));
    }
  });

  it('describe a developing incident', () => {
    const [before, lag, outage] = mockSnapshots();
    const first = diffTopology(before!.data, lag!.data);
    expect(first).toContainEqual({ type: 'health-changed', kind: 'resource', id: 'rds-inventory-prod', from: 'healthy', to: 'degraded' });
    const second = diffTopology(lag!.data, outage!.data);
    expect(second).toContainEqual({ type: 'health-changed', kind: 'service-instance', id: 'notification-service.production', from: 'healthy', to: 'unavailable' });
    expect(diffTopology(before!.data, outage!.data)).toContainEqual({ type: 'added', kind: 'service-instance', id: 'email-dispatcher.production' });
  });
});

describe('in-memory snapshot repository', () => {
  it('lists summaries oldest first, returns copies, and validates saves', async () => {
    const repo = createInMemorySnapshotRepository(mockSnapshots());
    expect((await repo.list()).map((s) => s.id)).toEqual(['fixture-0600', 'fixture-0730', 'fixture-0845']);
    const a = await repo.get('fixture-0600');
    a!.data.serviceInstances.length = 0;
    expect((await repo.get('fixture-0600'))!.data.serviceInstances.length).toBeGreaterThan(0);
    expect(await repo.get('missing')).toBeNull();
    await expect(repo.save({ ...a!, takenAt: 'never' })).rejects.toThrow();
  });
});
