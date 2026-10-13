import { useId, type ReactNode } from 'react';
import { cx, fieldClass } from './classes';

/**
 * Accessible form fields shared by every editor (ADR-020 entity forms, ADR-022 flow editor). Each
 * field has a visible label, an optional hint, and an error that is announced with the control
 * (`aria-describedby`, `aria-invalid`, `aria-required`). `path` names the field for "focus the
 * first error" (`[data-path="…"]`); `name` is set when a form posts by name.
 */

interface FieldBase {
  label: ReactNode;
  required?: boolean | undefined;
  hint?: ReactNode;
  error?: string | undefined;
  /** Small labels for dense, nested forms (steps, transitions). */
  compact?: boolean | undefined;
  /** Text after the label, e.g. "· cannot be changed". */
  note?: ReactNode;
  path?: string | undefined;
  name?: string | undefined;
  autoFocus?: boolean | undefined;
}

interface ControlProps {
  id: string;
  name: string | undefined;
  'data-path': string | undefined;
  'data-autofocus': true | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

/** Label, control, hint, and error in a column; the control receives the wiring props. */
export function FormField({ label, required, hint, error, compact, note, path, name, autoFocus, children }: FieldBase & { children: (control: ControlProps) => ReactNode }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>
        {label}
        {required && <span className="font-normal text-fg-3"> (required)</span>}
        {note && <span className="font-normal text-fg-3"> {note}</span>}
      </label>
      {children({ id, name, 'data-path': path, 'data-autofocus': autoFocus ? true : undefined, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, 'aria-required': required ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-xs text-fg-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-xs text-crit-fg">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ value, onChange, mono, readOnly, ...field }: FieldBase & { value: string; onChange: (value: string) => void; mono?: boolean | undefined; readOnly?: boolean | undefined }) {
  return (
    <FormField {...field}>
      {(control) => (
        <input
          {...control}
          type="text"
          autoComplete="off"
          readOnly={readOnly}
          className={cx(fieldClass, 'w-full', mono && 'font-mono text-[12.5px]', readOnly && 'text-fg-2')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FormField>
  );
}

/** Milliseconds and other non-negative numbers; empty means "not set". */
export function NumberInput({ value, onChange, ...field }: FieldBase & { value: number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <FormField {...field}>
      {(control) => (
        <input
          {...control}
          type="number"
          min={0}
          inputMode="numeric"
          className={cx(fieldClass, 'w-full font-mono text-xs')}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )}
    </FormField>
  );
}

export interface Option {
  value: string;
  label: string;
}

/**
 * A select. `empty` adds a first option with the empty value (e.g. "No compensation"); a required
 * select without `empty` shows a disabled "Choose…" until a value is picked.
 */
export function SelectInput({ value, onChange, options, empty, ...field }: FieldBase & { value: string; onChange: (value: string) => void; options: readonly Option[]; empty?: string | undefined }) {
  return (
    <FormField {...field}>
      {(control) => (
        <select {...control} className={cx(fieldClass, 'w-full')} value={value} onChange={(e) => onChange(e.target.value)}>
          {empty !== undefined && <option value="">{empty}</option>}
          {empty === undefined && value === '' && (
            <option value="" disabled>
              Choose…
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

export function TextAreaInput({ value, onChange, mono, rows = 3, spellCheck = true, ...field }: FieldBase & { value: string; onChange: (value: string) => void; mono?: boolean | undefined; rows?: number; spellCheck?: boolean }) {
  return (
    <FormField {...field}>
      {(control) => (
        <textarea {...control} rows={rows} spellCheck={spellCheck} className={cx(fieldClass, 'h-auto w-full py-1.5', mono && 'font-mono text-[12.5px]')} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </FormField>
  );
}

/** Several checkboxes under one legend, with the count selected. */
export function CheckboxGroup({ label, required, hint, error, name, autoFocus, options, value, onChange }: FieldBase & { options: readonly Option[]; value: readonly string[]; onChange: (value: string[]) => void }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby={describedBy}>
      <legend className="mb-1 p-0 text-sm font-medium">
        {label}
        {required && <span className="font-normal text-fg-3"> (required)</span>} <span className="font-normal text-fg-3">· {value.length} selected</span>
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-xs text-fg-3">
          {hint}
        </p>
      )}
      {options.length === 0 ? (
        <p className="m-0 text-sm text-fg-3">Nothing to choose from yet.</p>
      ) : (
        <div className="max-h-44 overflow-auto rounded-md border border-control bg-surface-2 px-2 py-1">
          {options.map((option, i) => (
            <label key={option.value} className="flex items-center gap-2 py-0.5 text-sm">
              <input type="checkbox" name={name} value={option.value} checked={value.includes(option.value)} onChange={() => toggle(option.value)} data-autofocus={autoFocus && i === 0 ? true : undefined} />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-xs text-crit-fg">
          {error}
        </p>
      )}
    </fieldset>
  );
}
