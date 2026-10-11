import type { HealthStatus } from '../../domain/types';
import { healthLabel } from '../mappings';
import styles from './glyphs.module.css';

const SHAPE: Record<HealthStatus, { className: string | undefined; glyph: string }> = {
  healthy: { className: styles.ok, glyph: '✓' },
  degraded: { className: styles.warn, glyph: '!' },
  unavailable: { className: styles.crit, glyph: '×' },
  unknown: { className: styles.unknown, glyph: '?' },
};

/** Health as shape + glyph + color; pair with a visible label or `label` for screen readers. */
export function StatusShape({ health, label }: { health: HealthStatus; label?: boolean }) {
  const shape = SHAPE[health] ?? SHAPE.unknown;
  return (
    <span className={styles.statusWrap}>
      <span className={`${styles.status} ${shape.className}`} aria-hidden="true">
        {shape.glyph}
      </span>
      {label ? <span>{healthLabel(health)}</span> : <span className="visually-hidden">{healthLabel(health)}</span>}
    </span>
  );
}
