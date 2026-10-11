import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { typeLabel } from '../../../../shared/mappings';
import { StatusShape } from '../../../../shared/ui/StatusShape';
import { TypeGlyph } from '../../../../shared/ui/TypeGlyph';
import type { EntityFlowNode } from '../../adapters/reactFlowAdapter';
import { useMapActions } from './mapActions';

/** Service/resource node (mock .n2), or a collapsed infrastructure group. */
export const EntityNode = memo(function EntityNode({ data }: NodeProps<EntityFlowNode>) {
  const { node, emphasis } = data;
  const { toggleGroup } = useMapActions();
  const collapsed = node.kind === 'collapsed-group';

  return (
    <div className="flow-node" data-emphasis={emphasis} data-health={node.health} data-collapsed={collapsed}>
      <Handle type="target" position={Position.Left} className="flow-handle" isConnectable={false} />
      <TypeGlyph type={node.type} size={collapsed ? 16 : 18} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-[12.5px] font-semibold">{node.name}</span>
        <span className="truncate font-mono text-[10px] text-fg-3">{collapsed ? node.subtitle : typeLabel(node.type)}</span>
      </span>
      {node.health !== 'healthy' || collapsed ? <StatusShape health={node.health} /> : null}
      {collapsed && (
        <button
          type="button"
          className="nodrag grid size-5 flex-none place-items-center rounded-sm border border-line-strong text-[13px] leading-none text-fg-2 hover:bg-surface-3 hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            toggleGroup(node.id);
          }}
          aria-label={`Expand ${node.name}`}
          title="Expand group"
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Right} className="flow-handle" isConnectable={false} />
    </div>
  );
});
