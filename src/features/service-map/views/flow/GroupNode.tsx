import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { typeLabel } from '../../../../shared/mappings';
import type { GroupFlowNode } from '../../adapters/reactFlowAdapter';
import { useMapActions } from './mapActions';
import styles from './flow.module.css';

/** Infrastructure container (mock .gb/.gh). Header selects the containment resource; ⌄ collapses it. */
export const GroupNode = memo(function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { group } = data;
  const { toggleGroup, selectGroup } = useMapActions();
  return (
    <div className={`${styles.group} ${group.type === 'provider' ? styles.providerGroup : ''} ${selected ? styles.groupSelected : ''}`}>
      {/* Brokers can be both a group and a relationship endpoint. */}
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.groupHeader}>
        <button
          type="button"
          className={`nodrag ${styles.groupToggle}`}
          onClick={() => toggleGroup(group.id)}
          aria-label={`Collapse ${group.label}`}
          title="Collapse group"
        >
          −
        </button>
        <button
          type="button"
          className={`nodrag ${styles.groupLabel}`}
          onClick={() => selectGroup(group)}
          disabled={!group.ref}
        >
          <b>{group.label}</b>
          <span>{group.type === 'provider' ? 'Provider' : typeLabel(group.type)}</span>
        </button>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
});
