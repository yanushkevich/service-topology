/**
 * Form model for creating, editing, and deleting canonical entities (ADR-020). Pure functions only:
 * which fields each kind has (with options drawn from the current topology), how form values map to
 * and from canonical entities, and what a change would do to the topology, so the editor can show
 * the same validation issues the server would return before anything is sent.
 */
import { environmentOf, type TopologyIndex } from '../../domain/topologyIndex';
import {
  COMMUNICATION_PATTERNS,
  CONTAINMENT_ONLY_RESOURCE_TYPES,
  ENVIRONMENT_KINDS,
  EVENT_CHANNEL_TYPES,
  HEALTH_STATUSES,
  PROTOCOLS,
  PROVIDERS,
  RELATIONSHIP_STATUSES,
  RESOURCE_TYPES,
  SERVICE_CATEGORIES,
  type EntityId,
  type EntityRef,
  type TopologyData,
} from '../../domain/types';
import { validateTopology, type ValidationIssue } from '../../domain/validation';
import type { EntityOfKind, WritableKind } from '../../data/repositories/TopologyRepository';
import { healthLabel, patternLabel, protocolLabel, providerLabel, relationshipStatusLabel, typeLabel } from '../../shared/mappings';

export const KIND_LABELS: Record<WritableKind, string> = {
  environment: 'Environment',
  'service-definition': 'Service definition',
  'service-instance': 'Service instance',
  resource: 'Resource',
  relationship: 'Connection',
  'event-type': 'Event type',
  'business-flow': 'Business flow',
};

export const KIND_HINTS: Record<WritableKind, string> = {
  environment: 'A deployment stage such as production or staging.',
  'service-definition': 'A logical service, independent of where it runs.',
  'service-instance': 'One deployment of a service in one environment.',
  resource: 'Infrastructure, a containment level, or a topic, queue, or exchange.',
  relationship: 'Runtime communication from one instance or resource to another.',
  'event-type': 'A message contract carried on a topic, queue, or exchange.',
  'business-flow': 'A business process across services: steps, decisions, outcomes, and the policies on every hand-off.',
};

export type FieldControl = 'text' | 'select' | 'multi' | 'textarea' | 'json';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldSpec {
  name: string;
  label: string;
  control: FieldControl;
  required?: boolean;
  options?: FieldOption[];
  /** Label of the empty choice of an optional select. */
  emptyLabel?: string;
  hint?: string;
  mono?: boolean;
  /** IDs cannot change once created. */
  lockedOnEdit?: boolean;
}

export type FormValues = Record<string, string | string[]>;

export interface FormContext {
  data: TopologyData;
  index: TopologyIndex;
  /** The environment shown in the UI; new instances and resources default to it. */
  environmentId: EntityId;
  /** The entity being edited; null when creating. */
  editingId: EntityId | null;
}

const options = (values: readonly string[], label: (v: string) => string): FieldOption[] => values.map((value) => ({ value, label: label(value) }));
const byLabel = (a: FieldOption, b: FieldOption) => a.label.localeCompare(b.label, 'en');
const DIRECTION_OPTIONS: FieldOption[] = [
  { value: 'unidirectional', label: 'One-way' },
  { value: 'bidirectional', label: 'Bidirectional' },
];
const ENVIRONMENT_KIND_LABELS: Record<string, string> = { development: 'Development', staging: 'Staging', production: 'Production', other: 'Other' };

const idField: FieldSpec = { name: 'id', label: 'ID', control: 'text', required: true, mono: true, lockedOnEdit: true, hint: 'Stable and unique across all entities. Cannot be changed later.' };
const nameField: FieldSpec = { name: 'name', label: 'Name', control: 'text', required: true };
const ownerFields: FieldSpec[] = [
  { name: 'owner', label: 'Owner', control: 'text' },
  { name: 'team', label: 'Team', control: 'text' },
];
const metadataField: FieldSpec = { name: 'metadata', label: 'Metadata', control: 'json', mono: true, hint: 'Optional JSON object of display-only attributes.' };

function environmentOptions(ctx: FormContext): FieldOption[] {
  return ctx.data.environments.map((e) => ({ value: e.id, label: e.name }));
}

function definitionOptions(ctx: FormContext): FieldOption[] {
  return ctx.data.serviceDefinitions.map((d) => ({ value: d.id, label: d.name })).sort(byLabel);
}

/** Resources in a subtree, to keep a resource from becoming its own ancestor. */
function descendants(ctx: FormContext, id: EntityId): Set<EntityId> {
  const out = new Set<EntityId>([id]);
  const stack = [id];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const child of ctx.index.childResources.get(next) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}

function resourceLabel(ctx: FormContext, id: EntityId): string {
  const r = ctx.index.resources.get(id);
  return r ? `${r.name} · ${typeLabel(r.type)}` : id;
}

/** Instances and communicating resources, as relationship endpoints. */
function endpointOptions(ctx: FormContext): FieldOption[] {
  const instances = ctx.data.serviceInstances.map((i) => ({
    value: i.id,
    label: `${ctx.index.definitions.get(i.serviceDefinitionId)?.name ?? i.serviceDefinitionId} · ${ctx.index.environments.get(i.environmentId)?.name ?? i.environmentId}`,
  }));
  const resources = ctx.data.resources.filter((r) => !CONTAINMENT_ONLY_RESOURCE_TYPES.has(r.type)).map((r) => ({ value: r.id, label: resourceLabel(ctx, r.id) }));
  return [...instances, ...resources].sort(byLabel);
}

/** The fields of one kind, with options from the current topology. */
export function fieldsFor(kind: WritableKind, ctx: FormContext): FieldSpec[] {
  switch (kind) {
    case 'environment':
      return [idField, nameField, { name: 'kind', label: 'Kind', control: 'select', required: true, options: options(ENVIRONMENT_KINDS, (v) => ENVIRONMENT_KIND_LABELS[v] ?? v) }];
    case 'service-definition':
      return [
        idField,
        nameField,
        { name: 'category', label: 'Category', control: 'select', required: true, options: options(SERVICE_CATEGORIES, typeLabel) },
        { name: 'protocols', label: 'Protocols', control: 'multi', options: options(PROTOCOLS, protocolLabel) },
        { name: 'description', label: 'Description', control: 'textarea' },
        ...ownerFields,
        metadataField,
      ];
    case 'service-instance':
      return [
        idField,
        { name: 'serviceDefinitionId', label: 'Service definition', control: 'select', required: true, options: definitionOptions(ctx) },
        { name: 'environmentId', label: 'Environment', control: 'select', required: true, options: environmentOptions(ctx) },
        { name: 'provider', label: 'Provider', control: 'select', required: true, options: options(PROVIDERS, providerLabel) },
        { name: 'health', label: 'Health', control: 'select', required: true, options: options(HEALTH_STATUSES, healthLabel) },
        { name: 'version', label: 'Version', control: 'text', mono: true },
        { name: 'endpoint', label: 'Endpoint', control: 'text', mono: true },
        {
          name: 'resourceId',
          label: 'Runs in',
          control: 'select',
          emptyLabel: 'Not modeled',
          hint: 'The most specific known host: workload, namespace, cluster, …',
          options: ctx.data.resources.map((r) => ({ value: r.id, label: resourceLabel(ctx, r.id) })).sort(byLabel),
        },
        metadataField,
      ];
    case 'resource': {
      const excluded = ctx.editingId ? descendants(ctx, ctx.editingId) : new Set<EntityId>();
      return [
        idField,
        nameField,
        { name: 'type', label: 'Type', control: 'select', required: true, options: options(RESOURCE_TYPES, typeLabel) },
        { name: 'provider', label: 'Provider', control: 'select', required: true, options: options(PROVIDERS, providerLabel) },
        {
          name: 'parentResourceId',
          label: 'Contained in',
          control: 'select',
          emptyLabel: 'Top level',
          options: ctx.data.resources.filter((r) => !excluded.has(r.id)).map((r) => ({ value: r.id, label: resourceLabel(ctx, r.id) })).sort(byLabel),
        },
        {
          name: 'environmentId',
          label: 'Environment',
          control: 'select',
          emptyLabel: 'Inherited from parent, or any',
          hint: 'Leave empty to inherit the parent’s environment, or to be environment-independent (SaaS).',
          options: environmentOptions(ctx),
        },
        { name: 'health', label: 'Health', control: 'select', emptyLabel: 'Not modeled', options: options(HEALTH_STATUSES, healthLabel) },
        ...ownerFields,
        metadataField,
      ];
    }
    case 'relationship':
      return [
        idField,
        { name: 'sourceEntityId', label: 'From', control: 'select', required: true, options: endpointOptions(ctx) },
        { name: 'targetEntityId', label: 'To', control: 'select', required: true, options: endpointOptions(ctx) },
        { name: 'protocol', label: 'Protocol', control: 'select', required: true, options: options(PROTOCOLS, protocolLabel) },
        { name: 'pattern', label: 'Pattern', control: 'select', required: true, options: options(COMMUNICATION_PATTERNS, patternLabel) },
        { name: 'direction', label: 'Direction', control: 'select', required: true, options: DIRECTION_OPTIONS },
        { name: 'status', label: 'Status', control: 'select', required: true, options: options(RELATIONSHIP_STATUSES, relationshipStatusLabel) },
        { name: 'endpoint', label: 'Endpoint', control: 'text', mono: true },
        { name: 'authenticationType', label: 'Authentication', control: 'text' },
        metadataField,
      ];
    case 'event-type':
      return [
        idField,
        nameField,
        { name: 'description', label: 'Description', control: 'textarea' },
        { name: 'schemaVersion', label: 'Schema version', control: 'text', mono: true },
        ...ownerFields,
        {
          name: 'channelResourceIds',
          label: 'Carried on',
          control: 'multi',
          hint: 'Topics, queues, or exchanges; at most one per environment.',
          options: ctx.data.resources.filter((r) => EVENT_CHANNEL_TYPES.has(r.type)).map((r) => ({ value: r.id, label: resourceLabel(ctx, r.id) })).sort(byLabel),
        },
        { name: 'producerServiceIds', label: 'Producers', control: 'multi', options: definitionOptions(ctx) },
        { name: 'consumerServiceIds', label: 'Consumers', control: 'multi', options: definitionOptions(ctx) },
        metadataField,
      ];
    case 'business-flow':
      // Edited in its own structured form (features/business-flows/FlowEditorDialog.tsx).
      return [idField, nameField];
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Form values for an existing entity (every field of fieldsFor, as strings). */
export function valuesFromEntity<K extends WritableKind>(kind: K, entity: EntityOfKind[K], ctx: FormContext): FormValues {
  const record = entity as unknown as Record<string, unknown>;
  const values: FormValues = {};
  for (const field of fieldsFor(kind, ctx)) {
    const v = record[field.name];
    if (field.control === 'multi') values[field.name] = list(v);
    else if (field.control === 'json') values[field.name] = v === undefined ? '' : JSON.stringify(v, null, 2);
    else values[field.name] = str(v);
  }
  return values;
}

/** Form values for a new entity: required selects preselect a sensible first choice. */
export function emptyValues(kind: WritableKind, ctx: FormContext): FormValues {
  const values: FormValues = {};
  for (const field of fieldsFor(kind, ctx)) {
    values[field.name] = field.control === 'multi' ? [] : field.required && field.options ? (field.options[0]?.value ?? '') : '';
  }
  const env = ctx.data.environments.some((e) => e.id === ctx.environmentId) ? ctx.environmentId : (ctx.data.environments[0]?.id ?? '');
  if (kind === 'service-instance') {
    values.environmentId = env;
    values.provider = 'unknown';
    values.health = 'unknown';
  }
  if (kind === 'resource') values.provider = 'unknown';
  if (kind === 'relationship') {
    values.sourceEntityId = '';
    values.targetEntityId = '';
    values.pattern = 'synchronous';
    values.protocol = 'https';
    values.status = 'active';
  }
  if (kind === 'environment') values.kind = 'other';
  if (kind === 'service-definition') values.category = 'api';
  return values;
}

/** A readable ID suggestion while creating (users can overwrite it). */
export function suggestId(kind: WritableKind, values: FormValues): string {
  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  switch (kind) {
    case 'service-instance':
      return str(values.serviceDefinitionId) && str(values.environmentId) ? `${str(values.serviceDefinitionId)}.${str(values.environmentId)}` : '';
    case 'relationship':
      return str(values.sourceEntityId) && str(values.targetEntityId) ? `rel:${str(values.sourceEntityId)}->${str(values.targetEntityId)}` : '';
    case 'event-type':
      return str(values.name) ? `event-${slug(str(values.name))}` : '';
    case 'business-flow':
      return str(values.name) ? `flow-${slug(str(values.name))}` : '';
    default:
      return slug(str(values.name));
  }
}

export type FieldErrors = Record<string, string>;

/** The server's ID rules (backend/internal/domain/fields.go). */
export function idError(id: string): string | null {
  if (id === '') return 'Required.';
  if (id.length > 200) return 'At most 200 characters.';
  const control = [...id].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
  if (id.trim() !== id || id.includes('/') || control) return 'No slashes, control characters, or surrounding spaces.';
  return null;
}

/** Builds the canonical entity from form values, or reports field errors. */
export function entityFromValues<K extends WritableKind>(
  kind: K,
  values: FormValues,
  ctx: FormContext,
  existing: EntityOfKind[K] | null,
): { entity: EntityOfKind[K]; errors: null } | { entity: null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const out: Record<string, unknown> = {};
  for (const field of fieldsFor(kind, ctx)) {
    const raw = values[field.name];
    if (field.control === 'multi') {
      out[field.name] = list(raw);
      continue;
    }
    const v = field.control === 'textarea' || field.control === 'json' ? str(raw) : str(raw).trim();
    if (field.name === 'id') {
      const problem = idError(str(raw));
      if (problem) errors.id = problem;
      out.id = str(raw);
      continue;
    }
    if (field.control === 'json') {
      if (v.trim() === '') continue;
      try {
        const parsed: unknown = JSON.parse(v);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) errors[field.name] = 'Must be a JSON object, e.g. {"tier": "gold"}.';
        else out[field.name] = parsed;
      } catch {
        errors[field.name] = 'Not valid JSON.';
      }
      continue;
    }
    if (v === '') {
      if (field.required) errors[field.name] = 'Required.';
      continue; // optional and empty: omitted (exactOptionalPropertyTypes)
    }
    out[field.name] = v;
  }
  if (Object.keys(errors).length > 0) return { entity: null, errors };
  // Fields the form does not edit: the server sets updatedAt and keeps stored telemetry (ADR-020).
  const previous = (existing ?? {}) as Record<string, unknown>;
  if (kind === 'service-instance' || kind === 'relationship') out.updatedAt = str(previous.updatedAt) || new Date().toISOString();
  if (kind === 'resource' && previous.updatedAt !== undefined) out.updatedAt = previous.updatedAt;
  if (previous.metrics !== undefined && (kind === 'service-instance' || kind === 'resource' || kind === 'relationship')) out.metrics = previous.metrics;
  return { entity: out as unknown as EntityOfKind[K], errors: null };
}

const COLLECTION: Record<WritableKind, keyof TopologyData> = {
  environment: 'environments',
  'service-definition': 'serviceDefinitions',
  'service-instance': 'serviceInstances',
  resource: 'resources',
  relationship: 'relationships',
  'event-type': 'eventTypes',
  'business-flow': 'businessFlows',
};

/** The topology after a create, replace (same ID), or delete. Does not modify data. */
export function applyChange(data: TopologyData, kind: WritableKind, change: { op: 'create' | 'update'; entity: { id: EntityId } } | { op: 'delete'; id: EntityId }): TopologyData {
  const key = COLLECTION[kind];
  const items = [...((data[key] as { id: EntityId }[] | undefined) ?? [])];
  if (change.op === 'delete') {
    const at = items.findIndex((e) => e.id === change.id);
    if (at >= 0) items.splice(at, 1);
  } else if (change.op === 'create') {
    items.push(change.entity);
  } else {
    const at = items.findIndex((e) => e.id === change.entity.id);
    if (at >= 0) items[at] = change.entity;
  }
  return { ...data, [key]: items } as TopologyData;
}

/** Whether any collection already uses id (IDs are unique across collections). */
export function idTaken(data: TopologyData, id: EntityId): boolean {
  return Object.values(COLLECTION).some((key) => ((data[key] as { id: EntityId }[] | undefined) ?? []).some((e) => e.id === id));
}

const issueKey = (i: ValidationIssue) => `${i.code}\u0000${i.entityId}\u0000${i.message}`;

/** Validation issues a change would introduce (issues already present before it are not its fault). */
export function newIssues(before: TopologyData, after: TopologyData): ValidationIssue[] {
  const existing = new Set(validateTopology(before).map(issueKey));
  return validateTopology(after).filter((i) => !existing.has(issueKey(i)));
}

/** Where to go after saving: the selection for map/registry kinds; event types open in the catalog. */
export function selectionFor(kind: WritableKind, id: EntityId): EntityRef | null {
  return kind === 'event-type' || kind === 'business-flow' ? null : { kind, id };
}

/** The environment a new instance or relationship would belong to, for display. */
export function environmentLabel(ctx: FormContext, id: EntityId): string | undefined {
  const env = environmentOf(ctx.index, id);
  return env ? (ctx.index.environments.get(env)?.name ?? env) : undefined;
}
