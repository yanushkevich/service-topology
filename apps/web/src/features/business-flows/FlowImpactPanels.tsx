import { Link, useLocation } from 'react-router';
import type { FlowImpact } from '../../domain/flowImpact';
import type { FailureRoot } from '../../domain/propagation';
import type { TopologyIndex } from '../../domain/topologyIndex';
import type { BusinessFlow } from '../../domain/types';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { describeAffectedStep, describeFlowImpact, flowImpactNames } from './flowImpactText';
import { stripPageParams } from './flowVisuals';

/**
 * Simulated flow impact (ADR-025, docs/BUSINESS_FLOWS.md §12) on the flow board, the simulation
 * page, the inspector, and the catalog. Every surface carries the Simulated tag or sits in a
 * simulated section.
 */

/** The flow board's banner: where the flow stops and how it likely ends, with each affected step's cause chain. */
export function FlowImpactBanner({ index, flow, impact, failures }: { index: TopologyIndex; flow: BusinessFlow; impact: FlowImpact; failures: readonly FailureRoot[] }) {
  const { search } = useLocation();
  const names = flowImpactNames(index);
  const text = describeFlowImpact(impact, flow, failures, names);
  const count = impact.steps.length;
  return (
    <section aria-label="Simulated impact on this flow" data-flow-impact-banner className="flex flex-col gap-1 rounded-lg border border-dashed border-warn px-3 py-2 text-sm">
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
        <SimulatedTag simulated />
        <span className="text-fg">{text.sentence}</span>
        <Link to={{ pathname: '/simulation', search: stripPageParams(search) }} className="text-fg-2 underline">
          Open Simulation
        </Link>
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-fg-2">
          {count} affected step{count === 1 ? '' : 's'}, marked on the map
        </summary>
        <ul className="m-0 mt-1 list-none p-0 font-mono text-[11px] text-fg-2">
          {impact.steps.map((step) => (
            <li key={step.stepId}>{describeAffectedStep(step, flow, names.entity)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Flows a simulated failure reaches, each linking to its board (simulation page and inspector). */
export function AffectedFlowsList({ index, impacts, failures, label }: { index: TopologyIndex; impacts: readonly FlowImpact[]; failures: readonly FailureRoot[]; label: string }) {
  const { search } = useLocation();
  const names = flowImpactNames(index);
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
      {impacts.map((impact) => {
        const flow = index.businessFlows.get(impact.flowId);
        if (!flow) return null;
        const text = describeFlowImpact(impact, flow, failures, names);
        return (
          <li key={impact.flowId} data-flow-impact={impact.flowId} className="text-fg-2">
            <Link to={{ pathname: `/flows/${encodeURIComponent(flow.id)}`, search: stripPageParams(search) }} className="font-semibold text-fg underline">
              {flow.name}
            </Link>{' '}
            {text.stop}
            {text.likely ? `, ${text.likely}` : ''}. <span className="text-fg-3">Cause: {text.cause}.</span>
          </li>
        );
      })}
    </ul>
  );
}
