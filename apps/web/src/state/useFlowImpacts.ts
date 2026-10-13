import { useMemo } from 'react';
import { flowImpacts, type FlowImpact } from '../domain/flowImpact';
import type { TopologyIndex } from '../domain/topologyIndex';
import type { EntityId } from '../domain/types';
import type { ActiveFailure } from '../simulation/engine';
import { useSimulationStore } from './simulationStore';

export interface SimulatedFlowImpacts {
  /** Flows with an affected step in the environment (ADR-025). Always simulated. */
  flows: FlowImpact[];
  /** The simulated failures they come from (names and modes for the text). */
  failures: readonly ActiveFailure[];
}

const NONE: SimulatedFlowImpacts = { flows: [], failures: [] };

/**
 * The running simulation's failures mapped onto business flows in one environment. Pass a null
 * index while viewing history: the simulation is about the current data, not a snapshot.
 */
export function useFlowImpacts(index: TopologyIndex | null, environmentId: EntityId): SimulatedFlowImpacts {
  const failures = useSimulationStore((s) => s.sim?.failures);
  const impacts = useSimulationStore((s) => s.sim?.impacts);
  return useMemo(() => {
    if (!index || !failures?.length || !impacts) return NONE;
    return { flows: flowImpacts(index, failures, impacts).filter((f) => f.environmentId === environmentId), failures };
  }, [index, failures, impacts, environmentId]);
}
