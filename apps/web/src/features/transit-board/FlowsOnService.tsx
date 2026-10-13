import { Link, useLocation } from 'react-router';
import type { FlowBoardIndex } from '../../transit/flows/flowIndex';
import type { FlowOnService } from '../../transit/flows/flowModel';
import { indexRowClass } from '../../shared/ui/classes';
import { Chip, Kicker } from '../../shared/ui/primitives';
import { FlowBadge } from '../business-flows/FlowBadge';

/**
 * The business flows that run on this service (ADR-023, docs/BUSINESS_FLOWS.md Revision 2 §10), as
 * a group of the line index. Selecting one highlights the lines its steps enter; steps that name no
 * line of this board are listed as such.
 */
export function FlowRows({ fx, flows, selectedFlowId, onSelect }: { fx: FlowBoardIndex; flows: readonly FlowOnService[]; selectedFlowId: string | null; onSelect: (flowId: string | null) => void }) {
  if (flows.length === 0) return null;
  return (
    <section aria-label={`Business flows, ${flows.length}`}>
      <Kicker mono className="px-2 pt-1.5 pb-1" aria-hidden="true">
        Business flows · {flows.length}
      </Kicker>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {flows.map(({ flow, steps }) => {
          const selected = flow.id === selectedFlowId;
          const unmapped = steps.filter((s) => s.lineId === null);
          return (
            <li key={flow.id}>
              <button type="button" data-row data-flow-row={flow.id} className={indexRowClass} aria-current={selected} aria-pressed={selected} onClick={() => onSelect(selected ? null : flow.id)}>
                <FlowBadge fx={fx} flowId={flow.id} />
                <span className="min-w-0 flex-1 truncate">{flow.name}</span>
                <span className="text-[10.5px] whitespace-nowrap text-fg-3 tabular-nums">
                  {steps.length} step{steps.length === 1 ? '' : 's'} here
                </span>
              </button>
              {selected && unmapped.length > 0 && (
                <p className="m-0 px-2 pt-1 text-xs text-fg-3" data-unmapped>
                  Not mapped to a line: {unmapped.map((s) => s.step.name).join(', ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The flow steps that enter a line, each linking to its step on the flow board. */
export function UsedByFlows({ fx, uses }: { fx: FlowBoardIndex; uses: readonly { flowId: string; flowName: string; stepId: string; stepName: string }[] }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  for (const name of ['line', 'mode', 'trace', 't', 'flow']) params.delete(name);
  if (uses.length === 0) return <p className="m-0 text-sm text-fg-3">No business flow names this line as a step.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {uses.map((u) => {
        const to = new URLSearchParams(params);
        to.set('step', u.stepId);
        return (
          <li key={`${u.flowId}:${u.stepId}`} className="flex items-center gap-2 text-sm">
            <FlowBadge fx={fx} flowId={u.flowId} />
            <Link to={{ pathname: `/flows/${encodeURIComponent(u.flowId)}`, search: `?${to.toString()}` }} className="text-accent-fg underline">
              {u.flowName}: {u.stepName}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Used by" under the service board's header (ADR-027 §16): one chip per business flow with a step
 * here. A chip toggles the flow, like its row in the index.
 */
export function UsedByChips({ fx, flows, selectedFlowId, onSelect }: { fx: FlowBoardIndex; flows: readonly FlowOnService[]; selectedFlowId: string | null; onSelect: (flowId: string | null) => void }) {
  if (flows.length === 0) return null;
  return (
    <div role="group" aria-label="Used by business flows" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-fg-3">Used by</span>
      {flows.map(({ flow, steps }) => {
        const pressed = flow.id === selectedFlowId;
        return (
          <Chip key={flow.id} pressed={pressed} onClick={() => onSelect(pressed ? null : flow.id)} data-flow-chip={flow.id}>
            <FlowBadge fx={fx} flowId={flow.id} />
            {flow.name}
            <span className="text-xs text-fg-3">
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </span>
          </Chip>
        );
      })}
    </div>
  );
}

/** On a service without board data: the flows that still run here, with links to their steps. */
export function FlowsWithoutBoard({ fx, flows }: { fx: FlowBoardIndex; flows: readonly FlowOnService[] }) {
  const { search } = useLocation();
  if (flows.length === 0) return null;
  const params = new URLSearchParams(search);
  for (const name of ['line', 'mode', 'trace', 't', 'flow']) params.delete(name);
  return (
    <section aria-label="Business flows on this service" className="mt-4 text-left">
      <Kicker className="mb-2">Business flows on this service</Kicker>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {flows.flatMap(({ flow, steps }) =>
          steps.map(({ step }) => {
            const to = new URLSearchParams(params);
            to.set('step', step.id);
            return (
              <li key={`${flow.id}:${step.id}`} className="flex items-center gap-2">
                <FlowBadge fx={fx} flowId={flow.id} />
                <Link to={{ pathname: `/flows/${encodeURIComponent(flow.id)}`, search: `?${to.toString()}` }} className="text-accent-fg underline">
                  {flow.name}: {step.name}
                </Link>
              </li>
            );
          }),
        )}
      </ul>
    </section>
  );
}
