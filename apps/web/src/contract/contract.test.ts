import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { generateTopology, INVENTORY_1000, SCALE_250 } from '../data/mock/generateTopology';
import { mockSnapshots } from '../data/mock/snapshots';
import { mockTopology } from '../data/mock/topology';
import { buildRegistryRows, ENTITY_GROUPS } from '../domain/registry';
import { buildTopologyIndex } from '../domain/topologyIndex';
import {
  COMMUNICATION_PATTERNS,
  ENTITY_KINDS,
  ENVIRONMENT_KINDS,
  HEALTH_STATUSES,
  PROTOCOLS,
  PROVIDERS,
  RELATIONSHIP_STATUSES,
  RESOURCE_TYPES,
  SERVICE_CATEGORIES,
} from '../domain/types';

/**
 * Contract tests: the published JSON Schemas and OpenAPI document (docs/schemas, docs/api) must
 * describe exactly what the frontend produces and accepts.
 */
const files = import.meta.glob<string>(['../../../../docs/schemas/*.json', '../../../../docs/api/openapi.json'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const json = (suffix: string) => JSON.parse(Object.entries(files).find(([p]) => p.endsWith(suffix))?.[1] ?? 'null');
const topologySchema = json('schemas/topology.v1.schema.json');
const snapshotSchema = json('schemas/topology-snapshot.v1.schema.json');
const layoutSchema = json('schemas/saved-layout.v1.schema.json');
const openapi = json('api/openapi.json');
const OPENAPI_ID = 'https://example.test/api/openapi.json';

function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(topologySchema);
  ajv.addSchema(snapshotSchema);
  ajv.addSchema(layoutSchema);
  ajv.addSchema({ ...openapi, $id: OPENAPI_ID });
  return ajv;
}
const ajv = makeAjv();
const validate = (id: string, data: unknown) => {
  const fn = ajv.getSchema(id);
  if (!fn) throw new Error(`No schema ${id}`);
  const ok = fn(data);
  return ok ? [] : (fn.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};
const pointer = (...parts: string[]) => `${OPENAPI_ID}#/${parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

describe('TopologyData v1 schema', () => {
  it.each([
    ['mock inventory', mockTopology],
    ['250/750 benchmark fixture', generateTopology(SCALE_250)],
    ['1,000-entity inventory', generateTopology(INVENTORY_1000)],
  ])('accepts the %s', (_name, data) => {
    expect(validate(topologySchema.$id, JSON.parse(JSON.stringify(data)))).toEqual([]);
  });

  it('rejects unknown enum values and unknown fields', () => {
    const bad = structuredClone(mockTopology);
    (bad.serviceInstances[0] as { health: string }).health = 'sleepy';
    (bad.resources[0] as unknown as Record<string, unknown>).color = 'blue';
    const errors = validate(topologySchema.$id, bad);
    expect(errors.some((e) => e.includes('/serviceInstances/0/health'))).toBe(true);
    expect(errors.some((e) => e.includes('additional properties'))).toBe(true);
  });

  it('requires isSimulated on every metrics object', () => {
    const bad = structuredClone(mockTopology);
    delete (bad.serviceInstances[0]!.metrics as { isSimulated?: boolean }).isSimulated;
    expect(validate(topologySchema.$id, bad).join()).toMatch(/isSimulated/);
  });

  it('keeps enums identical to the code', () => {
    const defs = topologySchema.$defs;
    expect(defs.Provider.enum).toEqual([...PROVIDERS]);
    expect(defs.HealthStatus.enum).toEqual([...HEALTH_STATUSES]);
    expect(defs.EnvironmentKind.enum).toEqual([...ENVIRONMENT_KINDS]);
    expect(defs.ServiceCategory.enum).toEqual([...SERVICE_CATEGORIES]);
    expect(defs.ResourceType.enum).toEqual([...RESOURCE_TYPES]);
    expect(defs.Protocol.enum).toEqual([...PROTOCOLS]);
    expect(defs.CommunicationPattern.enum).toEqual([...COMMUNICATION_PATTERNS]);
    expect(defs.RelationshipStatus.enum).toEqual([...RELATIONSHIP_STATUSES]);
    expect(openapi.components.schemas.EntityKind.enum).toEqual([...ENTITY_KINDS]);
    expect(openapi.components.schemas.EntityGroup.enum).toEqual([...ENTITY_GROUPS]);
  });
});

describe('TopologySnapshot and SavedLayout schemas', () => {
  it('accept every snapshot fixture', () => {
    for (const s of mockSnapshots()) expect(validate(snapshotSchema.$id, JSON.parse(JSON.stringify(s))), s.id).toEqual([]);
  });

  it('reject fixture/simulation data that claims to be observed', () => {
    const [s] = mockSnapshots();
    expect(validate(snapshotSchema.$id, { ...s, isSimulated: false })).not.toEqual([]);
  });
});

describe('OpenAPI 3.1 document', () => {
  const operations = Object.entries(openapi.paths as Record<string, Record<string, Record<string, unknown>>>).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'put', 'delete', 'patch'].includes(method))
      .map(([method, op]) => ({ path, method, op })),
  );

  it('is OpenAPI 3.1 with JSON Schema 2020-12', () => {
    expect(openapi.openapi).toMatch(/^3\.1\./);
    expect(openapi.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('documents every operation: id, repository mapping, and an error response', () => {
    for (const { path, method, op } of operations) {
      expect(op.operationId, `${method} ${path}`).toBeTruthy();
      expect(op['x-repository'], `${method} ${path}`).toBeTruthy();
      expect((op.responses as Record<string, unknown>).default, `${method} ${path}`).toBeDefined();
    }
    expect(new Set(operations.map((o) => o.op.operationId)).size).toBe(operations.length);
  });

  it('resolves every $ref', () => {
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref' && typeof v === 'string') refs.push(v);
          else walk(v);
        }
      }
    };
    walk(openapi);
    const unresolved = refs.filter((ref) => {
      const [file, fragment = ''] = ref.split('#');
      const target = file
        ? json(file.replace('../', ''))
        : openapi;
      if (!target) return true;
      return fragment.split('/').filter(Boolean).reduce<unknown>((n, key) => (n as Record<string, unknown> | undefined)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], target) === undefined;
    });
    expect(unresolved).toEqual([]);
    expect(refs.length).toBeGreaterThan(20);
  });

  it('every example validates against its schema', () => {
    let checked = 0;
    for (const { path, method, op } of operations) {
      const bodies: [string[], Record<string, { schema: unknown; examples?: Record<string, { value: unknown }> }>][] = [];
      const request = (op.requestBody as { content?: Record<string, never> } | undefined)?.content;
      if (request) bodies.push([['paths', path, method, 'requestBody', 'content'], request]);
      for (const [status, response] of Object.entries(op.responses as Record<string, { content?: Record<string, never> }>)) {
        if (response.content) bodies.push([['paths', path, method, 'responses', status, 'content'], response.content]);
      }
      for (const [base, content] of bodies) {
        for (const [media, body] of Object.entries(content)) {
          for (const [name, example] of Object.entries(body.examples ?? {})) {
            expect(validate(pointer(...base, media, 'schema'), example.value), `${method} ${path} ${media} ${name}`).toEqual([]);
            checked++;
          }
        }
      }
    }
    const problem = openapi.components.responses.Problem.content['application/problem+json'];
    expect(validate(pointer('components', 'schemas', 'Problem'), problem.examples.notFound.value)).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('registry rows produced by the frontend match RegistryRow (internal search text excluded)', () => {
    // The API row is the frontend row without the internal search text, with absent values as null.
    const rows = buildRegistryRows(buildTopologyIndex(mockTopology)).map((row) => ({
      ref: row.ref,
      name: row.name,
      type: row.type,
      group: row.group,
      provider: row.provider,
      environmentId: row.environmentId ?? null,
      owner: row.owner ?? null,
      team: row.team ?? null,
      health: row.health,
      outgoingCount: row.outgoingCount,
      incomingCount: row.incomingCount,
      updatedAt: row.updatedAt ?? null,
    }));
    expect(validate(pointer('components', 'schemas', 'RegistryPage'), { items: rows, nextCursor: null })).toEqual([]);
  });
});
