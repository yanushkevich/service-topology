import { Segment, Segmented } from '../../shared/ui/primitives';

/** Switches what a board's strip shows, e.g. Stops ↔ Process (ADR-028); the page keeps it in `strip`. */
export function StripSwitch<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { id: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <Segmented aria-label={label} className="mb-2.5 w-max">
      {options.map((o) => (
        <Segment key={o.id} pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </Segment>
      ))}
    </Segmented>
  );
}
