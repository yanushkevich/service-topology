import type { TopologyIndex } from '../../domain/topologyIndex';
import { SimulatedTag } from '../../shared/ui/DataSourceTag';
import { useFlowImpacts } from '../../state/useFlowImpacts';
import { useUiStore } from '../../state/uiStore';
import { AffectedFlowsList } from '../business-flows/FlowImpactPanels';

/** Business flows the simulated failures reach in the environment (ADR-025), on the simulation page. */
export function AffectedFlowsPanel({ index }: { index: TopologyIndex }) {
  const environmentId = useUiStore((s) => s.environmentId);
  const { flows, failures } = useFlowImpacts(index, environmentId);
  const environmentName = index.environments.get(environmentId)?.name ?? environmentId;
  let body;
  if (failures.length === 0) body = <p className="m-0 text-sm text-fg-2">No simulated failures. Inject one to see which business flows it reaches, where they stop, and how they likely end.</p>;
  else if (flows.length === 0) body = <p className="m-0 text-sm text-fg-2">No business flow in {environmentName} is affected by the simulated failures.</p>;
  else body = <AffectedFlowsList index={index} impacts={flows} failures={failures} label="Business flows affected" />;
  return (
    <section className="rounded-xl border border-line bg-surface-1 px-4 py-3.5" aria-labelledby="affected-flows-heading">
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 id="affected-flows-heading" className="m-0 text-lg font-semibold">
          Business flows affected
        </h2>
        <span className="font-mono">{flows.length}</span>
        <SimulatedTag simulated />
      </div>
      {body}
    </section>
  );
}
