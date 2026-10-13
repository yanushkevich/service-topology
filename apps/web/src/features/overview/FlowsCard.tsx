import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import { businessFlowsIn } from '../../domain/businessFlow';
import type { TopologyIndex } from '../../domain/topologyIndex';
import { indexFlows } from '../../transit/flows/flowIndex';
import { flowFindings } from '../../transit/flows/flowModel';
import { buttonClass, cx } from '../../shared/ui/classes';
import { FlowBadge } from '../business-flows/FlowBadge';
import { Card, Note } from '../pages/PageShell';

/**
 * The environment's business flows on the Overview (Milestone 11.6), with their review warnings
 * (findings from the declared flow, as in the catalog), most warnings first.
 */
export function FlowsCard({ index, environmentId, environmentName }: { index: TopologyIndex; environmentId: string; environmentName: string }) {
  const { search } = useLocation();
  const rows = useMemo(() => {
    const serviceName = (id: string) => index.definitions.get(id)?.name ?? id;
    const eventName = (id: string) => index.eventTypes.get(id)?.name ?? id;
    return businessFlowsIn(index, environmentId)
      .map(({ flow }) => ({ flow, warnings: flowFindings(flow, { serviceName, eventName }).filter((f) => f.severity === 'warn').length }))
      .sort((a, b) => b.warnings - a.warnings || a.flow.name.localeCompare(b.flow.name));
  }, [index, environmentId]);
  const fx = useMemo(() => indexFlows(rows.map((r) => r.flow), (id) => index.definitions.get(id)?.name ?? id), [rows, index]);

  return (
    <Card title="Business flows" aside={<span className="font-mono text-sm text-fg-3">{rows.length}</span>}>
      {rows.length === 0 ? (
        <Note>No business flows have a step in {environmentName}.</Note>
      ) : (
        <ul className="m-0 list-none p-0" aria-label="Business flows in this environment">
          {rows.map(({ flow, warnings }) => (
            <li key={flow.id} className="flex flex-wrap items-center gap-2.5 border-t border-line py-2 first:border-t-0">
              <FlowBadge fx={fx} flowId={flow.id} />
              <Link to={{ pathname: `/flows/${encodeURIComponent(flow.id)}`, search }} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                {flow.name}
              </Link>
              <span className="font-mono text-xs text-fg-3">{flow.steps.length} steps</span>
              <span className={cx('text-sm', warnings ? 'text-warn-fg' : 'text-fg-3')}>
                {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to={{ pathname: '/flows', search }} className={cx(buttonClass('secondary'), 'mt-2.5 inline-flex')}>
        Open business flows
      </Link>
    </Card>
  );
}
