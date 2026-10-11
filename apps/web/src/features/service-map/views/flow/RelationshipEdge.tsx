import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { protocolLabel, relationshipStatusHealth } from '../../../../shared/mappings';
import { StatusShape } from '../../../../shared/ui/StatusShape';
import type { RelationshipFlowEdge } from '../../adapters/reactFlowAdapter';

/** Communication relationship. Kind → color + dash pattern; problems get a status shape at the midpoint. */
export const RelationshipEdge = memo(function RelationshipEdge(props: EdgeProps<RelationshipFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!data) return null;
  const { edge, emphasis } = data;
  const problem = edge.status !== 'active';
  const showLabel = emphasis === 'selected' || emphasis === 'highlighted' || problem;
  const merged = edge.relationshipIds.length > 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        interactionWidth={14}
        className={`flow-edge kind-${edge.kind} emphasis-${emphasis}`}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="flow-edge-label pointer-events-none absolute inline-flex items-center gap-[5px] rounded-sm border border-line bg-float px-1.5 py-0.5 text-[10px] text-fg-2"
            data-emphasis={emphasis}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {problem && <StatusShape health={relationshipStatusHealth(edge.status)} />}
            {(emphasis === 'selected' || emphasis === 'highlighted') && (
              <span className="font-mono">
                {protocolLabel(edge.protocol)}
                {merged ? ` ×${edge.relationshipIds.length}` : ''}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
