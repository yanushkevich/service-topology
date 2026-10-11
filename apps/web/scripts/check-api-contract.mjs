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
async function check(name, method, path, url, { status, body } = {}) {
  checks++;
  const res = await fetch(BASE + url, {
    method: method.toUpperCase(),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
