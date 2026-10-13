import { describe, expect, it } from 'vitest';
import { mockTopology } from '../data/mock/topology';
import { buildTopologyIndex } from '../domain/topologyIndex';
import { applyLinks, linkDependencies, linksKey } from './links';
import { paymentServiceBoard } from './mock/paymentServiceBoard';

const board = paymentServiceBoard('production');

const index = buildTopologyIndex(mockTopology);

describe('dependencies linked to the topology (ADR-027)', () => {
  const links = linkDependencies(board, index, 'production');

  it('resolves services and resources in the environment, and flags what the topology lacks', () => {
    expect(links.get('dep:pg')).toMatchObject({ status: 'linked', name: 'payments-db', kind: 'resource', type: 'database', ref: { kind: 'resource', id: 'pg-payments-prod' } });
    expect(links.get('dep:replica')).toMatchObject({ status: 'linked', name: 'payments-db' });
    expect(links.get('dep:ledger')).toMatchObject({ status: 'linked', name: 'Ledger Service', kind: 'service', ref: { kind: 'service-instance' } });
    expect(links.get('dep:card')).toMatchObject({ status: 'linked', kind: 'resource' }); // external: shared by every environment
    expect(links.get('dep:redis')).toEqual({ status: 'not-in-topology' });
    // payments-db belongs to production; in staging the link says so instead of pretending.
    expect(linkDependencies(board, index, 'staging').get('dep:pg')).toEqual({ status: 'not-in-environment', entityId: 'pg-payments-prod' });
  });

  it('takes names and health from the topology, and adds a finding where a line reaches an unlinked dependency', () => {
    const down = structuredClone(mockTopology);
    const pg = down.resources.find((r) => r.id === 'pg-payments-prod')!;
    pg.health = 'unavailable';
    const linked = applyLinks(board, linkDependencies(board, buildTopologyIndex(down), 'production'));
    expect(linked.stations.find((s) => s.id === 'dep:pg')).toMatchObject({ name: 'payments-db', status: 'down' });
    const getPayment = linked.lines.find((l) => l.id === 'A5')!;
    expect(getPayment.findings.filter((f) => f.ruleId === 'dependency-not-in-topology').map((f) => f.stationIds)).toEqual([['dep:redis']]);
    expect(linked.lines.find((l) => l.id === 'A2')!.findings.some((f) => f.ruleId === 'dependency-not-in-topology')).toBe(false);
  });

  it('keys only on links and linked health, so unrelated topology changes keep the board', () => {
    const other = structuredClone(mockTopology);
    other.serviceInstances[0]!.health = 'degraded'; // not a dependency of the board
    expect(linksKey(linkDependencies(board, buildTopologyIndex(other), 'production'))).toBe(linksKey(links));
  });
});
