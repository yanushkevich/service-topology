/// <reference types="node" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mockSnapshots } from '../data/mock/snapshots';
import { mockTopology } from '../data/mock/topology';
import { buildRegistryRows, filterRegistryRows, REGISTRY_SORT_KEYS, sortRegistryRows, type EntityFilters, type RegistryRow } from '../domain/registry';
import { eventFlowsIn } from '../domain/eventFlow';
import { analyzeImpact, type FailureMode, type FailureRoot } from '../domain/propagation';
import { flowImpacts } from '../domain/flowImpact';
import { buildTopologyIndex } from '../domain/topologyIndex';
import { dependencyTree, HIGHLIGHT_MODES, neighborhood, reachFrom } from '../domain/traversal';
import { generateTopology, INVENTORY_1000, SCALE_250 } from '../data/mock/generateTopology';
import { diffTopology } from '../domain/snapshot';
import { createSimulation, injectFailure, recover, recoverAll, reset, step, type SimulationState } from '../simulation/engine';
import type { TopologyData } from '../domain/types';
import { validateTopology, type ValidationIssue } from '../domain/validation';
import { definitionOf, validateBoardDefinition, type BoardDefinition } from '../transit/definition';
import { bundleOf, validateBundle } from '../data/bundle/bundle';
import { paymentServiceBoard } from '../transit/mock/paymentServiceBoard';

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
    businessFlows: [
      {
        id: 'flow-base',
        name: 'Base flow',
        trigger: { kind: 'call', ref: 'svc-api' },
        startStepId: 'create',
        steps: [
          { id: 'create', name: 'Create', serviceDefinitionId: 'svc-api', kind: 'task', compensatedBy: 'undo' },
          { id: 'process', name: 'Process', serviceDefinitionId: 'svc-worker', kind: 'task' },
          { id: 'finish', name: 'Finish', serviceDefinitionId: 'svc-worker', kind: 'task' },
          { id: 'undo', name: 'Undo', serviceDefinitionId: 'svc-api', kind: 'compensation' },
        ],
        transitions: [
          { id: 't-created', from: 'create', to: 'process', via: { kind: 'event', eventTypeId: 'evt-created' }, policies: [{ type: 'redelivery', label: 'redelivery ×3', state: 'exercised' }] },
          { id: 't-local', from: 'process', to: 'finish', via: { kind: 'local' }, policies: [] },
          { id: 't-done', from: 'finish', to: 'done', via: { kind: 'local' }, policies: [] },
          { id: 't-saas', from: 'create', to: 'undo', via: { kind: 'call' }, condition: 'rejected', policies: [] },
          { id: 't-undone', from: 'undo', to: 'failed', via: { kind: 'local' }, policies: [] },
        ],
        outcomes: [
          { id: 'done', name: 'Done', kind: 'success' },
          { id: 'failed', name: 'Failed', kind: 'compensated' },
        ],
        source: { kind: 'authored' },
      },
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
const flow = (d: TopologyData) => d.businessFlows![0]!;

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
  'missing-flow-service': { description: 'Flow step owned by an unknown service definition', mutate: (d) => void (flow(d).steps[2]!.serviceDefinitionId = 'ghost-service') },
  'invalid-flow-step-start': { description: 'Flow starts at a step it does not have', mutate: (d) => void (flow(d).startStepId = 'ghost-step') },
  'invalid-flow-step-compensation': { description: 'Flow step compensated by a step that is not a compensation', mutate: (d) => void (flow(d).steps[0]!.compensatedBy = 'finish') },
  'invalid-flow-trigger': { description: 'Flow triggered by an event its first service does not consume', mutate: (d) => void (flow(d).trigger = { kind: 'event', ref: 'evt-created' }) },
  'invalid-flow-transition-local': { description: 'Local hand-off between two services', mutate: (d) => void (flow(d).transitions[0]!.via = { kind: 'local' }) },
  'invalid-flow-transition-event': { description: 'Event transition to a service that does not consume the event', mutate: (d) => void (flow(d).transitions[0]!.to = 'undo') },
  'flow-no-success-path': { description: 'No path reaches a success outcome', mutate: (d) => void (flow(d).outcomes[0]!.kind = 'failed') },
  'flow-transition-unbacked': { description: 'A call between services with no relationship in production', mutate: (d) => void (flow(d).transitions[0]!.via = { kind: 'call' }) },
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
  for (const [path, value] of Object.entries(traversalCases())) out[path] = json(value);
  for (const [path, value] of Object.entries(boardCases())) out[path] = json(value);
  for (const [path, value] of Object.entries(bundleCases())) out[path] = json(value);
  out['topology/scale-250.v1.json'] = json(generateTopology(SCALE_250));
  out['topology/inventory-1000.v1.json'] = json(generateTopology(INVENTORY_1000));
  return out;
}

/**
 * Board definition cases (ADR-031): the example board's definition, valid against the mock
 * topology, and one case per rule that breaks it. The Go port must report the same codes and paths.
 */
function boardCases(): Record<string, unknown> {
  const index = buildTopologyIndex(mockTopology);
  const valid = definitionOf(paymentServiceBoard('production'));
  const cases: Record<string, { description: string; mutate: (d: BoardDefinition) => void }> = {
    'board-service-not-found': { description: 'The service definition does not exist', mutate: (d) => void (d.serviceDefinitionId = 'no-such-service') },
    'invalid-board-station-duplicate': { description: 'Two stations share an ID', mutate: (d) => void d.stations.push({ id: 'dep:pg', name: 'again', kind: 'dependency' }) },
    'invalid-board-station-entity-on-module': { description: 'Only dependencies link to topology entities', mutate: (d) => void d.stations.push({ id: 'mod:linked', name: 'Linked', kind: 'module', entityId: 'pg-payments-prod' }) },
    'board-entity-not-found': { description: 'A dependency links to an entity the topology lacks', mutate: (d) => void d.stations.push({ id: 'dep:ghost', name: 'Ghost', kind: 'dependency', entityId: 'no-such-entity' }) },
    'invalid-board-line-duplicate-code': { description: 'Two lines share a code', mutate: (d) => void (d.lines[1]!.code = d.lines[0]!.code) },
    'invalid-board-line-unknown-station': { description: 'A route goes through an unknown station', mutate: (d) => void d.lines[0]!.route[0]!.stations.push('nowhere') },
    'invalid-board-line-fork': { description: 'A branch does not start at a station of an earlier branch', mutate: (d) => void (d.lines[0]!.route[1]!.stations[0] = 'cli:ledger') },
    'invalid-board-line-share': { description: 'A branch share outside 0..1', mutate: (d) => void (d.lines.find((l) => l.id === 'A5')!.route[1]!.share = 1.5) },
    'invalid-board-policy-not-on-client': { description: 'A policy is not on a client station', mutate: (d) => void (d.policies[0]!.clientId = 'mod:capture') },
    'invalid-board-table-not-reached': { description: 'A table writer does not reach the table’s station', mutate: (d) => void d.tables[0]!.writes.push('A4') },
    'invalid-board-table-on-module': { description: 'A table is not on a dependency station', mutate: (d) => void (d.tables[0]!.stationId = 'mod:capture') },
  };
  const out: Record<string, unknown> = {
    'conformance/boards/valid-example.json': { description: 'The example Payment Service board definition', topology: 'topology/mock.v1.json', definition: valid, expected: [] },
  };
  for (const [name, { description, mutate }] of Object.entries(cases)) {
    const definition = structuredClone(valid);
    mutate(definition);
    out[`conformance/boards/${name}.json`] = { description, topology: 'topology/mock.v1.json', definition, expected: validateBoardDefinition(definition, index).map(({ code, path }) => ({ code, path })) };
  }
  return out;
}

/**
 * Data bundle cases (ADR-032): a small valid bundle (the base topology and one board) and one case
 * per rule. The Go port must report the same codes, paths, and entity IDs in the same order.
 */
function bundleCases(): Record<string, unknown> {
  const board: BoardDefinition = {
    serviceDefinitionId: 'svc-api',
    stations: [
      { id: 'caller', name: 'Client', kind: 'caller' },
      { id: 'gate', name: 'HTTP ingress', kind: 'gate' },
      { id: 'module', name: 'API', kind: 'module' },
      { id: 'client', name: 'db client', kind: 'client' },
      { id: 'dep', name: 'db', kind: 'dependency', entityId: 'db' },
    ],
    lines: [{ id: 'H1', code: 'H1', name: 'Create', group: 'http', signature: 'POST /v1/things', caller: 'caller', route: [{ stations: ['caller', 'gate', 'module', 'client', 'dep'], kind: 'sequential' }], patterns: ['outbox'] }],
    policies: [{ id: 'p-timeout', clientId: 'client', order: 1, type: 'timeout', label: 'timeout 2s', config: { timeout: '2s' } }],
    tables: [{ id: 'outbox', stationId: 'dep', name: 'outbox', pattern: 'outbox', writes: ['H1'], reads: [] }],
  };
  const valid = () => JSON.parse(JSON.stringify(bundleOf(base(), [board], { exportedAt: T, source: { label: 'Fixture', isMock: true } }))) as Record<string, unknown> & { transitBoards: BoardDefinition[]; serviceInstances: { environmentId: string }[] };
  const cases: Record<string, { description: string; mutate: (b: ReturnType<typeof valid>) => unknown }> = {
    'unsupported-format': { description: 'Another format', mutate: (b) => void (b.format = 'something-else') },
    'unsupported-version': { description: 'A newer version', mutate: (b) => void (b.version = 2) },
    'missing-module': { description: 'A required topology module is missing', mutate: (b) => void delete b.resources },
    'module-not-a-list': { description: 'A module that is not a list', mutate: (b) => void (b.eventTypes = { id: 'x' }) },
    'entry-without-id': { description: 'An entry without an ID', mutate: (b) => void (b.serviceDefinitions as unknown[]).push({ name: 'nameless' }) },
    'board-shape': { description: 'A board without its lists', mutate: (b) => void (b.transitBoards as unknown[]).push({ serviceDefinitionId: 'svc-worker' }) },
    'topology-error': { description: 'A topology rule fails (instance in an unknown environment)', mutate: (b) => void (b.serviceInstances[0]!.environmentId = 'nowhere') },
    'duplicate-board': { description: 'Two boards for one service', mutate: (b) => void b.transitBoards.push(structuredClone(board)) },
    'board-error': { description: 'A board rule fails against the bundle’s topology', mutate: (b) => void (b.transitBoards[0]!.stations[4]!.entityId = 'no-such-entity') },
    'board-service-removed': { description: 'The board’s service is not in the bundle', mutate: (b) => void (b.transitBoards[0]!.serviceDefinitionId = 'svc-gone') },
  };
  const out: Record<string, unknown> = { 'conformance/bundles/valid.json': { description: 'A valid bundle: the base topology and one board', bundle: valid(), expected: [] } };
  for (const [name, { description, mutate }] of Object.entries(cases)) {
    const bundle = valid();
    mutate(bundle);
    out[`conformance/bundles/${name}.json`] = { description, bundle, expected: validateBundle(bundle).map(({ code, path, entityId }) => ({ code, path, ...(entityId ? { entityId } : {}) })) };
  }
  return out;
}

/** Traversal, propagation, and event-flow results of the TypeScript reference on the mock topology. */
function traversalCases(): Record<string, unknown> {
  const index = buildTopologyIndex(mockTopology);
  const entities = [...mockTopology.serviceInstances.map((i) => i.id), ...mockTopology.resources.map((r) => r.id)];
  const sorted = (ids: Iterable<string>) => [...ids].sort();
  const topology = 'topology/mock.v1.json';
  const modes: FailureMode[] = ['unavailable', 'degraded'];
  return {
    'conformance/traversal/dependency-trees.json': {
      topology,
      cases: entities.flatMap((id) => (['upstream', 'downstream'] as const).map((direction) => ({ entityId: id, direction, expected: dependencyTree(index, id, direction) }))),
    },
    'conformance/traversal/neighborhoods.json': {
      topology,
      cases: entities.flatMap((id) => [1, 2, 3].map((depth) => ({ centerId: id, depth, expected: sorted(neighborhood(index, id, depth)) }))),
    },
    'conformance/traversal/reach.json': {
      topology,
      cases: entities.flatMap((id) =>
        HIGHLIGHT_MODES.map((mode) => {
          const reach = reachFrom(index, id, mode);
          return { startId: id, mode, expected: { entityIds: sorted(reach.entityIds), relationshipIds: sorted(reach.relationshipIds) } };
        }),
      ),
    },
    'conformance/impact/impacts.json': {
      topology,
      cases: [
        ...entities.flatMap((id) => modes.map((mode) => ({ roots: [{ entityId: id, mode }], expected: analyzeImpact(index, [{ entityId: id, mode }]) }))),
        ...[
          [{ entityId: 'payment-service.production', mode: 'unavailable' as const }, { entityId: 'topic-orders-events-prod', mode: 'unavailable' as const }],
          [{ entityId: 'eks-commerce-prod', mode: 'unavailable' as const }, { entityId: 'rds-orders-prod', mode: 'degraded' as const }],
          [{ entityId: 'rds-inventory-prod', mode: 'degraded' as const }, { entityId: 'inventory-service.production', mode: 'unavailable' as const }],
        ].map((roots) => ({ roots, expected: analyzeImpact(index, roots) })),
      ],
    },
    // Flows in impact analysis (ADR-025): the same roots as impacts.json, plus the example scenario.
    'conformance/impact/flows.json': {
      topology,
      cases: (
        [
          ...entities.flatMap((id) => modes.map((mode) => [{ entityId: id, mode }])),
          [{ entityId: 'payment-service.production', mode: 'unavailable' }, { entityId: 'topic-orders-events-prod', mode: 'unavailable' }],
          [{ entityId: 'notification-service.production', mode: 'unavailable' }, { entityId: 'pg-ledger-prod', mode: 'degraded' }],
        ] satisfies FailureRoot[][]
      ).map((roots) => ({ roots, expected: flowImpacts(index, roots, analyzeImpact(index, roots)) })),
    },
    'conformance/history/diffs.json': {
      cases: (() => {
        const snaps = mockSnapshots();
        const pairs: [string, TopologyData, string, TopologyData][] = [];
        for (const a of snaps) for (const b of snaps) if (a.id !== b.id) pairs.push([a.id, a.data, b.id, b.data]);
        for (const a of snaps) pairs.push([a.id, a.data, 'mock', mockTopology]);
        return pairs.map(([aId, a, bId, b]) => ({ before: aId, after: bId, expected: diffTopology(a, b) }));
      })(),
    },
    'conformance/simulation/scenarios.json': { topology, scenarios: simulationScenarios() },
    'conformance/eventflows/flows.json': {
      topology,
      cases: mockTopology.environments.map((e) => ({ environmentId: e.id, expected: eventFlowsIn(index, e.id) })),
    },
  };
}

type SimAction =
  | { type: 'inject'; entityId: string; mode: FailureMode; durationTicks?: number }
  | { type: 'recover'; entityId: string }
  | { type: 'recoverAll' }
  | { type: 'step'; ticks: number }
  | { type: 'reset' };

/** Scripted runs of the deterministic engine; every action's resulting state is recorded. */
function simulationScenarios() {
  const scripts: { name: string; seed: number; startAt?: string; actions: SimAction[] }[] = [
    { name: 'drift-only', seed: 7, actions: [{ type: 'step', ticks: 60 }] },
    {
      name: 'failures-and-recovery',
      seed: 42,
      actions: [
        { type: 'inject', entityId: 'payment-service.production', mode: 'unavailable', durationTicks: 3 },
        { type: 'step', ticks: 5 },
        { type: 'inject', entityId: 'topic-orders-events-prod', mode: 'unavailable' },
        { type: 'inject', entityId: 'rds-inventory-prod', mode: 'degraded' },
        { type: 'step', ticks: 25 },
        { type: 'recover', entityId: 'topic-orders-events-prod' },
        { type: 'inject', entityId: 'eks-commerce-prod', mode: 'unavailable', durationTicks: 2 },
        { type: 'step', ticks: 3 },
        { type: 'recoverAll' },
        { type: 'step', ticks: 10 },
        { type: 'reset' },
        { type: 'step', ticks: 2 },
      ],
    },
    { name: 'explicit-start', seed: 123456789, startAt: '2026-10-11T12:00:00Z', actions: [{ type: 'inject', entityId: 'notification-service.production', mode: 'degraded' }, { type: 'step', ticks: 120 }] },
  ];
  const view = (s: SimulationState) => ({ tick: s.tick, clock: s.clock, rng: s.rng, drift: s.drift, anomalies: s.anomalies, failures: s.failures, impacts: s.impacts, events: s.events, eventSeq: s.eventSeq, data: s.data });
  return scripts.map((script) => {
    let state = createSimulation(mockTopology, { seed: script.seed, ...(script.startAt ? { startAt: script.startAt } : {}) });
    const states = [view(state)];
    for (const a of script.actions) {
      if (a.type === 'inject') state = injectFailure(state, a.entityId, a.mode, a.durationTicks !== undefined ? { durationTicks: a.durationTicks } : {});
      else if (a.type === 'recover') state = recover(state, a.entityId);
      else if (a.type === 'recoverAll') state = recoverAll(state);
      else if (a.type === 'step') state = step(state, a.ticks);
      else state = reset(state);
      states.push(view(state));
    }
    return { ...script, states };
  });
}

describe('shared fixtures (fixtures/)', () => {
  const generated = files();

  it('has a valid base and breaks exactly the intended rule in each case', () => {
    expect(validateTopology(base())).toEqual([]);
    expect(validateTopology(mockTopology)).toEqual([]);
    expect(validateTopology(collationTopology())).toEqual([]);
    for (const [path, content] of Object.entries(generated).filter(([p]) => p.startsWith('conformance/boards/'))) {
      const { expected } = JSON.parse(content) as { expected: { code: string }[] };
      const name = path.split('/').pop()!.replace('.json', '');
      if (name === 'valid-example') expect(expected, name).toEqual([]);
      else expect(expected.map((e) => e.code).some((code) => name.startsWith(code)), name).toBe(true);
    }
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
