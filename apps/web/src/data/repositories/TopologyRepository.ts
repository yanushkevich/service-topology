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

import type { BundleImporter } from '../bundle/bundle';
import type { SandboxControls } from '../sandbox/sandbox';
import type { SourceIntegration } from '../integrations/sourceIntegration';

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
  /** Present when all data can be replaced with a data bundle (ADR-032): the sandbox and the backend. */
  readonly importer?: BundleImporter;
  /** Present for the local sandbox (ADR-031): its storage state and reset. */
  readonly sandbox?: SandboxControls;
  /** Present on the backend API: the Dynatrace connector (ADR-034); its status says whether it is configured. */
  readonly integration?: SourceIntegration;
  /**
   * How often to refetch so observed health and metrics stay current (ADR-034); null when nothing
   * is observed. Known after the first getTopology.
   */
  readonly refreshMs?: number | null;
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
