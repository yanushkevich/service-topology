import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { typeLabel } from '../../../../shared/mappings';
import type { GroupFlowNode } from '../../adapters/reactFlowAdapter';
import { useMapActions } from './mapActions';

/** Infrastructure container (mock .gb/.gh). Header selects the containment resource; ⌄ collapses it. */
export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group } = data;
  const { toggleGroup, selectGroup } = useMapActions();
  return (
    <div className="flow-group" data-provider={group.type === 'provider'} data-selected={Boolean(selected)}>
      {/* Brokers can be both a group and a relationship endpoint. */}
      <Handle type="target" position={Position.Left} className="flow-handle" isConnectable={false} />
      <div className="flow-group-header absolute top-[7px] right-2 left-2 flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          className="nodrag grid size-5 flex-none place-items-center rounded-sm border border-line-strong text-[13px] leading-none text-fg-2 hover:bg-surface-3 hover:text-fg"
          onClick={() => toggleGroup(group.id)}
          aria-label={`Collapse ${group.label}`}
          title="Collapse group"
        >
          −
        </button>
        <button
          type="button"
          className="nodrag flex min-w-0 items-center gap-[7px] overflow-hidden rounded-sm px-1.5 py-0.5 text-xs whitespace-nowrap text-fg-3 enabled:hover:bg-surface-3 disabled:cursor-default [&_b]:truncate [&_b]:font-semibold [&_b]:text-fg-2"
          onClick={() => selectGroup(group)}
          disabled={!group.ref}
        >
          <b>{group.label}</b>
          <span>{group.type === 'provider' ? 'Provider' : typeLabel(group.type)}</span>
        </button>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" isConnectable={false} />
    </div>
  );
});
