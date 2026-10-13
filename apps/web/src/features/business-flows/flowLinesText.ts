import { patternLabel } from '../../domain/patterns';
import type { StepLineRow, StepLineStatus } from '../../transit/flows/flowLines';
import type { PolicyStop } from '../../transit/types';
import { stripPageParams } from './flowVisuals';

/** Wording and links for the step-to-line overview (Milestone 13.2). */

/** Why a step has no line, as a short label (the table) and what would fix it (the step card). */
export const STEP_LINE_STATUS: Record<Exclude<StepLineStatus, 'mapped'>, { label: string; fix: string }> = {
  'no-board': { label: 'no board', fix: 'This service has no transit board yet. Author one on its service board, or wait for observed data.' },
  'no-line': { label: 'no matching line', fix: 'No line on the service board matches the step’s entry point. Align the entry point with a line’s name or signature.' },
  'no-entry-point': { label: 'no entry point', fix: 'The step names no entry point, so it cannot be matched to a line. Add one in the flow editor.' },
};

/** The service board, opened at the step's line (or entry point) with the flow highlighted. */
export function serviceBoardLink(row: Pick<StepLineRow, 'serviceDefinitionId' | 'entryPoint' | 'line'>, flowId: string, search: string): { pathname: string; search: string } {
  const params = new URLSearchParams(stripPageParams(search));
  const line = row.line?.id ?? row.entryPoint;
  if (line) params.set('line', line);
  params.set('flow', flowId);
  return { pathname: `/services/${encodeURIComponent(row.serviceDefinitionId)}/transit`, search: `?${params.toString()}` };
}

/** A policy stop in words, without repeating its kind: "retry ×3", but "Timeout: 2 s". */
export function policyText(stop: Pick<PolicyStop, 'type' | 'label'>): string {
  return stop.label.toLowerCase().includes(stop.type) ? stop.label : `${patternLabel(stop.type)}: ${stop.label}`;
}

