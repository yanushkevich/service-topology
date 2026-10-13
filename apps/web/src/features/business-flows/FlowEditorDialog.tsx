import { useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { TopologyWriter } from '../../data/repositories/TopologyRepository';
import {
  FLOW_OUTCOME_KINDS,
  FLOW_POLICY_STATES,
  FLOW_POLICY_TYPES,
  FLOW_STEP_KINDS,
  FLOW_TRIGGER_KINDS,
  type BusinessFlow,
  type FlowPolicy,
  type FlowStep,
  type FlowTransition,
} from '../../domain/types';
import { Button } from '../../shared/ui/primitives';
import { kickerClass } from '../../shared/ui/classes';
import { NumberInput, SelectInput, TextInput } from '../../shared/ui/form';
import { Modal } from '../../shared/ui/Modal';
import { applyChange, idTaken, newIssues, type FormContext } from '../editing/entityForms';
import { IssueList } from '../editing/issues';
import { problemMessage, splitServerIssues, type DisplayIssue } from '../editing/issueMessages';
import { cleanFlow, flowFieldErrors, nextId, suggestFlowId, type FlowErrors } from './flowForm';
import { patternLabel } from '../../domain/patterns';

/**
 * Create or edit a business flow (ADR-022, Milestone 10 phase 6): basics, steps, outcomes, and
 * transitions with their policies. Checks the flow's own fields, then the whole topology with the
 * server's rules (every transition backed by a relationship or an event type), before sending.
 */
export function FlowEditorDialog({
  initial,
  creating,
  ctx,
  writer,
  reload,
  onClose,
  onSaved,
}: {
  initial: BusinessFlow;
  creating: boolean;
  ctx: FormContext;
  writer: TopologyWriter;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [draft, setDraft] = useState<BusinessFlow>(() => structuredClone(initial));
  const [idEdited, setIdEdited] = useState(!creating || initial.id !== '');
  const [errors, setErrors] = useState<FlowErrors>({});
  const [issues, setIssues] = useState<DisplayIssue[]>([]);
  const [message, setMessage] = useState<{ text: string; stale?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);

  const services = [...ctx.data.serviceDefinitions].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const events = [...(ctx.data.eventTypes ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const update = (change: (d: BusinessFlow) => void) => {
    setDraft((current) => {
      const next = structuredClone(current);
      change(next);
      if (creating && !idEdited) next.id = suggestFlowId(next.name);
      return next;
    });
    setErrors({});
  };
  const error = (path: string) => errors[path];

  const submit = async () => {
    setMessage(null);
    setIssues([]);
    const fieldErrors = flowFieldErrors(draft);
    if (creating && !fieldErrors.id && idTaken(ctx.data, draft.id)) fieldErrors.id = 'Already used by another entity. IDs are unique across all kinds.';
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      const first = Object.keys(fieldErrors)[0];
      form.current?.querySelector<HTMLElement>(`[data-path="${first}"]`)?.focus();
      return;
    }
    const entity = cleanFlow(draft);
    // The same whole-topology rules the server applies; only issues this change introduces count.
    const after = applyChange(ctx.data, 'business-flow', { op: creating ? 'create' : 'update', entity });
    const local = newIssues(ctx.data, after);
    if (local.length > 0) {
      setIssues(local);
      return;
    }
    setSaving(true);
    try {
      const saved = creating ? await writer.create('business-flow', entity) : await writer.update('business-flow', entity);
      await reload();
      onSaved(saved.id);
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 422) {
        const { fieldErrors: server, other } = splitServerIssues(e.issues);
        setErrors(server);
        setIssues(other);
      } else if (e instanceof ApiError && e.status === 409) {
        setMessage({ text: e.detail?.includes('imported') ? 'This flow is imported and read-only. Duplicate it to edit a copy.' : 'Already used by another entity.' });
      } else if (e instanceof ApiError && e.status === 412) {
        setMessage({ text: 'Someone changed the topology since it was loaded. Reload the latest data, check your changes, and save again.', stale: true });
      } else setMessage({ text: problemMessage(e) });
    }
  };

  const stepOptions = draft.steps.map((s) => ({ value: s.id, label: s.name || s.id }));
  const targetOptions = [...stepOptions, ...draft.outcomes.map((o) => ({ value: o.id, label: `${o.name || o.id} (outcome)` }))];
  const title = creating ? 'New business flow' : 'Edit business flow';

  return (
    <Modal
      side
      title={title}
      description={creating ? 'Steps owned by services, the transitions between them, and the policies on every hand-off. Every transition between services must exist in the topology.' : <span className="font-mono">{initial.id}</span>}
      onClose={onClose}
      closeLabel={`Close ${title.toLowerCase()}`}
      busy={saving}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={saving}>
            {saving ? 'Saving…' : creating ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4"
      >
        {message && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-crit px-3 py-2 text-sm text-crit-fg">
            <span className="min-w-0 flex-1">{message.text}</span>
            {message.stale && (
              <Button
                onClick={() => {
                  setMessage(null);
                  void reload().catch((e: unknown) => setMessage({ text: problemMessage(e) }));
                }}
              >
                Reload data
              </Button>
            )}
          </div>
        )}
        <IssueList issues={issues} title="This flow would break the topology:" ctx={ctx} />

        <Group legend="Basics">
          <TextInput compact label="Name" path="name" required value={draft.name} error={error('name')} autoFocus onChange={(v) => update((d) => void (d.name = v))} />
          <TextInput
            compact
            label="ID"
            path="id"
            required
            mono
            value={draft.id}
            error={error('id')}
            readOnly={!creating}
            hint={creating ? 'Stable and unique across all entities. Cannot be changed later.' : undefined}
            onChange={(v) => {
              setIdEdited(true);
              update((d) => void (d.id = v));
            }}
          />
          <TextInput compact label="Description" path="description" value={draft.description ?? ''} onChange={(v) => update((d) => void (d.description = v))} />
          <div className="grid grid-cols-2 gap-2">
            <TextInput compact label="Owner" path="owner" value={draft.owner ?? ''} onChange={(v) => update((d) => void (d.owner = v))} />
            <TextInput compact label="Team" path="team" value={draft.team ?? ''} onChange={(v) => update((d) => void (d.team = v))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectInput
            compact
              label="Trigger"
              path="trigger.kind"
              value={draft.trigger.kind}
              options={FLOW_TRIGGER_KINDS.map((k) => ({ value: k, label: k }))}
              onChange={(v) => update((d) => void (d.trigger = { kind: v as BusinessFlow['trigger']['kind'] }))}
            />
            {draft.trigger.kind === 'call' && (
              <SelectInput compact label="Called by" path="trigger.ref" value={draft.trigger.ref ?? ''} empty="A client" options={services.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => update((d) => void (d.trigger = v ? { kind: 'call', ref: v } : { kind: 'call' }))} />
            )}
            {draft.trigger.kind === 'event' && (
              <SelectInput compact label="Started by event" path="trigger.ref" value={draft.trigger.ref ?? ''} empty="Choose" error={error('trigger.ref')} options={events.map((e) => ({ value: e.id, label: e.name }))} onChange={(v) => update((d) => void (d.trigger = v ? { kind: 'event', ref: v } : { kind: 'event' }))} />
            )}
          </div>
          <SelectInput compact label="First step" path="startStepId" required value={draft.startStepId} error={error('startStepId')} empty="Choose" options={stepOptions} onChange={(v) => update((d) => void (d.startStepId = v))} />
          <div className="grid grid-cols-2 gap-2">
            <NumberInput compact label="Target p95 (ms)" path="target.p95Ms" value={draft.target?.p95Ms} onChange={(v) => update((d) => void (d.target = withTarget(d.target, 'p95Ms', v)))} />
            <NumberInput compact label="Completion target (ms)" path="target.completionMs" value={draft.target?.completionMs} onChange={(v) => update((d) => void (d.target = withTarget(d.target, 'completionMs', v)))} />
          </div>
        </Group>

        <Group legend={`Steps (${draft.steps.length})`} error={error('steps')}>
          {draft.steps.map((step, i) => (
            <StepFields
              key={i}
              n={i + 1}
              step={step}
              services={services}
              compensations={draft.steps.filter((s) => s.kind === 'compensation' && s.id !== step.id)}
              error={(field) => error(`steps.${i}.${field}`)}
              onChange={(change) => update((d) => change(d.steps[i] as FlowStep))}
              onRemove={draft.steps.length > 1 ? () => update((d) => void d.steps.splice(i, 1)) : undefined}
            />
          ))}
          <Button onClick={() => update((d) => void d.steps.push({ id: nextId('step', d.steps.map((s) => s.id)), name: '', serviceDefinitionId: services[0]?.id ?? '', kind: 'task' }))}>Add step</Button>
        </Group>

        <Group legend={`Outcomes (${draft.outcomes.length})`} error={error('outcomes')}>
          {draft.outcomes.map((o, i) => (
            <fieldset key={i} className="m-0 grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border border-line p-2">
              <legend className={kickerClass}>Outcome {i + 1}</legend>
              <TextInput compact label={`Outcome ${i + 1} ID`} path={`outcomes.${i}.id`} mono required value={o.id} error={error(`outcomes.${i}.id`)} onChange={(v) => update((d) => void ((d.outcomes[i] as (typeof d.outcomes)[number]).id = v))} />
              <TextInput compact label={`Outcome ${i + 1} name`} path={`outcomes.${i}.name`} required value={o.name} error={error(`outcomes.${i}.name`)} onChange={(v) => update((d) => void ((d.outcomes[i] as (typeof d.outcomes)[number]).name = v))} />
              <SelectInput
            compact
                label={`Outcome ${i + 1} kind`}
                path={`outcomes.${i}.kind`}
                value={o.kind}
                options={FLOW_OUTCOME_KINDS.map((k) => ({ value: k, label: k }))}
                onChange={(v) => update((d) => void ((d.outcomes[i] as (typeof d.outcomes)[number]).kind = v as (typeof d.outcomes)[number]['kind']))}
              />
              {draft.outcomes.length > 1 && (
                <Button className="col-span-3 justify-self-start" onClick={() => update((d) => void d.outcomes.splice(i, 1))}>
                  Remove outcome {i + 1}
                </Button>
              )}
            </fieldset>
          ))}
          <Button onClick={() => update((d) => void d.outcomes.push({ id: nextId('outcome', d.outcomes.map((o) => o.id)), name: '', kind: 'success' }))}>Add outcome</Button>
        </Group>

        <Group legend={`Transitions (${draft.transitions.length})`}>
          {draft.transitions.map((t, i) => (
            <TransitionFields
              key={i}
              n={i + 1}
              t={t}
              stepOptions={stepOptions}
              targetOptions={targetOptions}
              services={services}
              events={events}
              error={(field) => error(`transitions.${i}.${field}`)}
              onChange={(change) => update((d) => change(d.transitions[i] as FlowTransition))}
              onRemove={() => update((d) => void d.transitions.splice(i, 1))}
            />
          ))}
          <Button
            onClick={() =>
              update((d) => void d.transitions.push({ id: nextId('t', d.transitions.map((x) => x.id)), from: d.steps[0]?.id ?? '', to: d.outcomes[0]?.id ?? '', via: { kind: 'local' }, policies: [] }))
            }
          >
            Add transition
          </Button>
        </Group>
      </form>
    </Modal>
  );
}

function withTarget(target: BusinessFlow['target'], key: 'p95Ms' | 'completionMs', value: number | undefined): NonNullable<BusinessFlow['target']> {
  const rest = Object.fromEntries(Object.entries(target ?? {}).filter(([k]) => k !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

function Group({ legend, error, children }: { legend: string; error?: string | undefined; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 border-t border-line p-0 pt-3">
      <legend className="pr-2 text-sm font-semibold">{legend}</legend>
      {error && <p className="m-0 text-xs text-crit-fg">{error}</p>}
      {children}
    </fieldset>
  );
}

function StepFields({
  n,
  step,
  services,
  compensations,
  error,
  onChange,
  onRemove,
}: {
  n: number;
  step: FlowStep;
  services: { id: string; name: string }[];
  compensations: FlowStep[];
  error: (field: string) => string | undefined;
  onChange: (change: (s: FlowStep) => void) => void;
  onRemove: (() => void) | undefined;
}) {
  const p = (f: string) => `steps.${n - 1}.${f}`;
  return (
    <fieldset className="m-0 grid grid-cols-2 gap-2 rounded-lg border border-line p-2">
      <legend className={kickerClass}>Step {n}</legend>
      <TextInput compact label={`Step ${n} name`} path={p('name')} required value={step.name} error={error('name')} onChange={(v) => onChange((s) => void (s.name = v))} />
      <TextInput compact label={`Step ${n} ID`} path={p('id')} required mono value={step.id} error={error('id')} onChange={(v) => onChange((s) => void (s.id = v))} />
      <SelectInput compact label={`Step ${n} service`} path={p('serviceDefinitionId')} required value={step.serviceDefinitionId} error={error('serviceDefinitionId')} empty="Choose" options={services.map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => onChange((s) => void (s.serviceDefinitionId = v))} />
      <SelectInput compact label={`Step ${n} kind`} path={p('kind')} value={step.kind} options={FLOW_STEP_KINDS.map((k) => ({ value: k, label: k }))} onChange={(v) => onChange((s) => void (s.kind = v as FlowStep['kind']))} />
      <TextInput compact label={`Step ${n} entry point`} path={p('entryPoint')} mono value={step.entryPoint ?? ''} hint="Operation that implements it, e.g. Authorize." onChange={(v) => onChange((s) => void (s.entryPoint = v))} />
      <NumberInput compact label={`Step ${n} deadline (ms)`} path={p('deadlineMs')} value={step.deadlineMs} error={error('deadlineMs')} onChange={(v) => onChange((s) => void (v === undefined ? delete s.deadlineMs : (s.deadlineMs = v)))} />
      <SelectInput
            compact
        label={`Step ${n} undone by`}
        path={p('compensatedBy')}
        value={step.compensatedBy ?? ''}
        empty="No compensation"
        options={compensations.map((c) => ({ value: c.id, label: c.name || c.id }))}
        onChange={(v) => onChange((s) => void (v ? (s.compensatedBy = v) : delete s.compensatedBy))}
      />
      {onRemove && (
        <Button className="self-end justify-self-start" onClick={onRemove}>
          Remove step {n}
        </Button>
      )}
    </fieldset>
  );
}

function TransitionFields({
  n,
  t,
  stepOptions,
  targetOptions,
  services,
  events,
  error,
  onChange,
  onRemove,
}: {
  n: number;
  t: FlowTransition;
  stepOptions: { value: string; label: string }[];
  targetOptions: { value: string; label: string }[];
  services: { id: string; name: string }[];
  events: { id: string; name: string }[];
  error: (field: string) => string | undefined;
  onChange: (change: (t: FlowTransition) => void) => void;
  onRemove: () => void;
}) {
  const p = (f: string) => `transitions.${n - 1}.${f}`;
  return (
    <fieldset className="m-0 grid grid-cols-2 gap-2 rounded-lg border border-line p-2">
      <legend className={kickerClass}>Transition {n}</legend>
      <SelectInput compact label={`Transition ${n} from`} path={p('from')} required value={t.from} error={error('from')} empty="Choose" options={stepOptions} onChange={(v) => onChange((x) => void (x.from = v))} />
      <SelectInput compact label={`Transition ${n} to`} path={p('to')} required value={t.to} error={error('to')} empty="Choose" options={targetOptions} onChange={(v) => onChange((x) => void (x.to = v))} />
      <SelectInput
            compact
        label={`Transition ${n} via`}
        path={p('via')}
        value={t.via.kind}
        options={[
          { value: 'local', label: 'in the same service' },
          { value: 'call', label: 'call' },
          { value: 'event', label: 'event' },
        ]}
        onChange={(v) => onChange((x) => void (x.via = v === 'event' ? { kind: 'event', eventTypeId: '' } : v === 'call' ? { kind: 'call' } : { kind: 'local' }))}
      />
      {t.via.kind === 'call' && (
        <SelectInput
            compact
          label={`Transition ${n} caller`}
          path={p('callerServiceId')}
          value={t.via.callerServiceId ?? ''}
          empty="The source step’s service"
          options={services.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(v) => onChange((x) => void (x.via = v ? { kind: 'call', callerServiceId: v } : { kind: 'call' }))}
        />
      )}
      {t.via.kind === 'event' && (
        <SelectInput compact label={`Transition ${n} event`} path={p('eventTypeId')} required value={t.via.eventTypeId} error={error('eventTypeId')} empty="Choose" options={events.map((e) => ({ value: e.id, label: e.name }))} onChange={(v) => onChange((x) => void (x.via = { kind: 'event', eventTypeId: v }))} />
      )}
      <TextInput compact label={`Transition ${n} ID`} path={p('id')} required mono value={t.id} error={error('id')} onChange={(v) => onChange((x) => void (x.id = v))} />
      <TextInput compact label={`Transition ${n} condition`} path={p('condition')} value={t.condition ?? ''} hint="Leave empty when it always runs." onChange={(v) => onChange((x) => void (v ? (x.condition = v) : delete x.condition))} />
      <div className="col-span-2 flex flex-col gap-1.5">
        <span className={kickerClass}>Policies</span>
        {t.policies.map((policy, j) => (
          <PolicyFields key={j} label={`Transition ${n} policy ${j + 1}`} path={p(`policies.${j}`)} policy={policy} error={error(`policies.${j}.label`)} onChange={(change) => onChange((x) => change(x.policies[j] as FlowPolicy))} onRemove={() => onChange((x) => void x.policies.splice(j, 1))} />
        ))}
        <Button className="self-start" onClick={() => onChange((x) => void x.policies.push({ type: 'timeout', label: '', state: 'exercised' }))}>
          Add policy to transition {n}
        </Button>
      </div>
      <Button className="col-span-2 justify-self-start" onClick={onRemove}>
        Remove transition {n}
      </Button>
    </fieldset>
  );
}

function PolicyFields({ label, path, policy, error, onChange, onRemove }: { label: string; path: string; policy: FlowPolicy; error: string | undefined; onChange: (change: (p: FlowPolicy) => void) => void; onRemove: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-1.5">
      <SelectInput compact label={`${label} type`} path={`${path}.type`} value={policy.type} options={FLOW_POLICY_TYPES.map((t) => ({ value: t, label: patternLabel(t) }))} onChange={(v) => onChange((p) => void (p.type = v as FlowPolicy['type']))} />
      <TextInput compact label={`${label} label`} path={`${path}.label`} required value={policy.label} error={error} onChange={(v) => onChange((p) => void (p.label = v))} />
      <SelectInput compact label={`${label} state`} path={`${path}.state`} value={policy.state ?? 'exercised'} options={FLOW_POLICY_STATES.map((s) => ({ value: s, label: s }))} onChange={(v) => onChange((p) => void (p.state = v as NonNullable<FlowPolicy['state']>))} />
      <Button aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}
