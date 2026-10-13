import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import { cx } from '../../shared/ui/classes';
import { flowColor } from './flowVisuals';

/** Flow code badge (e.g. CH for Checkout) in the flow's line colour. */
export function FlowBadge({ fx, flowId, large }: { fx: FlowBoardIndex; flowId: string; large?: boolean }) {
  return (
    <span
      className={cx('grid flex-none place-items-center rounded-[5px] font-mono font-medium text-[var(--transit-on-line)]', large ? 'h-6.5 w-8.5 text-sm' : 'h-5 w-7 text-[10.5px]')}
      style={{ background: flowColor(fx, flowId) }}
      aria-hidden="true"
    >
      {fx.codes.get(flowId)}
    </span>
  );
}
