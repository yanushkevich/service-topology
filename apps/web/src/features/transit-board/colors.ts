import type { BoardIndex } from '../../transit/board';
import type { PolicyStop } from '../../transit/types';

/** Token colour of a line: a categorical palette by position in the global (code) order. */
export function lineColor(index: BoardIndex, lineId: string): string {
  const position = index.lines.findIndex((l) => l.id === lineId);
  return `var(--transit-line-${(Math.max(0, position) % 12) + 1})`;
}

/** What a policy marker needs: a transit policy stop or a business-flow policy (ADR-022). */
export interface PolicyMarker {
  type: string;
  /** Absent means declared without observations (drawn like 'idle'). */
  state?: PolicyStop['state'] | undefined;
}

export const policyColor = (stop: PolicyMarker) => `var(--transit-policy-${stop.type})`;

export const POLICY_STATE_LABEL: Record<PolicyStop['state'], string> = {
  exercised: 'declared and observed',
  idle: 'declared, not exercised in this window',
  missing: 'missing',
  unknown: 'unknown: config not loaded',
};

/** One-line policy summary for tooltips, e.g. 'retry ×3 · 4 attempts · 200 ms backoff'. */
export function policySummary(stop: { label: string; type: string; config?: Record<string, string> | undefined }): string {
  const config = stop.config ?? {};
  const parts = [stop.label];
  if (config.maxAttempts) parts.push(`${config.maxAttempts} attempts`);
  if (config.backoffMs) parts.push(`${config.backoffMs} ms backoff`);
  if (config.timeoutMs && stop.type !== 'timeout') parts.push(`${config.timeoutMs} ms timeout`);
  if (config.limit && !stop.label.includes(config.limit)) parts.push(`limit ${config.limit}`);
  return parts.join(' · ');
}
