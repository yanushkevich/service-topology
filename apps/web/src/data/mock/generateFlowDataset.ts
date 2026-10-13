import type { BusinessFlow, CommunicationRelationship, FlowStep, FlowTransition, ServiceDefinition, ServiceInstance, TopologyData } from '../../domain/types';
import { generateBoard } from '../../transit/mock/generateBoard';
import type { TransitBoard } from '../../transit/types';

/**
 * A generated dataset for the 3D drill-down benchmark (ADR-026: 12 steps × 6 service boards):
 * a chain of services, one flow that visits each twice, and a generated transit board per service
 * whose lines the steps enter. Deterministic; mock data, labelled as a generated dataset.
 */
export const FLOW_DATASET = 'flow-12x6';

const T0 = '2026-10-11T08:00:00Z';

export function generateFlowDataset({ services: serviceCount = 6, steps: stepCount = 12, lines = 12, stations = 24 } = {}): { topology: TopologyData; boards: Record<string, TransitBoard> } {
  const ids = Array.from({ length: serviceCount }, (_, i) => `svc-${i}`);
  const serviceDefinitions: ServiceDefinition[] = ids.map((id, i) => ({ id, name: `Service ${i}`, category: 'api', protocols: ['https'], owner: 'Generated', team: 'Generated' }));
  const serviceInstances: ServiceInstance[] = ids.map((id) => ({ id: `${id}.production`, serviceDefinitionId: id, environmentId: 'production', provider: 'aws', health: 'healthy', updatedAt: T0 }));
  // A chain: each service calls the next, which backs the flow's calls between them.
  const relationships: CommunicationRelationship[] = ids.slice(1).map((id, i) => ({
    id: `rel:svc-${i}.production->${id}.production`,
    sourceEntityId: `svc-${i}.production`,
    targetEntityId: `${id}.production`,
    protocol: 'https',
    pattern: 'synchronous',
    direction: 'unidirectional',
    status: 'active',
    updatedAt: T0,
  }));
  const boards = Object.fromEntries(ids.map((id) => [id, { ...generateBoard({ lines, stations }), serviceDefinitionId: id }]));
  const serviceOf = (k: number) => ids[Math.min(ids.length - 1, Math.floor((k * ids.length) / stepCount))] ?? 'svc-0';
  const steps: FlowStep[] = Array.from({ length: stepCount }, (_, k) => ({ id: `step-${k}`, name: `Step ${k}`, serviceDefinitionId: serviceOf(k), kind: 'task', entryPoint: `endpoint ${k % lines}` }));
  const transitions: FlowTransition[] = steps.map((step, k) => {
    const next = steps[k + 1];
    if (!next) return { id: `t-${k}`, from: step.id, to: 'done', via: { kind: 'local' }, policies: [] };
    return { id: `t-${k}`, from: step.id, to: next.id, via: next.serviceDefinitionId === step.serviceDefinitionId ? { kind: 'local' } : { kind: 'call' }, policies: [] };
  });
  const flow: BusinessFlow = {
    id: 'flow-generated',
    name: 'Generated flow',
    description: `${stepCount} steps across ${serviceCount} services (benchmark).`,
    trigger: { kind: 'call' },
    startStepId: 'step-0',
    steps,
    transitions,
    outcomes: [{ id: 'done', name: 'Done', kind: 'success' }],
    source: { kind: 'authored' },
  };
  return {
    topology: { environments: [{ id: 'production', name: 'Production', kind: 'production' }], serviceDefinitions, serviceInstances, resources: [], relationships, eventTypes: [], businessFlows: [flow] },
    boards,
  };
}
