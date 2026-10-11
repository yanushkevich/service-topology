/// <reference types="node" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockSnapshots } from '../data/mock/snapshots';
import { mockTopology } from '../data/mock/topology';
import { buildRegistryRows, filterRegistryRows, REGISTRY_SORT_KEYS, sortRegistryRows, type EntityFilters, type RegistryRow } from '../domain/registry';
import { buildTopologyIndex } from '../domain/topologyIndex';
import type { TopologyData } from '../domain/types';
import { validateTopology, type ValidationIssue } from '../domain/validation';

/**
 * Shared fixtures for the Go backend (docs/backend/TESTING_AND_PERFORMANCE.md, ADR-015). The
 * TypeScript implementation is the reference: expected validation codes are computed here, and the
 * Go conformance tests must produce the same ones.
 *
 * Regenerate after changing the mock or validation rules:  npm run fixtures:update
 * Otherwise this test fails when the committed files differ from what the code produces.
 */

// Vitest runs with apps/web as the working directory (also via the root package.json proxy).
const ROOT = resolve(process.cwd(), '../../fixtures');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

const T = '2026-10-11T08:00:00Z';

/** Small, valid topology exercising every rule's happy path; each case breaks exactly one thing. */
function base(): TopologyData {
  return {
    environments: [
      { id: 'prod', name: 'Production', kind: 'production' },
      { id: 'stg', name: 'Staging', kind: 'staging' },
    ],
    serviceDefinitions: [
      { id: 'svc-api', name: 'API', category: 'api', protocols: ['https', 'kafka', 'rabbitmq', 'postgresql'] },
      { id: 'svc-worker', name: 'Worker', category: 'worker', protocols: ['kafka', 'rabbitmq'] },
    ],
    resources: [
      { id: 'acct', name: 'account', type: 'account', provider: 'aws', environmentId: 'prod' },
      { id: 'cluster', name: 'cluster', type: 'cluster', provider: 'aws', parentResourceId: 'acct' },
      { id: 'ns', name: 'namespace', type: 'namespace', provider: 'aws', parentResourceId: 'cluster' },
      { id: 'db', name: 'db', type: 'database', provider: 'aws', parentResourceId: 'acct', health: 'healthy' },
      { id: 'broker', name: 'broker', type: 'broker', provider: 'on-prem', parentResourceId: 'acct' },
      { id: 'topic', name: 'orders', type: 'topic', provider: 'on-prem', parentResourceId: 'broker' },
      { id: 'exchange', name: 'notify', type: 'exchange', provider: 'on-prem', parentResourceId: 'broker' },
      { id: 'queue', name: 'notify.email', type: 'queue', provider: 'on-prem', parentResourceId: 'broker' },
      { id: 'saas', name: 'Payments SaaS', type: 'external-resource', provider: 'saas' },
      { id: 'acct-stg', name: 'account-stg', type: 'account', provider: 'aws', environmentId: 'stg' },
      { id: 'ns-stg', name: 'namespace-stg', type: 'namespace', provider: 'aws', parentResourceId: 'acct-stg' },
    ],
    serviceInstances: [
      { id: 'api.prod', serviceDefinitionId: 'svc-api', environmentId: 'prod', provider: 'aws', health: 'healthy', resourceId: 'ns', updatedAt: T },
      { id: 'worker.prod', serviceDefinitionId: 'svc-worker', environmentId: 'prod', provider: 'aws', health: 'degraded', resourceId: 'ns', updatedAt: T },
      { id: 'api.stg', serviceDefinitionId: 'svc-api', environmentId: 'stg', provider: 'aws', health: 'healthy', resourceId: 'ns-stg', updatedAt: T },
    ],
    relationships: [
      rel('r-db', 'api.prod', 'db', 'postgresql', 'database'),
      rel('r-pub', 'api.prod', 'topic', 'kafka', 'asynchronous'),
      rel('r-sub', 'topic', 'worker.prod', 'kafka', 'asynchronous'),
      rel('r-ex', 'api.prod', 'exchange', 'rabbitmq', 'asynchronous'),
      { ...rel('r-bind', 'exchange', 'queue', 'rabbitmq', 'asynchronous'), metadata: { bindingKey: 'notify.email.*' } },
      rel('r-read', 'queue', 'worker.prod', 'rabbitmq', 'asynchronous'),
      rel('r-saas', 'api.prod', 'saas', 'https', 'synchronous'),
      rel('r-saas-stg', 'api.stg', 'saas', 'https', 'synchronous'),
    ],
    eventTypes: [
      { id: 'evt-created', name: 'Created', channelResourceIds: ['topic'], producerServiceIds: ['svc-api'], consumerServiceIds: ['svc-worker'] },
      { id: 'evt-notify', name: 'NotifyRequested', channelResourceIds: ['exchange'], producerServiceIds: ['svc-api'], consumerServiceIds: ['svc-worker'] },
    ],
  };
}

function rel(id: string, sourceEntityId: string, targetEntityId: string, protocol: TopologyData['relationships'][number]['protocol'], pattern: TopologyData['relationships'][number]['pattern']) {
  return { id, sourceEntityId, targetEntityId, protocol, pattern, direction: 'unidirectional' as const, status: 'active' as const, updatedAt: T };
}

type Mutate = (d: TopologyData) => void;
const instance = (d: TopologyData, id: string) => d.serviceInstances.find((i) => i.id === id)!;
const resource = (d: TopologyData, id: string) => d.resources.find((r) => r.id === id)!;
const relationship = (d: TopologyData, id: string) => d.relationships.find((r) => r.id === id)!;
const eventType = (d: TopologyData, id: string) => d.eventTypes!.find((e) => e.id === id)!;

/** One case per rule (some rules have two shapes). Names are stable file names. */
const CASES: Record<string, { description: string; mutate: Mutate }> = {
  'empty-id': { description: 'A definition with an empty ID', mutate: (d) => void d.serviceDefinitions.push({ id: ' ', name: 'Blank', category: 'other', protocols: [] }) },
  'duplicate-id': { description: 'A resource reuses an instance ID (IDs are unique across collections)', mutate: (d) => void d.resources.push({ id: 'api.prod', name: 'dup', type: 'database', provider: 'aws' }) },
  'missing-environment-unknown': { description: 'Instance references an unknown environment', mutate: (d) => void (instance(d, 'worker.prod').environmentId = 'ghost') },
  'missing-environment-null': {
    description: 'Instance environmentId is not a string (untyped adapter data)',
    mutate: (d) => void ((instance(d, 'worker.prod') as unknown as Record<string, unknown>).environmentId = null),
  },
  'missing-environment-resource': { description: 'Resource references an unknown environment', mutate: (d) => void (resource(d, 'saas').environmentId = 'ghost') },
  'missing-service-definition': { description: 'Instance references an unknown definition', mutate: (d) => void (instance(d, 'api.stg').serviceDefinitionId = 'ghost-def') },
  'missing-resource': { description: 'Instance host does not exist', mutate: (d) => void (instance(d, 'api.stg').resourceId = 'ghost-host') },
  'missing-parent': { description: 'Resource parent does not exist', mutate: (d) => void (resource(d, 'ns-stg').parentResourceId = 'ghost-parent') },
  'parent-cycle': { description: 'Containment cycle account → cluster → namespace → account', mutate: (d) => void (resource(d, 'acct').parentResourceId = 'ns') },
  'missing-relationship-endpoint': { description: 'Relationship target does not exist', mutate: (d) => void (relationship(d, 'r-saas').targetEntityId = 'ghost') },
  'invalid-relationship-endpoint-containment': { description: 'Relationship targets a containment-only resource', mutate: (d) => void (relationship(d, 'r-saas').targetEntityId = 'cluster') },
  'invalid-relationship-endpoint-kind': { description: 'Relationship targets a service definition, not an instance or resource', mutate: (d) => void (relationship(d, 'r-saas').targetEntityId = 'svc-worker') },
  'self-relationship': { description: 'Relationship connects an entity to itself', mutate: (d) => void (relationship(d, 'r-saas').targetEntityId = 'api.prod') },
  'environment-mismatch': { description: 'Staging instance runs in a production namespace', mutate: (d) => void (instance(d, 'api.stg').resourceId = 'ns') },
  'environment-conflict': { description: 'Namespace changes the environment it inherits', mutate: (d) => void (resource(d, 'ns').environmentId = 'stg') },
  'cross-environment-relationship': { description: 'Staging instance talks to a production database', mutate: (d) => void (relationship(d, 'r-saas-stg').targetEntityId = 'db') },
  'invalid-binding-target': { description: 'Exchange routes straight to a consumer', mutate: (d) => void (relationship(d, 'r-bind').targetEntityId = 'worker.prod') },
  'missing-event-channel': { description: 'Event type references an unknown channel', mutate: (d) => void (eventType(d, 'evt-created').channelResourceIds = ['ghost-topic']) },
  'invalid-event-channel': { description: 'Event type channel is a database', mutate: (d) => void (eventType(d, 'evt-created').channelResourceIds = ['db']) },
  'duplicate-event-channel-environment': {
    description: 'Event type has two channels in production',
    mutate: (d) => void (eventType(d, 'evt-created').channelResourceIds = ['topic', 'queue']),
  },
  'missing-event-service': { description: 'Event type references an unknown service definition', mutate: (d) => void (eventType(d, 'evt-created').consumerServiceIds = ['ghost-service']) },
  'event-flow-missing-relationship-producer': {
    description: 'Producer has no relationship to the channel',
    mutate: (d) => void (eventType(d, 'evt-created').producerServiceIds = ['svc-worker']),
  },
  'event-flow-missing-relationship-consumer': {
    description: 'Consumer reads nothing from the channel (direction matters)',
    mutate: (d) => void (eventType(d, 'evt-created').consumerServiceIds = ['svc-api']),
  },
};

type Expected = Pick<ValidationIssue, 'severity' | 'code' | 'entityId'>;
const expected = (data: TopologyData): Expected[] => validateTopology(data).map(({ severity, code, entityId }) => ({ severity, code, entityId }));

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Valid topology whose names stress collation: case, punctuation, digits, accents, spaces. */
function collationTopology(): TopologyData {
  const names = ['zeta', 'Alpha', 'alpha', 'Échange', 'echo', 'beta-2', 'beta_2', 'beta.2', 'Beta 10', 'beta 9', '_hidden', '9lives', 'ALPHA-ONE', 'alpha.one', 'Ölmotor', 'omega'];
  const owners = [undefined, 'payments', 'Payments', 'ops', 'Ops-Team', 'ops_team', undefined, 'Zed'];
  return {
    environments: [{ id: 'prod', name: 'Production', kind: 'production' }],
    serviceDefinitions: [],
    serviceInstances: [],
    resources: names.map((name, i) => ({
      id: `res-${String(i).padStart(2, '0')}`,
      name,
      type: (['database', 'topic', 'queue', 'cache', 'external-resource'] as const)[i % 5]!,
      provider: (['aws', 'azure', 'gcp', 'on-prem', 'saas'] as const)[i % 5]!,
      environmentId: i % 4 === 0 ? undefined : 'prod',
      health: (['healthy', 'degraded', 'unavailable', undefined] as const)[i % 4],
      owner: owners[i % owners.length],
      updatedAt: i % 3 === 0 ? undefined : `2026-10-${String(1 + (i % 9)).padStart(2, '0')}T08:00:00Z`,
    })).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as unknown as TopologyData['resources'][number]),
    relationships: [],
  };
}

/** Registry rows as the API returns them (RegistryRow in docs/api/openapi.json). */
const apiRow = (full: RegistryRow) => {
  const row: Partial<RegistryRow> = { ...full };
  delete row.searchText; // client-only search index, not part of the API row
  return apiRowFields(row as Omit<RegistryRow, 'searchText'>);
};
const apiRowFields = (row: Omit<RegistryRow, 'searchText'>) => ({
  ...row,
  environmentId: row.environmentId ?? null,
  owner: row.owner ?? null,
  team: row.team ?? null,
  updatedAt: row.updatedAt ?? null,
});

const SORTS = REGISTRY_SORT_KEYS.flatMap((key) => [
  { name: key, sort: { key, direction: 'asc' as const } },
  { name: `-${key}`, sort: { key, direction: 'desc' as const } },
]);

function registryCases(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const topologies: Record<string, TopologyData> = { 'topology/mock.v1.json': mockTopology, 'topology/collation.v1.json': collationTopology() };
  const filterSets: Record<string, EntityFilters> = {
    'no-filters': { query: '', providers: [], health: [], groups: [] },
    'query-pay': { query: 'pay', providers: [], health: [], groups: [] },
    'query-two-terms-upper': { query: '  ORDER   prod ', providers: [], health: [], groups: [] },
    'providers-aws-gcp': { query: '', providers: ['aws', 'gcp'], health: [], groups: [] },
    'health-unhealthy': { query: '', providers: [], health: ['degraded', 'unavailable'], groups: [] },
    'groups-messaging-data': { query: '', providers: [], health: [], groups: ['messaging', 'data'] },
    combined: { query: 'e', providers: ['aws', 'on-prem', 'gcp'], health: ['healthy', 'degraded'], groups: ['service', 'messaging'] },
  };
  for (const [topologyFile, data] of Object.entries(topologies)) {
    const rows = buildRegistryRows(buildTopologyIndex(data));
    const envs = topologyFile.includes('mock') ? ['production', 'staging', 'development'] : ['prod'];
    const tag = topologyFile.includes('mock') ? 'mock' : 'collation';
    for (const env of envs) {
      for (const { name: sortName, sort } of SORTS) {
        // Every sort on the unfiltered environment; filters on the default sort (health) plus name.
        const sets = sortName === 'health' || sortName === 'name' ? Object.entries(filterSets) : [['no-filters', filterSets['no-filters']!] as const];
        for (const [filterName, filters] of sets) {
          const expected = sortRegistryRows(filterRegistryRows(rows, filters, env), sort).map(apiRow);
          out[`conformance/registry/${tag}-${env}-${filterName}-sort${sortName}.json`] = {
            description: `${tag} ${env}, ${filterName}, sort ${sortName}`,
            topology: topologyFile,
            environmentId: env,
            filters,
            sort: sortName,
            expected,
          };
        }
      }
    }
  }
  return out;
}

function files(): Record<string, string> {
  const out: Record<string, string> = {
    'topology/mock.v1.json': json(mockTopology),
    'topology/collation.v1.json': json(collationTopology()),
    'conformance/validation/valid-base.json': json({ description: 'Valid base topology for the validation cases', topology: base(), expected: [] }),
  };
  for (const [name, { description, mutate }] of Object.entries(CASES)) {
    const topology = base();
    mutate(topology);
    out[`conformance/validation/${name}.json`] = json({ description, topology, expected: expected(topology) });
  }
  for (const [path, value] of Object.entries(registryCases())) out[path] = json(value);
  for (const snapshot of mockSnapshots()) out[`snapshots/${snapshot.id}.v1.json`] = json(snapshot);
  return out;
}

describe('shared fixtures (fixtures/)', () => {
  const generated = files();

  it('has a valid base and breaks exactly the intended rule in each case', () => {
    expect(validateTopology(base())).toEqual([]);
    expect(validateTopology(mockTopology)).toEqual([]);
    expect(validateTopology(collationTopology())).toEqual([]);
    for (const name of Object.keys(CASES)) {
      const { expected: issues } = JSON.parse(generated[`conformance/validation/${name}.json`]!) as { expected: Expected[] };
      expect(issues.length, name).toBeGreaterThan(0);
      expect(issues.map((i) => i.code).some((code) => name.startsWith(code)), name).toBe(true);
    }
  });

  it(UPDATE ? 'writes the fixtures' : 'matches the committed fixtures (run npm run fixtures:update after intended changes)', () => {
    for (const [path, content] of Object.entries(generated)) {
      const file = join(ROOT, path);
      if (UPDATE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      } else {
        let committed = '';
        try {
          committed = readFileSync(file, 'utf8');
        } catch {
          // Reported by the assertion below.
        }
        expect(committed, path).toBe(content);
      }
    }
  });
});
