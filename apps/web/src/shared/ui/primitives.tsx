import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { buttonClass, cx, floatClass, kickerClass, segmentClass, type ButtonVariant } from './classes';
import { Icon } from './Icon';

/**
 * Shared Tailwind primitives (ADR-013). One definition per repeated pattern so the accessibility
 * decisions audited in Milestone 5 (pressed-state underline, 3:1 control borders, focus) cannot drift.
 */

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

/** Toggle chip (filters). Pressed = indigo border + tint (≥ 3:1). */
export function Chip({ pressed, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        'inline-flex h-6.5 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-sm whitespace-nowrap text-fg-2 hover:text-fg',
        'aria-pressed:border-indigo aria-pressed:bg-indigo/18 aria-pressed:text-fg aria-expanded:border-indigo aria-expanded:bg-indigo/18 aria-expanded:text-fg',
        className,
      )}
      {...props}
    />
  );
}

/** Segmented control container (mock .seg). */
export function Segmented({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cx('flex gap-0.5 rounded-[9px] border border-line bg-surface-2 p-[3px]', className)} {...props} />;
}

export function Segment({ pressed, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return <button type="button" aria-pressed={pressed} className={cx(segmentClass, className)} {...props} />;
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(floatClass, className)} {...props} />;
}

/** Section heading row with an optional count (mock .h4). */
export function Kicker({ children, count, as: Tag = 'h3', className }: { children: ReactNode; count?: ReactNode; as?: 'h2' | 'h3' | 'span'; className?: string }) {
  return (
    <Tag className={cx('m-0 mb-1.5 flex items-center justify-between gap-2 font-normal', kickerClass, className)}>
      <span>{children}</span>
      {count !== undefined && <span>{count}</span>}
    </Tag>
  );
}

/** One label/value row of a `<dl>`: label left, value right in monospace (stats, settings). */
export function KeyValueRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex justify-between gap-3 border-t border-line py-[5px] text-sm', className)}>
      <dt className="text-fg-3">{label}</dt>
      <dd className="m-0 text-right font-mono tabular-nums">{children}</dd>
    </div>
  );
}

/** Search box with a magnifier and a visually hidden label (lists and indexes). */
export function SearchField({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex h-9 items-center gap-2 rounded-md border border-control bg-surface-0 px-2.5 text-fg-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent', className)}>
      <Icon name="search" />
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="search"
        className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-fg placeholder:text-fg-3 focus-visible:outline-none"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

