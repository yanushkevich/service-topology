import type { BusinessFlow, FlowStepKind } from '../../domain/types';
import { lineStops, type BoardIndex, type LineStop } from '../board';
import type { LineGroup } from '../types';
import { lineForStep } from './flowModel';

/**
 * Which line each step of a flow uses (Milestone 13.2): the 2D overview of how a business process
 * lands on its services' code paths, and the step card's drill-down. Pure; the boards come from the
 * transit repository. A step maps to a line by its entry point (`lineForStep`: name or signature).
 */

/** Why a step has a line, or why it has none. */
export type StepLineStatus = 'mapped' | 'no-board' | 'no-line' | 'no-entry-point';

export interface StepLineRow {
  stepId: string;
  stepName: string;
  kind: FlowStepKind;
  serviceDefinitionId: string;
  serviceName: string;
  entryPoint: string | null;
  /** On the flow's typical path (listed first). */
  typical: boolean;
  status: StepLineStatus;
  /** The line it enters; present when mapped. */
  line: {
    id: string;
    code: string;
    name: string;
    signature: string;
    group: LineGroup;
    p95Ms: number;
    errorRate: number;
    /** The main route's stops in order (stations, and the policies on each client). */
    stops: LineStop[];
    /** Where the line goes: its dependency stations, in route order (all branches). */
    dependencies: { id: string; name: string }[];
    policies: { total: number; missing: number };
  } | null;
}

/** One row per step: the typical path first (in its order), then the other steps in declaration order. */
export function flowLineRows(flow: BusinessFlow, boards: ReadonlyMap<string, BoardIndex | null>, serviceName: (id: string) => string, typicalSteps: readonly string[]): StepLineRow[] {
  const typical = new Set(typicalSteps);
  const order = [...typicalSteps.filter((id) => flow.steps.some((s) => s.id === id)), ...flow.steps.filter((s) => !typical.has(s.id)).map((s) => s.id)];
  return order.flatMap((id): StepLineRow[] => {
    const step = flow.steps.find((s) => s.id === id);
    if (!step) return [];
    const index = boards.get(step.serviceDefinitionId) ?? null;
    const base = { stepId: step.id, stepName: step.name, kind: step.kind, serviceDefinitionId: step.serviceDefinitionId, serviceName: serviceName(step.serviceDefinitionId), entryPoint: step.entryPoint ?? null, typical: typical.has(step.id) };
    if (!index) return [{ ...base, status: 'no-board', line: null }];
    if (!step.entryPoint) return [{ ...base, status: 'no-entry-point', line: null }];
    const line = lineForStep(index.lines, step);
    if (!line) return [{ ...base, status: 'no-line', line: null }];
    const stationIds = [...new Set(line.route.flatMap((b) => b.stations))];
    const policies = stationIds.flatMap((sid) => index.policiesByClient.get(sid) ?? []);
    return [
      {
        ...base,
        status: 'mapped',
        line: {
          id: line.id,
          code: line.code,
          name: line.name,
          signature: line.signature,
          group: line.group,
          p95Ms: line.stats.p95Ms,
          errorRate: line.stats.errorRate,
          stops: lineStops(index, line, 0),
          dependencies: stationIds.flatMap((sid) => {
            const station = index.stations.get(sid);
            return station?.kind === 'dependency' ? [{ id: station.id, name: station.name }] : [];
          }),
          policies: { total: policies.length, missing: policies.filter((p) => p.state === 'missing').length },
        },
      },
    ];
  });
}

/** The overview's summary: how much of the flow lands on known lines, and on which boards. */
export function flowLinesSummary(rows: readonly StepLineRow[]): { steps: number; mapped: number; boards: number; services: number; noBoard: number; unmatched: number } {
  const mapped = rows.filter((r) => r.status === 'mapped');
  return {
    steps: rows.length,
    mapped: mapped.length,
    boards: new Set(mapped.map((r) => r.serviceDefinitionId)).size,
    services: new Set(rows.map((r) => r.serviceDefinitionId)).size,
    noBoard: rows.filter((r) => r.status === 'no-board').length,
    unmatched: rows.filter((r) => r.status === 'no-line' || r.status === 'no-entry-point').length,
  };
}
