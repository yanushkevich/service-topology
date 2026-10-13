import type { BusinessFlow, FlowPolicy, FlowStep, FlowTransition, TopologyData } from '../../domain/types';
import { idError } from '../editing/entityForms';

/**
 * Form model of the business-flow editor (ADR-022): a draft BusinessFlow edited in place, local
 * checks before the whole-topology validation, and the clean-up that turns the draft into the
 * entity sent to the API. Pure.
 */

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A new flow: one step owned by the first service, ending in one success outcome. */
export function newFlowTemplate(data: TopologyData): BusinessFlow {
  const service = [...data.serviceDefinitions].sort((a, b) => a.name.localeCompare(b.name, 'en'))[0]?.id ?? '';
  return {
    id: '',
    name: '',
    trigger: { kind: 'manual' },
    startStepId: 'step-1',
    steps: [{ id: 'step-1', name: '', serviceDefinitionId: service, kind: 'task' }],
    transitions: [{ id: 't-1', from: 'step-1', to: 'done', via: { kind: 'local' }, policies: [] }],
    outcomes: [{ id: 'done', name: 'Done', kind: 'success' }],
    source: { kind: 'authored' },
  };
}

/** An authored, editable copy of a (usually imported) flow. */
export function duplicateFlow(flow: BusinessFlow, data: TopologyData): BusinessFlow {
  const taken = new Set([...data.serviceDefinitions, ...(data.businessFlows ?? [])].map((e) => e.id));
  let id = `${flow.id}-copy`;
  for (let n = 2; taken.has(id); n++) id = `${flow.id}-copy-${n}`;
  return { ...structuredClone(flow), id, name: `${flow.name} (copy)`, source: { kind: 'authored' } };
}

export const suggestFlowId = (name: string) => (name.trim() ? `flow-${slug(name)}` : '');
export const nextId = (prefix: string, used: readonly string[]) => {
  let n = used.length + 1;
  while (used.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

export type FlowErrors = Record<string, string>;

/**
 * Field-level checks the server applies to the entity's own fields (backend fields.go): required
 * names, valid and unique IDs within the flow, a start step, event types on event transitions.
 * Keys are field paths such as `steps.2.name`.
 */
export function flowFieldErrors(draft: BusinessFlow): FlowErrors {
  const errors: FlowErrors = {};
  const idProblem = idError(draft.id);
  if (idProblem) errors.id = idProblem;
  if (!draft.name.trim()) errors.name = 'Required.';
  const seen = new Set<string>();
  const unique = (path: string, id: string) => {
    const problem = idError(id);
    if (problem) errors[path] = problem;
    else if (seen.has(id)) errors[path] = 'Used twice in this flow.';
    seen.add(id);
  };
  draft.steps.forEach((s, i) => {
    unique(`steps.${i}.id`, s.id);
    if (!s.name.trim()) errors[`steps.${i}.name`] = 'Required.';
    if (!s.serviceDefinitionId) errors[`steps.${i}.serviceDefinitionId`] = 'Required.';
    if (s.deadlineMs !== undefined && (!Number.isFinite(s.deadlineMs) || s.deadlineMs < 0)) errors[`steps.${i}.deadlineMs`] = 'A number of milliseconds, 0 or more.';
  });
  draft.outcomes.forEach((o, i) => {
    unique(`outcomes.${i}.id`, o.id);
    if (!o.name.trim()) errors[`outcomes.${i}.name`] = 'Required.';
  });
  if (draft.steps.length === 0) errors.steps = 'Add at least one step.';
  if (draft.outcomes.length === 0) errors.outcomes = 'Add at least one outcome.';
  if (!draft.steps.some((s) => s.id === draft.startStepId)) errors.startStepId = 'Choose the first step.';
  const transitionIds = new Set<string>();
  draft.transitions.forEach((t, i) => {
    const problem = idError(t.id);
    if (problem) errors[`transitions.${i}.id`] = problem;
    else if (transitionIds.has(t.id)) errors[`transitions.${i}.id`] = 'Used twice in this flow.';
    transitionIds.add(t.id);
    if (!t.from) errors[`transitions.${i}.from`] = 'Required.';
    if (!t.to) errors[`transitions.${i}.to`] = 'Required.';
    if (t.via.kind === 'event' && !t.via.eventTypeId) errors[`transitions.${i}.eventTypeId`] = 'Choose the event that carries the hand-off.';
    t.policies.forEach((p, j) => {
      if (!p.label.trim()) errors[`transitions.${i}.policies.${j}.label`] = 'Required.';
    });
  });
  if (draft.trigger.kind === 'event' && !draft.trigger.ref) errors['trigger.ref'] = 'Choose the event that starts the flow.';
  return errors;
}

const trimmed = (s: string | undefined) => (s === undefined || s.trim() === '' ? undefined : s.trim());

/** The entity sent to the API: trimmed text, empty optionals omitted, source kept. */
export function cleanFlow(draft: BusinessFlow): BusinessFlow {
  const optional = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  const step = (s: FlowStep): FlowStep =>
    optional({
      id: s.id.trim(),
      name: s.name.trim(),
      serviceDefinitionId: s.serviceDefinitionId,
      kind: s.kind,
      entryPoint: trimmed(s.entryPoint),
      deadlineMs: s.deadlineMs,
      compensatedBy: trimmed(s.compensatedBy),
    }) as FlowStep;
  const policy = (p: FlowPolicy): FlowPolicy => optional({ type: p.type, label: p.label.trim(), state: p.state, config: p.config && Object.keys(p.config).length ? p.config : undefined, stat: trimmed(p.stat) }) as FlowPolicy;
  const transition = (t: FlowTransition): FlowTransition =>
    optional({
      id: t.id.trim(),
      from: t.from,
      to: t.to,
      via: t.via.kind === 'call' ? optional({ kind: 'call' as const, callerServiceId: trimmed(t.via.callerServiceId) }) : t.via,
      condition: trimmed(t.condition),
      policies: t.policies.map(policy),
    }) as FlowTransition;
  const target = draft.target && (draft.target.p95Ms !== undefined || draft.target.completionMs !== undefined) ? optional({ ...draft.target }) : undefined;
  return optional({
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: trimmed(draft.description),
    owner: trimmed(draft.owner),
    team: trimmed(draft.team),
    trigger: optional({ kind: draft.trigger.kind, ref: draft.trigger.kind === 'call' || draft.trigger.kind === 'event' ? trimmed(draft.trigger.ref) : undefined }),
    startStepId: draft.startStepId,
    target,
    steps: draft.steps.map(step),
    transitions: draft.transitions.map(transition),
    outcomes: draft.outcomes.map((o) => ({ id: o.id.trim(), name: o.name.trim(), kind: o.kind })),
    source: draft.source,
    metadata: draft.metadata,
  }) as BusinessFlow;
}
