#!/usr/bin/env node
// Validates a running backend against docs/api/openapi.json (ajv, JSON Schema 2020-12): every
// operation, success and error cases, status codes, content types, and response bodies.
//
//   node scripts/check-api-contract.mjs --url http://127.0.0.1:18080/api/v1
//
// It creates a snapshot and a layout (IDs prefixed "contract-"), so point it at a disposable
// database (backend: make contract-check does this).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BASE = (args.url ?? 'http://127.0.0.1:18080/api/v1').replace(/\/$/, '');
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '../../../docs');
const load = (p) => JSON.parse(readFileSync(join(DOCS, p), 'utf8'));

const OPENAPI_ID = 'https://example.test/api/openapi.json';
const openapi = load('api/openapi.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const s of ['schemas/topology.v1.schema.json', 'schemas/topology-snapshot.v1.schema.json', 'schemas/saved-layout.v1.schema.json']) ajv.addSchema(load(s));
ajv.addSchema({ ...openapi, $id: OPENAPI_ID });
const pointer = (...parts) => `${OPENAPI_ID}#/${parts.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

/** Response schema pointer for an operation and status (falls back to `default`). */
function responseSpec(path, method, status) {
  const op = openapi.paths[path]?.[method];
  if (!op) throw new Error(`no operation ${method.toUpperCase()} ${path}`);
  const key = op.responses[String(status)] ? String(status) : 'default';
  let resp = op.responses[key];
  let base = ['paths', path, method, 'responses', key];
  if (!resp) return { documented: false };
  if (resp.$ref) {
    const name = resp.$ref.split('/').pop();
    resp = openapi.components.responses[name];
    base = ['components', 'responses', name];
  }
  const types = Object.keys(resp.content ?? {});
  return { documented: true, key, types, schema: (t) => pointer(...base, 'content', t, 'schema') };
}

let failures = 0;
let checks = 0;
let lastHeaders = new Headers();
async function check(name, method, path, url, { status, body, headers = {} } = {}) {
  checks++;
  const res = await fetch(BASE + url, {
    method: method.toUpperCase(),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  lastHeaders = res.headers;
  const problems = [];
  if (status !== undefined && res.status !== status) problems.push(`status ${res.status}, want ${status}`);
  const spec = responseSpec(path, method, res.status);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0];
  const text = await res.text();
  let json;
  if (res.status !== 204) {
    if (!spec.documented) problems.push(`status ${res.status} not documented`);
    else if (!spec.types.includes(contentType)) problems.push(`content type ${contentType}, documented ${spec.types.join(', ')}`);
    else {
      try {
        json = JSON.parse(text);
      } catch {
        problems.push('body is not JSON');
      }
      if (json !== undefined) {
        const validate = ajv.getSchema(spec.schema(contentType)) ?? ajv.compile({ $ref: spec.schema(contentType) });
        if (!validate(json)) problems.push(`schema: ${ajv.errorsText(validate.errors, { separator: '; ' }).slice(0, 400)}`);
      }
    }
  } else if (text !== '') problems.push('204 with a body');
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${name}: ${method.toUpperCase()} ${url}\n      ${problems.join('\n      ')}`);
  } else {
    console.log(`PASS  ${name}: ${method.toUpperCase()} ${url} → ${res.status}`);
  }
  return json;
}

const stamp = Date.now();
await check('meta', 'get', '/meta', '/meta', { status: 200 });
const topology = await check('topology', 'get', '/topology', '/topology', { status: 200 });
await check('environments', 'get', '/environments', '/environments', { status: 200 });
await check('topology for one environment', 'get', '/topology', '/topology?environmentId=staging', { status: 200 });
await check('topology, unknown environment', 'get', '/topology', '/topology?environmentId=ghost', { status: 404 });

const page = await check('registry page', 'get', '/registry', '/registry?environmentId=production&limit=5&sort=-name', { status: 200 });
if (page?.nextCursor) await check('registry next page', 'get', '/registry', `/registry?environmentId=production&limit=5&sort=-name&cursor=${encodeURIComponent(page.nextCursor)}`, { status: 200 });
await check('registry filters', 'get', '/registry', '/registry?environmentId=production&q=order&provider=aws,gcp&health=healthy,degraded&kind=service,messaging', { status: 200 });
await check('registry, missing environmentId', 'get', '/registry', '/registry', { status: 400 });
await check('registry, unknown provider', 'get', '/registry', '/registry?environmentId=production&provider=ibm', { status: 400 });
await check('registry, limit over maximum', 'get', '/registry', '/registry?environmentId=production&limit=501', { status: 400 });

const rel = topology?.relationships?.[0]?.id;
for (const [kind, id] of [['environment', 'production'], ['service-definition', 'payment-service'], ['service-instance', 'payment-service.production'], ['resource', 'topic-orders-events-prod'], ['relationship', rel]]) {
  await check(`entity ${kind}`, 'get', '/entities/{kind}/{id}', `/entities/${kind}/${encodeURIComponent(id)}`, { status: 200 });
}
await check('entity not found', 'get', '/entities/{kind}/{id}', '/entities/service-instance/ghost', { status: 404 });
await check('entity, unknown kind', 'get', '/entities/{kind}/{id}', '/entities/widget/x', { status: 400 });

const snapshots = await check('snapshot list', 'get', '/topology/snapshots', '/topology/snapshots', { status: 200 });
const first = snapshots?.items?.[0]?.id;
const full = first ? await check('snapshot', 'get', '/topology/snapshots/{id}', `/topology/snapshots/${first}`, { status: 200 }) : undefined;
await check('snapshot not found', 'get', '/topology/snapshots/{id}', '/topology/snapshots/ghost', { status: 404 });
await check('snapshot list, bad from', 'get', '/topology/snapshots', '/topology/snapshots?from=yesterday', { status: 400 });
if (full) {
  const capture = { ...full, id: `contract-${stamp}`, label: 'Contract check capture', source: 'simulation', isSimulated: true };
  await check('capture snapshot', 'post', '/topology/snapshots', '/topology/snapshots', { status: 201, body: capture });
  await check('capture duplicate', 'post', '/topology/snapshots', '/topology/snapshots', { status: 409, body: capture });
  await check('capture invalid', 'post', '/topology/snapshots', '/topology/snapshots', { status: 422, body: { ...capture, id: `contract-bad-${stamp}`, source: 'fixture', isSimulated: false } });
}

await check('dependencies upstream', 'get', '/topology/dependencies', '/topology/dependencies?entityId=order-service.production&direction=upstream', { status: 200 });
await check('dependencies bounded', 'get', '/topology/dependencies', '/topology/dependencies?entityId=payment-service.production&direction=downstream&maxDepth=1&limit=1', { status: 200 });
await check('dependencies, bad direction', 'get', '/topology/dependencies', '/topology/dependencies?entityId=order-service.production&direction=sideways', { status: 400 });
await check('dependencies, unknown entity', 'get', '/topology/dependencies', '/topology/dependencies?entityId=ghost&direction=upstream', { status: 404 });
await check('neighborhood', 'get', '/topology/neighborhood', '/topology/neighborhood?entityId=topic-orders-events-prod&depth=2', { status: 200 });
await check('neighborhood, depth too large', 'get', '/topology/neighborhood', '/topology/neighborhood?entityId=topic-orders-events-prod&depth=4', { status: 400 });
await check('impact', 'get', '/topology/impact', '/topology/impact?entityId=eks-commerce-prod,rds-orders-prod&mode=unavailable', { status: 200 });
await check('impact, unknown entity', 'get', '/topology/impact', '/topology/impact?entityId=ghost', { status: 404 });
await check('propagation rules', 'get', '/propagation-rules', '/propagation-rules', { status: 200 });
await check('event types', 'get', '/event-types', '/event-types?environmentId=production', { status: 200 });
await check('event type', 'get', '/event-types/{id}', '/event-types/event-notification-requested?environmentId=production', { status: 200 });
await check('event type, not deployed consumer', 'get', '/event-types/{id}', '/event-types/event-order-placed?environmentId=staging', { status: 200 });
await check('event type, not carried', 'get', '/event-types/{id}', '/event-types/event-payment-captured?environmentId=staging', { status: 404 });
await check('event types, missing environment', 'get', '/event-types', '/event-types', { status: 400 });

const runReq = openapi.paths['/simulations'].post.requestBody.content['application/json'].examples.default.value;
const run = await check('run simulation', 'post', '/simulations', '/simulations', { status: 201, body: { ...runReq, captureSnapshot: true, label: `contract-${stamp}` } });
await check('run simulation, too many ticks', 'post', '/simulations', '/simulations', { status: 400, body: { actions: [{ type: 'step', ticks: 501 }] } });
await check('run simulation, unknown entity', 'post', '/simulations', '/simulations', { status: 400, body: { actions: [{ type: 'inject', entityId: 'ghost', mode: 'unavailable' }] } });
await check('list simulations', 'get', '/simulations', '/simulations', { status: 200 });
if (run) {
  await check('get simulation', 'get', '/simulations/{id}', `/simulations/${run.id}`, { status: 200 });
  const ev = await check('simulation events', 'get', '/events', `/events?simulationId=${run.id}&limit=3`, { status: 200 });
  if (ev?.nextCursor) await check('simulation events, next page', 'get', '/events', `/events?simulationId=${run.id}&limit=3&cursor=${encodeURIComponent(ev.nextCursor)}`, { status: 200 });
  await check('simulation telemetry', 'get', '/telemetry', `/telemetry?simulationId=${run.id}&metricName=latencyMs`, { status: 200 });
  await check('snapshot diff vs current', 'get', '/topology/snapshots/{id}/diff', `/topology/snapshots/${run.snapshotId}/diff`, { status: 200 });
}
await check('events, missing simulationId', 'get', '/events', '/events', { status: 400 });
await check('simulation not found', 'get', '/simulations/{id}', '/simulations/ghost', { status: 404 });
if (first) await check('snapshot diff vs snapshot', 'get', '/topology/snapshots/{id}/diff', `/topology/snapshots/${first}/diff?against=${first}`, { status: 200 });

// Entity writes (ADR-020), guarded by the topology revision (ETag / If-Match).
await check('topology with ETag', 'get', '/topology', '/topology', { status: 200 });
let etag = lastHeaders.get('etag');
checks++;
if (!etag) {
  failures++;
  console.log('FAIL  topology ETag: GET /topology has no ETag header');
} else console.log(`PASS  topology ETag: ${etag}`);
const envId = `contract-env-${stamp}`;
const env = { id: envId, name: 'Contract environment', kind: 'other' };
await check('create entity', 'post', '/entities/{kind}', '/entities/environment', { status: 201, body: env, headers: { 'If-Match': etag } });
const afterCreate = lastHeaders.get('etag');
await check('create entity, duplicate ID', 'post', '/entities/{kind}', '/entities/environment', { status: 409, body: env });
await check('create entity, invalid field', 'post', '/entities/{kind}', '/entities/environment', { status: 422, body: { ...env, id: `${envId}-x`, kind: 'test' } });
await check('create entity, unknown kind', 'post', '/entities/{kind}', '/entities/widget', { status: 400, body: env });
await check('replace entity, stale If-Match', 'put', '/entities/{kind}/{id}', `/entities/environment/${envId}`, { status: 412, body: { ...env, name: 'Stale' }, headers: { 'If-Match': etag } });
await check('replace entity', 'put', '/entities/{kind}/{id}', `/entities/environment/${envId}`, { status: 200, body: { ...env, name: 'Renamed' }, headers: { 'If-Match': afterCreate } });
await check('replace entity, missing', 'put', '/entities/{kind}/{id}', '/entities/environment/contract-ghost', { status: 404, body: { ...env, id: 'contract-ghost' } });
await check('delete entity, still referenced', 'delete', '/entities/{kind}/{id}', '/entities/environment/production', { status: 422 });
await check('delete entity', 'delete', '/entities/{kind}/{id}', `/entities/environment/${envId}`, { status: 204 });
await check('delete entity, missing', 'delete', '/entities/{kind}/{id}', `/entities/environment/${envId}`, { status: 404 });

// Business flows (ADR-022): a writable kind; transitions must be backed; imported flows are read-only.
const flowId = `contract-flow-${Date.now()}`;
const flow = {
  id: flowId,
  name: 'Contract flow',
  trigger: { kind: 'manual' },
  startStepId: 'place',
  steps: [
    { id: 'place', name: 'Place order', serviceDefinitionId: 'order-service', kind: 'task' },
    { id: 'charge', name: 'Charge', serviceDefinitionId: 'payment-service', kind: 'task' },
  ],
  transitions: [
    { id: 't1', from: 'place', to: 'charge', via: { kind: 'call' }, policies: [{ type: 'timeout', label: '3 s', state: 'exercised', config: { timeoutMs: '3000' } }] },
    { id: 't2', from: 'charge', to: 'done', via: { kind: 'local' }, policies: [] },
  ],
  outcomes: [{ id: 'done', name: 'Done', kind: 'success' }],
  source: { kind: 'authored' },
};
await check('create business flow', 'post', '/entities/{kind}', '/entities/business-flow', { status: 201, body: flow });
await check('create business flow, unbacked transition', 'post', '/entities/{kind}', '/entities/business-flow', {
  status: 422,
  body: { ...flow, id: `${flowId}-x`, steps: [flow.steps[0], { ...flow.steps[1], serviceDefinitionId: 'ledger-service' }] },
});
await check('replace business flow', 'put', '/entities/{kind}/{id}', `/entities/business-flow/${flowId}`, { status: 200, body: { ...flow, name: 'Contract flow (edited)' } });
await check('replace business flow, marked imported', 'put', '/entities/{kind}/{id}', `/entities/business-flow/${flowId}`, {
  status: 409,
  body: { ...flow, source: { kind: 'imported', format: 'native', ref: 'flows.json', importedAt: '2026-10-12T08:00:00Z' } },
});
await check('delete business flow', 'delete', '/entities/{kind}/{id}', `/entities/business-flow/${flowId}`, { status: 204 });

// Import of workflow definitions (ADR-022): created, then unchanged on re-import; tasks without a service are named.
const flowFile = (name) => readFileSync(new URL(`../../../fixtures/flows/${name}`, import.meta.url), 'utf8');
const bpmn = flowFile('order-cancellation.bpmn').replaceAll('order-cancellation', `contract-cancel-${Date.now()}`);
await check('import BPMN flow', 'post', '/imports/business-flows', '/imports/business-flows', { status: 200, body: { format: 'bpmn', content: bpmn, ref: 'contract.bpmn' } });
await check('re-import BPMN flow, unchanged', 'post', '/imports/business-flows', '/imports/business-flows', { status: 200, body: { format: 'bpmn', content: bpmn, ref: 'contract.bpmn' } });
await check('import, task without a service', 'post', '/imports/business-flows', '/imports/business-flows', {
  status: 422,
  body: { format: 'bpmn', content: bpmn.replace(' st:service="payment-service"', '').replace('contract-cancel', 'contract-unmapped'), ref: 'contract.bpmn' },
});
await check('import native flow over an authored one', 'post', '/imports/business-flows', '/imports/business-flows', {
  status: 409,
  body: { format: 'native', content: flowFile('daily-payout.flow.yaml').replace('flow-daily-payout', 'flow-checkout') },
});

const layout = openapi.paths['/layouts'].post.requestBody.content['application/json'].examples.default.value;
const mine = { ...layout, id: `contract-${stamp}` };
await check('create layout', 'post', '/layouts', '/layouts', { status: 201, body: mine });
await check('create duplicate layout', 'post', '/layouts', '/layouts', { status: 409, body: mine });
await check('list layouts', 'get', '/layouts', '/layouts', { status: 200 });
await check('replace layout', 'put', '/layouts/{id}', `/layouts/${mine.id}`, { status: 200, body: { ...mine, name: 'Renamed by contract check' } });
await check('replace missing layout', 'put', '/layouts/{id}', '/layouts/contract-ghost', { status: 404, body: { ...mine, id: 'contract-ghost' } });
await check('invalid layout', 'post', '/layouts', '/layouts', { status: 422, body: { ...mine, id: `contract-bad-${stamp}`, view: { ...mine.view, layoutMode: '3d' } } });
await check('delete layout', 'delete', '/layouts/{id}', `/layouts/${mine.id}`, { status: 204 });
await check('delete missing layout', 'delete', '/layouts/{id}', `/layouts/${mine.id}`, { status: 404 });

console.log(`\n${checks - failures}/${checks} checks passed against ${BASE}`);
process.exit(failures ? 1 : 0);
