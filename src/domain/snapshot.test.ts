import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { diffTopology, parseSnapshot, SNAPSHOT_SCHEMA_VERSION, summarize, type TopologySnapshot } from './snapshot';

const snapshot = (overrides: Partial<TopologySnapshot> = {}): TopologySnapshot => ({
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  id: 'snap-1',
  label: 'Before incident',
  takenAt: '2026-10-11T06:00:00Z',
  source: 'fixture',
  isSimulated: true,
  data: structuredClone(mockTopology),
  ...overrides,
});

describe('TopologySnapshot', () => {
  it('round-trips through JSON with version and timestamp', () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot())));
    expect(parsed).toEqual(snapshot());
    expect(summarize(parsed!)).toEqual({ id: 'snap-1', label: 'Before incident', takenAt: '2026-10-11T06:00:00Z', source: 'fixture', isSimulated: true });
  });

  it.each([
    ['wrong version', { ...snapshot(), schemaVersion: 2 }],
    ['bad timestamp', snapshot({ takenAt: 'morning' })],
    ['unknown source', { ...snapshot(), source: 'guess' }],
    ['non-observed data claiming to be observed telemetry', snapshot({ source: 'fixture', isSimulated: false })],
    ['missing collection', { ...snapshot(), data: { ...mockTopology, relationships: undefined } }],
    [
      'invalid topology (dangling reference)',
      snapshot({ data: { ...structuredClone(mockTopology), relationships: [{ ...mockTopology.relationships[0]!, targetEntityId: 'ghost' }] } }),
    ],
  ])('rejects %s', (_name, value) => {
    expect(parseSnapshot(value)).toBeNull();
  });
});

describe('diffTopology', () => {
  it('reports nothing for identical data', () => {
    expect(diffTopology(mockTopology, structuredClone(mockTopology))).toEqual([]);
  });

  it('reports health, status, additions and removals in a stable order', () => {
    const after = structuredClone(mockTopology);
    after.serviceInstances.find((i) => i.id === 'payment-service.production')!.health = 'unavailable';
    after.resources.find((r) => r.id === 'rds-orders-prod')!.health = 'degraded';
    after.relationships.find((r) => r.id === 'rel:order-service.production->payment-service.production')!.status = 'degraded';
    after.serviceInstances = after.serviceInstances.filter((i) => i.id !== 'order-service.development');
    after.relationships = after.relationships.filter((r) => r.sourceEntityId !== 'order-service.development');
    expect(diffTopology(mockTopology, after)).toEqual([
      { type: 'health-changed', kind: 'resource', id: 'rds-orders-prod', from: 'healthy', to: 'degraded' },
      { type: 'health-changed', kind: 'service-instance', id: 'payment-service.production', from: 'healthy', to: 'unavailable' },
      { type: 'status-changed', kind: 'relationship', id: 'rel:order-service.production->payment-service.production', from: 'active', to: 'degraded' },
      { type: 'removed', kind: 'relationship', id: 'rel:order-service.development->catalog-service.development' },
      { type: 'removed', kind: 'service-instance', id: 'order-service.development' },
    ]);
  });
});
