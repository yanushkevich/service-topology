/**
 * OpenAPI 3.x contracts (ADR-029, docs/BUSINESS_FLOWS.md Revision 5 §19): finds the operation of an
 * endpoint ("POST /v1/orders") and turns its parameters, request body, and responses into schema
 * trees with generated examples. `$ref`s resolve within the document with a cycle guard; `allOf`
 * merges; `oneOf`/`anyOf` list variants. Pure.
 */

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: Json;
}

export interface SchemaNode {
  /** Property name, when the node is a property. */
  name?: string | undefined;
  /** 'object', 'array', 'string', 'integer', …, 'oneOf', or 'any'. */
  type: string;
  /** The component it came from (`#/components/schemas/Order` → 'Order'). */
  ref?: string | undefined;
  /** Seen again inside itself: drawn by name, not expanded. */
  cycle?: boolean | undefined;
  required?: boolean | undefined;
  format?: string | undefined;
  description?: string | undefined;
  enum?: unknown[] | undefined;
  /** 'min 1', 'max length 500', 'pattern ^[A-Z]{3}$', … */
  constraints: string[];
  example?: unknown;
  properties?: SchemaNode[] | undefined;
  items?: SchemaNode | undefined;
  variants?: SchemaNode[] | undefined;
}

export interface ContractParameter {
  name: string;
  in: string;
  required: boolean;
  description?: string | undefined;
  schema: SchemaNode;
}

export interface ContractResponse {
  status: string;
  description: string;
  contentType?: string | undefined;
  schema?: SchemaNode | undefined;
  example?: unknown;
  headers: string[];
}

export interface Contract {
  /** The document's title and version, e.g. 'Order Service API 7.0.3'. */
  source: string;
  method: string;
  path: string;
  operationId?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  parameters: ContractParameter[];
  requestBody?: { contentType: string; required: boolean; schema: SchemaNode; example: unknown } | undefined;
  responses: ContractResponse[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** "METHOD /path": the shape of an HTTP endpoint (flow entry points, line signatures). */
export function parseHttpEndpoint(endpoint: string | undefined): { method: string; path: string } | null {
  const m = /^(GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)\s+(\/\S*)$/i.exec(endpoint?.trim() ?? '');
  return m ? { method: (m[1] ?? '').toLowerCase(), path: m[2] ?? '' } : null;
}

/** The contract of an HTTP endpoint in a document, or null when the document has no such operation. */
export function findContract(doc: OpenApiDocument, endpoint: string): Contract | null {
  const parsed = parseHttpEndpoint(endpoint);
  if (!parsed) return null;
  const item = asJson(doc.paths[parsed.path]);
  const operation = item && asJson(item[parsed.method]);
  if (!item || !operation || !METHODS.includes(parsed.method)) return null;
  const reader = new Reader(doc);
  const parameters = [...asArray(item.parameters), ...asArray(operation.parameters)].map((p) => reader.parameter(p)).filter((p): p is ContractParameter => p !== null);
  return {
    source: `${doc.info.title} ${doc.info.version}`,
    method: parsed.method.toUpperCase(),
    path: parsed.path,
    operationId: str(operation.operationId),
    summary: str(operation.summary),
    description: str(operation.description),
    parameters,
    requestBody: reader.requestBody(operation.requestBody),
    responses: Object.entries(asJson(operation.responses) ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, r]) => reader.response(status, r)),
  };
}

/** A JSON example for a schema: its example, default, or first enum value, else a value of its type. */
export function exampleOf(node: SchemaNode): unknown {
  if (node.example !== undefined) return node.example;
  if (node.enum?.length) return node.enum[0];
  switch (node.type) {
    case 'object':
      return Object.fromEntries((node.properties ?? []).filter((p) => !(p.cycle && !p.required)).map((p) => [p.name ?? '', p.cycle ? null : exampleOf(p)]));
    case 'array':
      return node.items ? [exampleOf(node.items)] : [];
    case 'oneOf':
      return node.variants?.[0] ? exampleOf(node.variants[0]) : null;
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      return FORMAT_EXAMPLE[node.format ?? ''] ?? 'string';
    default:
      return null;
  }
}

const FORMAT_EXAMPLE: Record<string, string> = {
  'date-time': '2026-10-12T08:45:00Z',
  date: '2026-10-12',
  uuid: '3f2c6a1e-8b0d-4c1a-9e57-2d4b6f0a7c11',
  uri: 'https://example.test/resource',
  email: 'someone@example.test',
};

class Reader {
  constructor(private readonly doc: OpenApiDocument) {}

  parameter(raw: unknown): ContractParameter | null {
    const p = this.deref(raw, new Set()).value;
    const name = str(p?.name);
    if (!p || !name) return null;
    return { name, in: str(p.in) ?? 'query', required: p.required === true, description: str(p.description), schema: this.node(p.schema, new Set()) };
  }

  requestBody(raw: unknown): Contract['requestBody'] {
    const body = this.deref(raw, new Set()).value;
    const media = body && firstMedia(body.content);
    if (!body || !media) return undefined;
    const schema = this.node(media.schema.schema, new Set());
    return { contentType: media.type, required: body.required === true, schema, example: media.schema.example ?? exampleOf(schema) };
  }

  response(status: string, raw: unknown): ContractResponse {
    const r = this.deref(raw, new Set()).value ?? {};
    const media = firstMedia(r.content);
    const schema = media?.schema.schema !== undefined ? this.node(media.schema.schema, new Set()) : undefined;
    return {
      status,
      description: str(r.description) ?? '',
      contentType: media?.type,
      schema,
      example: media ? (media.schema.example ?? (schema ? exampleOf(schema) : undefined)) : undefined,
      headers: Object.keys(asJson(r.headers) ?? {}),
    };
  }

  /** A schema as a tree. `seen` holds the components on the way here, to stop at cycles. */
  node(raw: unknown, seen: ReadonlySet<string>, name?: string, required?: boolean): SchemaNode {
    const { value, ref, cycle } = this.deref(raw, seen);
    const base = { name, required, ref, description: str(asJson(raw)?.description) ?? str(value?.description) };
    if (cycle) return { ...base, type: ref ?? 'object', cycle: true, constraints: [] };
    if (!value) return { ...base, type: 'any', constraints: [] };
    const inner = ref ? new Set([...seen, ref]) : seen;

    const variants = asArray(value.oneOf).length ? asArray(value.oneOf) : asArray(value.anyOf);
    if (variants.length) return { ...base, type: 'oneOf', constraints: [], variants: variants.map((v) => this.node(v, inner)) };

    const schema = asArray(value.allOf).length ? this.mergeAllOf(value, inner) : value;
    const type = str(schema.type) ?? (schema.properties ? 'object' : schema.items ? 'array' : 'any');
    const node: SchemaNode = { ...base, type, format: str(schema.format), enum: Array.isArray(schema.enum) ? schema.enum : undefined, constraints: constraintsOf(schema), example: schema.example ?? schema.default };
    if (type === 'object') {
      const requiredNames = new Set(asArray(schema.required).map(String));
      node.properties = Object.entries(asJson(schema.properties) ?? {}).map(([key, child]) => this.node(child, inner, key, requiredNames.has(key)));
    }
    if (type === 'array') node.items = this.node(schema.items, inner);
    return node;
  }

  /** allOf members merged: properties and required lists combined, later members win. */
  private mergeAllOf(value: Json, seen: ReadonlySet<string>): Json {
    const properties: Json = {};
    const required = new Set<string>();
    const merged: Json = { ...value, type: 'object' };
    delete merged.allOf;
    for (const member of asArray(value.allOf)) {
      const { value: part, ref } = this.deref(member, seen);
      if (!part) continue;
      const resolved = asArray(part.allOf).length ? this.mergeAllOf(part, ref ? new Set([...seen, ref]) : seen) : part;
      Object.assign(properties, asJson(resolved.properties) ?? {});
      for (const r of asArray(resolved.required)) required.add(String(r));
      if (resolved.description && !merged.description) merged.description = resolved.description;
    }
    Object.assign(properties, asJson(value.properties) ?? {});
    for (const r of asArray(value.required)) required.add(String(r));
    return { ...merged, properties, required: [...required] };
  }

  /** Follows a `$ref` within the document (one level; chains resolve as the tree is walked). */
  private deref(raw: unknown, seen: ReadonlySet<string>): { value: Json | undefined; ref?: string | undefined; cycle?: boolean } {
    const json = asJson(raw);
    const ref = str(json?.$ref);
    if (!ref) return { value: json };
    const name = ref.split('/').pop() ?? ref;
    if (seen.has(name)) return { value: undefined, ref: name, cycle: true };
    const target = ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((at, key) => asJson(at)?.[key], this.doc);
    const value = asJson(target);
    // A $ref chain (a parameter pointing at a parameter) resolves fully here.
    if (value?.$ref) return this.deref(value, new Set([...seen, name]));
    return { value, ref: name };
  }
}

function firstMedia(content: unknown): { type: string; schema: { schema: unknown; example: unknown } } | undefined {
  const entries = Object.entries(asJson(content) ?? {});
  const [type, media] = entries.find(([t]) => t.includes('json')) ?? entries[0] ?? [];
  const m = asJson(media);
  return type && m ? { type, schema: { schema: m.schema, example: m.example } } : undefined;
}

function constraintsOf(s: Json): string[] {
  const out: string[] = [];
  if (typeof s.minimum === 'number') out.push(`min ${s.minimum}`);
  if (typeof s.maximum === 'number') out.push(`max ${s.maximum}`);
  if (typeof s.minLength === 'number') out.push(`min length ${s.minLength}`);
  if (typeof s.maxLength === 'number') out.push(`max length ${s.maxLength}`);
  if (typeof s.minItems === 'number') out.push(`min items ${s.minItems}`);
  if (typeof s.maxItems === 'number') out.push(`max items ${s.maxItems}`);
  if (typeof s.pattern === 'string') out.push(`pattern ${s.pattern}`);
  return out;
}

const asJson = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A schema's type in one phrase: "Order", "OrderItem[]", "string", "SettlementEvent | ChargebackEvent". */
export function schemaTypeName(node: SchemaNode): string {
  if (node.type === 'array') return `${node.items ? schemaTypeName(node.items) : 'any'}[]`;
  if (node.type === 'oneOf') return (node.variants ?? []).map(schemaTypeName).join(' | ');
  return node.ref ?? node.type;
}
