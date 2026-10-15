import type { EntityGroup } from '../domain/registry';
import type {
  CommunicationPattern,
  HealthStatus,
  Protocol,
  Provider,
  RelationshipStatus,
  ResourceType,
  ServiceCategory,
} from '../domain/types';

/**
 * Central presentation mappings (ARCHITECTURE §8). Every lookup has a fallback so unknown values
 * from future adapters still render with a readable label.
 */

const PROVIDER_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  'on-prem': 'On-prem',
  saas: 'SaaS',
  internal: 'Internal',
  unknown: 'Unknown',
};

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

const TYPE_LABELS: Record<ServiceCategory | ResourceType, string> = {
  api: 'API service',
  gateway: 'Gateway',
  application: 'Application',
  worker: 'Worker',
  'scheduled-job': 'Scheduled job',
  account: 'Account',
  subscription: 'Subscription',
  project: 'Project',
  region: 'Region',
  datacenter: 'Datacenter',
  host: 'Host',
  cluster: 'Cluster',
  namespace: 'Namespace',
  workload: 'Workload',
  database: 'Database',
  cache: 'Cache',
  'search-index': 'Search index',
  broker: 'Message broker',
  topic: 'Kafka topic',
  queue: 'Queue',
  exchange: 'Exchange',
  'external-resource': 'External API',
  other: 'Other',
};

export const GROUP_LABELS: Record<EntityGroup, string> = {
  service: 'Services',
  data: 'Data stores',
  messaging: 'Messaging',
  external: 'External',
  other: 'Other',
};

const PROTOCOL_LABELS: Partial<Record<Protocol, string>> = {
  http: 'HTTP',
  https: 'HTTPS',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  websocket: 'WebSocket',
  kafka: 'Kafka',
  rabbitmq: 'RabbitMQ',
  tcp: 'TCP',
  tls: 'TLS',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
};

const PATTERN_LABELS: Record<CommunicationPattern, string> = {
  synchronous: 'Synchronous',
  asynchronous: 'Asynchronous',
  streaming: 'Streaming',
  scheduled: 'Scheduled',
  database: 'Database access',
  unknown: 'Unknown',
};

const RELATIONSHIP_STATUS_HEALTH: Record<RelationshipStatus, HealthStatus> = {
  active: 'healthy',
  degraded: 'degraded',
  inactive: 'unavailable',
  unknown: 'unknown',
};

const RELATIONSHIP_STATUS_LABELS: Record<RelationshipStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  inactive: 'Inactive',
  unknown: 'Unknown',
};

function fallback(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, ' ') : 'Unknown';
}

export const providerLabel = (p: string) => PROVIDER_LABELS[p as Provider] ?? fallback(p);
export const healthLabel = (h: string) => HEALTH_LABELS[h as HealthStatus] ?? fallback(h);
export const typeLabel = (t: string) => TYPE_LABELS[t as ResourceType] ?? fallback(t);
export const protocolLabel = (p: string) => PROTOCOL_LABELS[p as Protocol] ?? p.toUpperCase();
export const patternLabel = (p: string) => PATTERN_LABELS[p as CommunicationPattern] ?? fallback(p);
export const relationshipStatusLabel = (s: string) =>
  RELATIONSHIP_STATUS_LABELS[s as RelationshipStatus] ?? fallback(s);
export const relationshipStatusHealth = (s: string): HealthStatus =>
  RELATIONSHIP_STATUS_HEALTH[s as RelationshipStatus] ?? 'unknown';

/** Visual edge families from the UI mock legend. Each also has a distinct dash pattern (not color alone). */
export const EDGE_KINDS = ['http', 'grpc', 'data', 'event', 'other'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const EDGE_KIND_LABELS: Record<EdgeKind, string> = {
  http: 'HTTP / HTTPS',
  grpc: 'gRPC',
  data: 'Data store (SQL, cache)',
  event: 'Events (publish, consume)',
  other: 'Other',
};

export function edgeKind(protocol: string, pattern: string): EdgeKind {
  if (protocol === 'kafka' || protocol === 'rabbitmq' || pattern === 'asynchronous' || pattern === 'streaming') {
    return 'event';
  }
  if (['postgresql', 'mysql', 'mongodb', 'redis'].includes(protocol) || pattern === 'database') return 'data';
  if (protocol === 'grpc') return 'grpc';
  if (['http', 'https', 'graphql', 'websocket'].includes(protocol)) return 'http';
  return 'other';
}
