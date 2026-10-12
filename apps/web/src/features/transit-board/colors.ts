import type { BoardIndex } from '../../transit/board';
import type { PolicyStop } from '../../transit/types';

/** Token colour of a line: a categorical palette by position in the global (code) order. */
export function lineColor(index: BoardIndex, lineId: string): string {
  const position = index.lines.findIndex((l) => l.id === lineId);
  return `var(--transit-line-${(Math.max(0, position) % 12) + 1})`;
}

export const policyColor = (stop: PolicyStop) => `var(--transit-policy-${stop.type})`;

export const POLICY_STATE_LABEL: Record<PolicyStop['state'], string> = {
  exercised: 'declared and observed',
  idle: 'declared, not exercised in this window',
  missing: 'missing',
  unknown: 'unknown: config not loaded',
};
