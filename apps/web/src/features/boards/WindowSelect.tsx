import { useId } from 'react';
import { WINDOWS } from '../../transit/board';
import type { TransitWindow } from '../../transit/types';
import { cx, fieldClass } from '../../shared/ui/classes';

/** The aggregation window of a board's typical mode (1h, 24h, 7d). */
export function WindowSelect({ value, onChange }: { value: TransitWindow; onChange: (window: TransitWindow) => void }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="text-xs text-fg-3">
        Window
      </label>
      <select id={id} className={cx(fieldClass, 'h-7.5 w-auto text-sm')} value={value} onChange={(e) => onChange(e.target.value as TransitWindow)}>
        {WINDOWS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
    </>
  );
}
