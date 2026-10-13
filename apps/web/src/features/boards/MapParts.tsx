import { useEffect, useRef, type ReactNode } from 'react';
import type { StationGeometry } from '../../transit/layout';
import { cx, floatClass } from '../../shared/ui/classes';

/**
 * SVG and overlay pieces shared by the transit map and the flow map. Paths are precomputed by the
 * layout; these components only choose styles, so selection and replay never rebuild geometry.
 */

export type LineState = 'normal' | 'dim' | 'hidden';

/** Blur used for shadows and the selected line's glow; one per map (pass its id to the lines). */
export function GlowFilter({ id }: { id: string }) {
  return (
    <defs>
      <filter id={id}>
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>
  );
}

/**
 * One line segment drawn as a raised ribbon: an invisible wide hit path, a blurred shadow, five
 * faint copies at increasing height, and the top line. Dimmed lines collapse to a thin grey;
 * a hidden line leaves room for the selected copy in the overlay.
 */
export function RibbonLine({ top, shadow, ribbons, color, state, dash, blurId }: { top: string; shadow: string; ribbons: string[]; color: string; state: LineState; dash?: string | undefined; blurId: string }) {
  const normal = state === 'normal';
  return (
    <>
      <path d={top} fill="none" stroke="transparent" strokeWidth={16} />
      <path d={shadow} fill="none" stroke="var(--transit-shadow)" strokeWidth={10} filter={`url(#${blurId})`} opacity={normal ? 1 : 0} />
      {ribbons.map((d, r) => (
        <path key={r} d={d} fill="none" stroke={color} strokeOpacity={normal ? 0.2 : 0} strokeWidth={5} strokeLinejoin="round" strokeDasharray={dash} />
      ))}
      <path
        d={top}
        data-top
        fill="none"
        stroke={normal ? color : 'var(--transit-dim)'}
        strokeOpacity={normal ? 1 : state === 'dim' ? 0.22 : 0}
        strokeWidth={normal ? 5 : 3}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={dash}
      />
    </>
  );
}

/** The selected line redrawn on top: a soft glow and a wider line. `data` marks it for tests. */
export function SelectedLine({ d, color, dash, blurId, data }: { d: string; color: string; dash?: string | undefined; blurId: string; data: Record<string, string> }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={17} filter={`url(#${blurId})`} />
      <path d={d} {...data} fill="none" stroke={color} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} />
    </g>
  );
}

/** A station's upright label with a halo; the second line (`sub`) only where the layout allows it. */
export function StationLabel({ label, name, sub, subFill, flat }: { label: StationGeometry['label']; name: string; sub?: string | undefined; subFill?: string | undefined; flat: boolean }) {
  return (
    <text
      data-label
      x={label.x}
      y={label.y}
      textAnchor={label.anchor}
      fontFamily="var(--font-sans)"
      fontWeight={600}
      fontSize={flat ? 13 : 15}
      fill="var(--color-text)"
      stroke="var(--color-stage)"
      strokeWidth={4}
      paintOrder="stroke"
    >
      {name}
      {label.withSub && sub && (
        <tspan x={label.x} dy={14} fontFamily="var(--font-mono)" fontWeight={400} fontSize={11.5} fill={subFill ?? 'var(--color-text-3)'}>
          {sub}
        </tspan>
      )}
    </text>
  );
}

/** Hover tooltip above a map point. Not focusable: the lists and strips carry the same content. */
export function MapTooltip({ position, children }: { position: { left: string; top: string }; children: ReactNode }) {
  return (
    <div role="tooltip" className={cx(floatClass, 'pointer-events-none z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+14px)] px-3 py-2 text-xs')} style={position}>
      {children}
    </div>
  );
}

/**
 * Asks which line (or flow) a click on a shared station meant, instead of guessing (spec
 * "Selection"). Focus moves into it; Escape closes it.
 */
export function MapChooser({
  label,
  heading,
  items,
  position,
  onPick,
  onClose,
}: {
  label: string;
  heading: ReactNode;
  items: { id: string; badge: ReactNode; text: string; mono?: boolean }[];
  position: { left: string; top: string };
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, [label]);
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cx(floatClass, 'z-20 w-[220px] p-1.5')}
      style={{ left: `min(calc(${position.left} + 12px), calc(100% - 228px))`, top: position.top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="m-0 px-2 py-1 text-xs text-fg-3">{heading}</p>
      {items.map((item) => (
        <button key={item.id} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => onPick(item.id)}>
          {item.badge}
          <span className={cx('truncate text-xs', item.mono && 'font-mono')}>{item.text}</span>
        </button>
      ))}
    </div>
  );
}

/** Map background: the grid and the column or service bands with their captions. */
export function MapGround({ grid, bands, captions = true, captionSize = 10, captionSpacing = 4 }: { grid: string[]; bands: { d: string; label: string; x: number; y: number }[]; captions?: boolean; captionSize?: number; captionSpacing?: number }) {
  return (
    <>
      {grid.map((d, i) => (
        <path key={i} d={d} stroke="var(--color-line)" strokeOpacity={0.5} fill="none" pointerEvents="none" />
      ))}
      {bands.map((band) => (
        <g key={band.label} pointerEvents="none">
          <path d={band.d} fill="var(--color-text-3)" fillOpacity={0.03} stroke="var(--color-line)" />
          {captions && (
            <text x={band.x} y={band.y} fontFamily="var(--font-mono)" fontSize={captionSize} letterSpacing={captionSpacing} fill="var(--color-text-3)">
              {band.label}
            </text>
          )}
        </g>
      ))}
    </>
  );
}
