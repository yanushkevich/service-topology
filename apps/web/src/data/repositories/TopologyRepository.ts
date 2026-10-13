import type {
  BusinessFlow,
  CommunicationRelationship,
  EntityId,
  EntityKind,
  EnvironmentRecord,
  EventType,
  InfrastructureResource,
  ServiceDefinition,
  ServiceInstance,
  TopologyData,
} from '../../domain/types';

/**
 * Data access boundary. Features depend on this interface, never on mock arrays directly, so a
 * future HTTP adapter (docs/API_CONTRACT.md) can replace the mock without touching UI code.
 */
export interface TopologyRepository {
  /** Human-readable data source label shown in the UI (e.g. to mark mock data). */
  readonly sourceLabel: string;
  /** True when entities and telemetry are generated rather than observed. */
  readonly isMock: boolean;
  getTopology(signal?: AbortSignal): Promise<TopologyData>;
  /**
   * Present when the source can be edited (the backend API, ADR-020). Built-in mock data has none,
   * so the UI offers editing only against the backend.
   */
  readonly writer?: TopologyWriter;
}

/** Entity kinds that can be created, updated, and deleted (ADR-020): the selection kinds plus event types and business flows (ADR-022). */
export type WritableKind = EntityKind | 'event-type' | 'business-flow';

export const WRITABLE_KINDS: readonly WritableKind[] = [
  'environment',
  'service-definition',
  'service-instance',
  'resource',
  'relationship',
  'event-type',
  'business-flow',
];

export interface EntityOfKind {
  environment: EnvironmentRecord;
  'service-definition': ServiceDefinition;
  'service-instance': ServiceInstance;
  resource: InfrastructureResource;
  relationship: CommunicationRelationship;
  'event-type': EventType;
  'business-flow': BusinessFlow;
}

/**
 * Writes one canonical entity at a time (POST/PUT/DELETE /entities/{kind}, ADR-020). The server
 * validates the whole resulting topology; failures reject with ApiError (422 issues, 409 duplicate
 * ID, 412 the topology changed since it was loaded). Callers reload the topology afterwards.
 */
export interface TopologyWriter {
  create<K extends WritableKind>(kind: K, entity: EntityOfKind[K]): Promise<EntityOfKind[K]>;
  update<K extends WritableKind>(kind: K, entity: EntityOfKind[K]): Promise<EntityOfKind[K]>;
  remove(kind: WritableKind, id: EntityId): Promise<void>;
}
