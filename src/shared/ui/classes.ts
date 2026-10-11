/** Shared Tailwind class strings (ADR-013). Components that use them live in primitives.tsx. */

/** Join class names, skipping falsy values. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const BUTTON = {
  primary: 'h-8 px-3.5 font-semibold bg-accent text-on-accent hover:brightness-110',
  secondary: 'h-8 px-3 border border-line-strong text-fg hover:bg-surface-3',
  danger: 'h-8 px-3 font-semibold border border-crit text-crit-fg hover:bg-crit/10',
  ghost:
    'h-7.5 px-2.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg aria-pressed:bg-surface-3 aria-pressed:text-fg aria-expanded:bg-surface-3 aria-expanded:text-fg',
  icon: 'size-8.5 shrink-0 justify-center text-fg-2 hover:bg-surface-3 hover:text-fg',
} as const;
export type ButtonVariant = keyof typeof BUTTON;

export function buttonClass(variant: ButtonVariant = 'secondary', className?: string): string {
  return cx(
    'inline-flex items-center gap-1.5 rounded-md whitespace-nowrap disabled:opacity-50',
    BUTTON[variant],
    className,
  );
}

/** Segment (mock .sg). Pressed/checked: selected surface, ring, and an accent underline (state ≥ 3:1). */
export const segmentClass = cx(
  'flex h-6.5 items-center gap-1.5 rounded-sm px-2.75 text-sm whitespace-nowrap text-fg-2 hover:text-fg',
  'aria-pressed:bg-selected aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)] aria-pressed:[&_svg]:text-accent',
  'aria-checked:bg-selected aria-checked:text-fg aria-checked:shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-accent)]',
);

/** Floating panel over a canvas (mock .float). Position it with utilities. */
export const floatClass = 'absolute z-15 rounded-xl border border-line bg-float shadow-float backdrop-blur-[10px]';

/** Text inputs and selects: 3:1 control border, token surfaces. */
export const fieldClass =
  'h-8 min-w-0 rounded-md border border-control bg-surface-2 px-2.5 text-fg placeholder:text-fg-3';

/** Small uppercase label (mock .k / .h4). */
export const kickerClass = 'text-[10px] tracking-[0.07em] text-fg-3 uppercase';
