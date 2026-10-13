import type { ReactNode } from 'react';

/** One settings row: a label with an optional hint, and its control. */
export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold">{label}</div>
        {hint && <div className="text-sm text-fg-2">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
