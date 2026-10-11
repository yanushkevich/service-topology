import type { HealthStatus } from '../../domain/types';
import { healthLabel } from '../mappings';

const SHAPE: Record<HealthStatus, { className: string; glyph: string }> = {
  healthy: { className: 'status-ok', glyph: '✓' },
  degraded: { className: 'status-warn', glyph: '!' },
  unavailable: { className: 'status-crit', glyph: '×' },
  unknown: { className: 'status-unknown', glyph: '?' },
};

/** Health as shape + glyph + color; pair with a visible label or `label` for screen readers. */
export function StatusShape({ health, label }: { health: HealthStatus; label?: boolean }) {
  const shape = SHAPE[health] ?? SHAPE.unknown;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`status-shape ${shape.className}`} aria-hidden="true">
        {shape.glyph}
      </span>
      {label ? <span>{healthLabel(health)}</span> : <span className="sr-only">{healthLabel(health)}</span>}
    </span>
  );
}
