import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { typeLabel } from '../../../../shared/mappings';
import { StatusShape } from '../../../../shared/ui/StatusShape';
import { TypeGlyph } from '../../../../shared/ui/TypeGlyph';
import type { EntityFlowNode } from '../../adapters/reactFlowAdapter';
import { useMapActions } from './mapActions';
import styles from './flow.module.css';

/** Service/resource node (mock .n2), or a collapsed infrastructure group. */
export const EntityNode = memo(function EntityNode({ data }: NodeProps<EntityFlowNode>) {
  const { node, emphasis } = data;
  const { toggleGroup } = useMapActions();
  const collapsed = node.kind === 'collapsed-group';

  return (
    <div
      className={[
        styles.node,
        collapsed ? styles.collapsed : '',
        node.health === 'unavailable' ? styles.critical : '',
        styles[emphasis] ?? '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <TypeGlyph type={node.type} size={collapsed ? 16 : 18} />
      <span className={styles.text}>
        <span className={styles.name}>{node.name}</span>
        <span className={`mono ${styles.meta}`}>{collapsed ? node.subtitle : typeLabel(node.type)}</span>
      </span>
      {node.health !== 'healthy' || collapsed ? <StatusShape health={node.health} /> : null}
      {collapsed && (
        <button
          type="button"
          className={`nodrag ${styles.expand}`}
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
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
});
