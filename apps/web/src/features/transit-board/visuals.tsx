import type { BoardIndex } from '../../transit/board';
import type { Finding, PolicyStop, ProvenanceKind } from '../../transit/types';
import { cx } from '../../shared/ui/classes';
import { lineColor, policyColor } from './colors';

/** Line code badge: token colour with contrast-tested text. */
export function LineBadge({ index, lineId, code, large }: { index: BoardIndex; lineId: string; code: string; large?: boolean }) {
  return (
    <span
      className={cx(
        'grid flex-none place-items-center rounded-[5px] font-mono font-medium text-[var(--transit-on-line)]',
        large ? 'h-6.5 w-8.5 text-sm' : 'h-5 w-7 text-[10.5px]',
      )}
      style={{ background: lineColor(index, lineId) }}
      aria-hidden="true"
    >
      {code}
    </span>
  );
}

const PROVENANCE: Record<ProvenanceKind, { label: string; className: string }> = {
  declared: { label: 'declared', className: 'bg-indigo/15 text-fg' },
  observed: { label: 'observed', className: 'bg-ok/15 text-fg' },
  inferred: { label: 'inferred', className: 'bg-warn/15 text-fg' },
};

/** Provenance is always a word, never colour alone; the tint is secondary, so the text stays the body colour. */
export function ProvenanceTag({ kind }: { kind: ProvenanceKind }) {
  const p = PROVENANCE[kind];
  return (
    <span className={cx('inline-flex h-[18px] items-center rounded px-1.5 font-mono text-2xs tracking-[0.06em] whitespace-nowrap uppercase', p.className)}>
      {p.label}
    </span>
  );
}

const SEVERITY: Record<Finding['severity'], string> = { warn: 'Warning', ok: 'Good', info: 'Note' };

/** Severity uses a shape and a word (spec "Accessibility"). */
export function SeverityMark({ severity }: { severity: Finding['severity'] }) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="flex-none">
        {severity === 'warn' ? (
          <path d="M6 0.5 11.5 11.5H0.5Z" fill="var(--color-warn)" />
        ) : severity === 'ok' ? (
          <circle cx="6" cy="6" r="5" fill="var(--color-ok)" />
        ) : (
          <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="var(--color-text-3)" strokeWidth="1.6" />
        )}
      </svg>
      <span className={cx('font-mono text-2xs tracking-[0.06em] uppercase', severity === 'warn' ? 'text-warn-fg' : severity === 'ok' ? 'text-ok-fg' : 'text-fg-3')}>
        {SEVERITY[severity]}
      </span>
    </span>
  );
}

/** Policy stop marker in SVG coordinates centred on (x, y): fill and outline encode its state. */
export function PolicyDiamond({ stop, x, y, size = 12 }: { stop: PolicyStop; x: number; y: number; size?: number }) {
  const half = size / 2;
  const common = { x: x - half, y: y - half, width: size, height: size, transform: `rotate(45 ${x} ${y})` };
  switch (stop.state) {
    case 'exercised':
      return <rect {...common} fill={policyColor(stop)} stroke="var(--transit-station-ring)" strokeWidth={2} />;
    case 'idle':
      return <rect {...common} fill="var(--color-stage)" stroke={policyColor(stop)} strokeWidth={2} />;
    case 'missing':
      return <rect {...common} fill="var(--color-stage)" stroke="var(--color-warn)" strokeWidth={1.6} strokeDasharray="3 2" />;
    case 'unknown':
      return (
        <g>
          <rect {...common} fill="var(--color-stage)" stroke="var(--color-text-3)" strokeWidth={1.6} />
          <text x={x} y={y + 3.5} textAnchor="middle" fontSize={size * 0.8} fontFamily="var(--font-mono)" fill="var(--color-text-2)">
            ?
          </text>
        </g>
      );
  }
}
