import { useId, useRef, useState } from 'react';
import { ApiError } from '../../data/http/apiClient';
import type { EntityOfKind, TopologyWriter, WritableKind } from '../../data/repositories/TopologyRepository';
import { Button } from '../../shared/ui/primitives';
import { cx, fieldClass } from '../../shared/ui/classes';
import { Modal } from '../../shared/ui/Modal';
import {
  KIND_HINTS,
  KIND_LABELS,
  applyChange,
  emptyValues,
  entityFromValues,
  fieldsFor,
  idTaken,
  newIssues,
  suggestId,
  valuesFromEntity,
  type FieldErrors,
  type FieldSpec,
  type FormContext,
  type FormValues,
} from './entityForms';
import { IssueList } from './issues';
import { problemMessage, splitServerIssues, type DisplayIssue } from './issueMessages';

/** Create or edit one entity (ADR-020). Checks locally with the server's rules before sending. */
export function EntityEditorDialog<K extends WritableKind>({
  kind,
  existing,
  ctx,
  writer,
  reload,
  onClose,
  onSaved,
}: {
  kind: K;
  existing: EntityOfKind[K] | null;
  ctx: FormContext;
  writer: TopologyWriter;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const creating = existing === null;
  const fields = fieldsFor(kind, ctx);
  const [values, setValues] = useState<FormValues>(() => (existing ? valuesFromEntity(kind, existing, ctx) : emptyValues(kind, ctx)));
  const [idEdited, setIdEdited] = useState(!creating);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [issues, setIssues] = useState<DisplayIssue[]>([]);
  const [message, setMessage] = useState<{ text: string; stale?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);

  const set = (name: string, value: string | string[]) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      if (creating && !idEdited && name !== 'id') next.id = suggestId(kind, next);
      return next;
    });
    if (name === 'id') setIdEdited(true);
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== name)));
  };

  const focusFirstError = (fieldErrors: FieldErrors) => {
    const first = fields.find((f) => fieldErrors[f.name]);
    if (first) form.current?.querySelector<HTMLElement>(`[name="${first.name}"]`)?.focus();
  };

  const submit = async () => {
    setMessage(null);
    setIssues([]);
    const built = entityFromValues(kind, values, ctx, existing);
    if (built.errors) {
      setErrors(built.errors);
      focusFirstError(built.errors);
      return;
    }
    const entity = built.entity;
    if (creating && idTaken(ctx.data, entity.id)) {
      const e = { id: 'Already used by another entity. IDs are unique across all kinds.' };
      setErrors(e);
      focusFirstError(e);
      return;
    }
    // The same whole-topology rules the server applies; only issues this change introduces count.
    const after = applyChange(ctx.data, kind, { op: creating ? 'create' : 'update', entity });
    const local = newIssues(ctx.data, after);
    if (local.length > 0) {
      setIssues(local);
      return;
    }
    setSaving(true);
    try {
      const saved = creating ? await writer.create(kind, entity) : await writer.update(kind, entity);
      await reload();
      onSaved(saved.id);
    } catch (error) {
      setSaving(false);
      if (error instanceof ApiError && error.status === 422) {
        const { fieldErrors, other } = splitServerIssues(error.issues);
        setErrors(fieldErrors);
        setIssues(other);
        if (Object.keys(fieldErrors).length > 0) focusFirstError(fieldErrors);
      } else if (error instanceof ApiError && error.status === 409) {
        setErrors({ id: 'Already used by another entity.' });
      } else if (error instanceof ApiError && error.status === 412) {
        setMessage({ text: 'Someone changed the topology since it was loaded. Reload the latest data, check your changes, and save again.', stale: true });
      } else {
        setMessage({ text: problemMessage(error) });
      }
    }
  };

  const title = `${creating ? 'New' : 'Edit'} ${KIND_LABELS[kind].toLowerCase()}`;
  // Start where typing makes sense: the name (the ID follows from it), else the first editable field.
  const firstEditable = (fields.find((f) => f.name === 'name') ?? fields.find((f) => creating || !f.lockedOnEdit))?.name;
  return (
    <Modal
      side
      title={title}
      description={creating ? KIND_HINTS[kind] : <span className="font-mono">{existing.id}</span>}
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
        className="flex flex-col gap-3.5"
      >
        {!creating && (kind === 'service-instance' || kind === 'resource' || kind === 'relationship') && (
          <p className="m-0 text-sm text-fg-3">“Updated” is set when you save. Telemetry is not editable; simulated values stay labelled as simulated.</p>
        )}
        {message && (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-crit px-3 py-2 text-sm text-crit-fg">
            <span className="min-w-0 flex-1">{message.text}</span>
            {message.stale && (
              <Button
                onClick={() => {
                  setMessage(null);
                  void reload().catch((error: unknown) => setMessage({ text: problemMessage(error) }));
                }}
              >
                Reload data
              </Button>
            )}
          </div>
        )}
        <IssueList issues={issues} title="This change would break the topology:" ctx={ctx} />
        {fields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name] ?? ''}
            error={errors[field.name]}
            locked={!creating && !!field.lockedOnEdit}
            autoFocus={field.name === firstEditable}
            onChange={(v) => set(field.name, v)}
          />
        ))}
      </form>
    </Modal>
  );
}

function FormField({
  field,
  value,
  error,
  locked,
  autoFocus,
  onChange,
}: {
  field: FieldSpec;
  value: string | string[];
  error: string | undefined;
  locked: boolean;
  autoFocus: boolean;
  onChange: (value: string | string[]) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [field.hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  const label = (
    <>
      {field.label}
      {field.required && <span className="text-fg-3"> (required)</span>}
    </>
  );
  const hint = field.hint && (
    <p id={hintId} className="m-0 text-xs text-fg-3">
      {field.hint}
    </p>
  );
  const errorText = error && (
    <p id={errorId} className="m-0 text-xs text-crit-fg">
      {error}
    </p>
  );

  if (field.control === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    return (
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby={describedBy}>
        <legend className="mb-1 p-0 text-sm font-medium">
          {label} <span className="font-normal text-fg-3">· {selected.length} selected</span>
        </legend>
        {hint}
        {(field.options ?? []).length === 0 ? (
          <p className="m-0 text-sm text-fg-3">Nothing to choose from yet.</p>
        ) : (
          <div className="max-h-44 overflow-auto rounded-md border border-control bg-surface-2 px-2 py-1">
            {(field.options ?? []).map((option) => (
              <label key={option.value} className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  name={field.name}
                  value={option.value}
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  data-autofocus={autoFocus && option === field.options?.[0] ? true : undefined}
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
          </div>
        )}
        {errorText}
      </fieldset>
    );
  }

  const text = typeof value === 'string' ? value : '';
  const common = {
    id,
    name: field.name,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': field.required ? true : undefined,
    'data-autofocus': autoFocus ? true : undefined,
  } as const;
  let control;
  if (field.control === 'select') {
    control = (
      <select {...common} className={cx(fieldClass, 'w-full')} value={text} onChange={(e) => onChange(e.target.value)}>
        {!field.required && <option value="">{field.emptyLabel ?? '—'}</option>}
        {field.required && text === '' && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (field.control === 'textarea' || field.control === 'json') {
    control = (
      <textarea
        {...common}
        rows={field.control === 'json' ? 4 : 3}
        spellCheck={field.control !== 'json'}
        className={cx(fieldClass, 'h-auto w-full py-1.5', field.mono && 'font-mono text-[12.5px]')}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    control = (
      <input
        {...common}
        type="text"
        autoComplete="off"
        readOnly={locked}
        className={cx(fieldClass, 'w-full', field.mono && 'font-mono text-[12.5px]', locked && 'text-fg-2')}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {locked && <span className="font-normal text-fg-3"> · cannot be changed</span>}
      </label>
      {control}
      {hint}
      {errorText}
    </div>
  );
}
