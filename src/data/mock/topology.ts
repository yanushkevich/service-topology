import type {
  EventType,
  CommunicationPattern,
  CommunicationRelationship,
  EnvironmentRecord,
  InfrastructureResource,
  Metrics,
  Protocol,
  RelationshipStatus,
  ServiceDefinition,
  ServiceInstance,
  TopologyData,
} from '../../domain/types';

/**
 * Deterministic mock inventory. Everything here is fictional; all telemetry is simulated
 * (`isSimulated: true`). Structure:
 *   AWS     — commerce (EKS) + orders/inventory databases + session cache
 *   Azure   — payments and risk (AKS) + payments database
 *   GCP     — Kafka event streaming (topics) + catalog search
 *   On-prem — Frankfurt DC: batch/notification workloads, RabbitMQ, ledger database
 *   SaaS    — card processor and email delivery APIs
 */

const T0 = '2026-10-11T08:00:00Z';
const T1 = '2026-10-11T08:45:00Z';

function sim(latencyMs: number, throughputPerSecond: number, errorRatePercent: number): Metrics {
  return { latencyMs, throughputPerSecond, errorRatePercent, isSimulated: true, observedAt: T1 };
}

// ---------------------------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------------------------

const environments: EnvironmentRecord[] = [
  { id: 'production', name: 'Production', kind: 'production' },
  { id: 'staging', name: 'Staging', kind: 'staging' },
  { id: 'development', name: 'Development', kind: 'development' },
];

// ---------------------------------------------------------------------------------------------
// Logical service definitions (no environment)
// ---------------------------------------------------------------------------------------------

const serviceDefinitions: ServiceDefinition[] = [
  {
    id: 'api-gateway',
    name: 'API Gateway',
    description: 'Public ingress; routes and authenticates external traffic.',
    owner: 'Platform',
    team: 'Platform Edge',
    category: 'gateway',
    protocols: ['https', 'grpc'],
  },
  {
    id: 'web-bff',
    name: 'Web BFF',
    description: 'Backend-for-frontend aggregating storefront calls.',
    owner: 'Commerce',
    team: 'Storefront',
    category: 'api',
    protocols: ['http', 'grpc'],
  },
  {
    id: 'auth-service',
    name: 'Auth Service',
    description: 'Session and token issuance.',
    owner: 'Platform',
    team: 'Identity',
    category: 'api',
    protocols: ['grpc', 'redis'],
  },
  {
    id: 'cart-service',
    name: 'Cart Service',
    description: 'Shopping cart state.',
    owner: 'Commerce',
    team: 'Storefront',
    category: 'api',
    protocols: ['grpc', 'redis'],
  },
  {
    id: 'catalog-service',
    name: 'Catalog Service',
    description: 'Product catalog reads and search.',
    owner: 'Commerce',
    team: 'Catalog',
    category: 'api',
    protocols: ['http', 'grpc', 'kafka'],
  },
  {
    id: 'order-service',
    name: 'Order Service',
    description: 'Order placement and lifecycle; publishes order events.',
    owner: 'Commerce',
    team: 'Orders',
    category: 'api',
    protocols: ['https', 'grpc', 'postgresql', 'kafka'],
  },
  {
    id: 'inventory-service',
    name: 'Inventory Service',
    description: 'Stock levels and reservations.',
    owner: 'Commerce',
    team: 'Fulfilment',
    category: 'api',
    protocols: ['grpc', 'postgresql', 'kafka'],
  },
  {
    id: 'notification-service',
    name: 'Notification Service',
    description: 'Turns order events into customer notifications.',
    owner: 'Commerce',
    team: 'Engagement',
    category: 'worker',
    protocols: ['kafka', 'rabbitmq'],
  },
  {
    id: 'email-dispatcher',
    name: 'Email Dispatcher',
    description: 'Consumes the email queue and calls the email delivery provider.',
    owner: 'Commerce',
    team: 'Engagement',
    category: 'worker',
    protocols: ['rabbitmq', 'https'],
  },
  {
    id: 'legacy-report-cron',
    name: 'Legacy Report Cron',
    description: 'Nightly order export for finance. Owner unassigned.',
    category: 'scheduled-job',
    protocols: ['postgresql'],
  },
  {
    id: 'payment-service',
    name: 'Payment Service',
    description: 'Payment authorization and capture.',
    owner: 'Payments',
    team: 'Payments',
    category: 'api',
    protocols: ['grpc', 'https', 'postgresql', 'kafka'],
  },
  {
    id: 'fraud-scoring',
    name: 'Fraud Scoring',
    description: 'Real-time risk scoring for payment attempts.',
    owner: 'Payments',
    team: 'Risk',
    category: 'api',
    protocols: ['grpc'],
  },
  {
    id: 'ledger-service',
    name: 'Ledger Service',
    description: 'Double-entry ledger fed by payment events.',
    owner: 'Payments',
    team: 'Payments',
    category: 'worker',
    protocols: ['kafka', 'postgresql'],
  },
  {
    id: 'payout-worker',
    name: 'Payout Worker',
    description: 'Scheduled merchant payouts.',
    owner: 'Payments',
    team: 'Payments',
    category: 'scheduled-job',
    protocols: ['https', 'grpc'],
  },
];

// ---------------------------------------------------------------------------------------------
// Infrastructure resources: containment hierarchy + first-class backing/messaging resources
// ---------------------------------------------------------------------------------------------

const resources: InfrastructureResource[] = [
  // AWS ---------------------------------------------------------------------------------------
  { id: 'aws-acct-commerce-prod', name: 'commerce-prod', type: 'account', provider: 'aws', environmentId: 'production', metadata: { accountId: '000000000001' } },
  { id: 'aws-use1-prod', name: 'us-east-1', type: 'region', provider: 'aws', parentResourceId: 'aws-acct-commerce-prod' },
  { id: 'eks-commerce-prod', name: 'eks-commerce-prod', type: 'cluster', provider: 'aws', parentResourceId: 'aws-use1-prod', metadata: { kubernetesVersion: '1.33' } },
  { id: 'ns-edge-prod', name: 'edge', type: 'namespace', provider: 'aws', parentResourceId: 'eks-commerce-prod' },
  { id: 'ns-commerce-prod', name: 'commerce', type: 'namespace', provider: 'aws', parentResourceId: 'eks-commerce-prod' },
  { id: 'rds-orders-prod', name: 'orders-db', type: 'database', provider: 'aws', parentResourceId: 'aws-use1-prod', health: 'healthy', owner: 'Commerce', team: 'Orders', updatedAt: T0, metrics: sim(4, 820, 0), metadata: { engine: 'PostgreSQL 17', replicas: 2 } },
  { id: 'rds-inventory-prod', name: 'inventory-db', type: 'database', provider: 'aws', parentResourceId: 'aws-use1-prod', health: 'degraded', owner: 'Commerce', team: 'Fulfilment', updatedAt: T1, metrics: sim(38, 410, 0.4), metadata: { engine: 'PostgreSQL 17', replicas: 2, note: 'replica-2 lagging behind primary' } },
  { id: 'redis-sessions-prod', name: 'sessions-cache', type: 'cache', provider: 'aws', parentResourceId: 'aws-use1-prod', health: 'healthy', owner: 'Platform', team: 'Identity', updatedAt: T0, metrics: sim(1, 5400, 0), metadata: { engine: 'Redis 7' } },

  { id: 'aws-acct-commerce-nonprod', name: 'commerce-nonprod', type: 'account', provider: 'aws', metadata: { accountId: '000000000002' } },
  { id: 'aws-use1-nonprod', name: 'us-east-1', type: 'region', provider: 'aws', parentResourceId: 'aws-acct-commerce-nonprod' },
  { id: 'eks-commerce-staging', name: 'eks-commerce-staging', type: 'cluster', provider: 'aws', parentResourceId: 'aws-use1-nonprod', environmentId: 'staging' },
  { id: 'ns-commerce-staging', name: 'commerce', type: 'namespace', provider: 'aws', parentResourceId: 'eks-commerce-staging' },
  { id: 'eks-commerce-dev', name: 'eks-commerce-dev', type: 'cluster', provider: 'aws', parentResourceId: 'aws-use1-nonprod', environmentId: 'development' },
  { id: 'ns-commerce-dev', name: 'commerce', type: 'namespace', provider: 'aws', parentResourceId: 'eks-commerce-dev' },

  // Azure -------------------------------------------------------------------------------------
  { id: 'az-sub-payments', name: 'payments', type: 'subscription', provider: 'azure' },
  { id: 'az-weu', name: 'westeurope', type: 'region', provider: 'azure', parentResourceId: 'az-sub-payments' },
  { id: 'aks-payments-prod', name: 'aks-payments-prod', type: 'cluster', provider: 'azure', parentResourceId: 'az-weu', environmentId: 'production' },
  { id: 'ns-payments-prod', name: 'payments', type: 'namespace', provider: 'azure', parentResourceId: 'aks-payments-prod' },
  { id: 'ns-risk-prod', name: 'risk', type: 'namespace', provider: 'azure', parentResourceId: 'aks-payments-prod' },
  { id: 'pg-payments-prod', name: 'payments-db', type: 'database', provider: 'azure', parentResourceId: 'az-weu', environmentId: 'production', health: 'healthy', owner: 'Payments', team: 'Payments', updatedAt: T0, metrics: sim(6, 310, 0), metadata: { engine: 'Azure Database for PostgreSQL' } },
  { id: 'aks-payments-staging', name: 'aks-payments-staging', type: 'cluster', provider: 'azure', parentResourceId: 'az-weu', environmentId: 'staging' },
  { id: 'ns-payments-staging', name: 'payments', type: 'namespace', provider: 'azure', parentResourceId: 'aks-payments-staging' },

  // GCP ---------------------------------------------------------------------------------------
  { id: 'gcp-proj-data', name: 'data-platform', type: 'project', provider: 'gcp' },
  { id: 'gcp-usc1', name: 'us-central1', type: 'region', provider: 'gcp', parentResourceId: 'gcp-proj-data' },
  { id: 'kafka-events-prod', name: 'events-kafka', type: 'broker', provider: 'gcp', parentResourceId: 'gcp-usc1', environmentId: 'production', health: 'healthy', owner: 'Platform', team: 'Data Platform', updatedAt: T0, metadata: { technology: 'Apache Kafka', brokers: 3 } },
  { id: 'topic-orders-events-prod', name: 'orders.events', type: 'topic', provider: 'gcp', parentResourceId: 'kafka-events-prod', health: 'healthy', owner: 'Commerce', team: 'Orders', updatedAt: T0, metrics: sim(12, 140, 0), metadata: { partitions: 6, retention: '7d' } },
  { id: 'topic-inventory-updates-prod', name: 'inventory.updates', type: 'topic', provider: 'gcp', parentResourceId: 'kafka-events-prod', health: 'healthy', owner: 'Commerce', team: 'Fulfilment', updatedAt: T0, metrics: sim(15, 95, 0), metadata: { partitions: 3, retention: '3d' } },
  { id: 'topic-payments-events-prod', name: 'payments.events', type: 'topic', provider: 'gcp', parentResourceId: 'kafka-events-prod', health: 'healthy', owner: 'Payments', team: 'Payments', updatedAt: T0, metrics: sim(11, 120, 0), metadata: { partitions: 6, retention: '30d' } },
  { id: 'search-catalog-prod', name: 'catalog-search', type: 'search-index', provider: 'gcp', parentResourceId: 'gcp-usc1', environmentId: 'production', health: 'healthy', owner: 'Commerce', team: 'Catalog', updatedAt: T0, metrics: sim(22, 640, 0.1), metadata: { technology: 'OpenSearch' } },
  { id: 'kafka-events-staging', name: 'events-kafka-staging', type: 'broker', provider: 'gcp', parentResourceId: 'gcp-usc1', environmentId: 'staging', health: 'healthy', owner: 'Platform', team: 'Data Platform', updatedAt: T0, metadata: { technology: 'Apache Kafka', brokers: 1 } },
  { id: 'topic-orders-events-staging', name: 'orders.events', type: 'topic', provider: 'gcp', parentResourceId: 'kafka-events-staging', health: 'healthy', owner: 'Commerce', team: 'Orders', updatedAt: T0, metadata: { partitions: 1 } },

  // On-premises -------------------------------------------------------------------------------
  { id: 'dc-fra', name: 'Frankfurt DC', type: 'datacenter', provider: 'on-prem', environmentId: 'production' },
  { id: 'k8s-fra-prod', name: 'fra-k8s-prod', type: 'cluster', provider: 'on-prem', parentResourceId: 'dc-fra', metadata: { distribution: 'Rancher RKE2' } },
  { id: 'ns-batch-prod', name: 'batch', type: 'namespace', provider: 'on-prem', parentResourceId: 'k8s-fra-prod' },
  { id: 'ns-messaging-prod', name: 'messaging', type: 'namespace', provider: 'on-prem', parentResourceId: 'k8s-fra-prod' },
  { id: 'rabbitmq-fra-prod', name: 'rabbitmq-fra', type: 'broker', provider: 'on-prem', parentResourceId: 'dc-fra', health: 'healthy', owner: 'Platform', team: 'Messaging', updatedAt: T0, metadata: { technology: 'RabbitMQ 4', vhost: '/notifications' } },
  { id: 'exchange-notifications-prod', name: 'notifications', type: 'exchange', provider: 'on-prem', parentResourceId: 'rabbitmq-fra-prod', health: 'healthy', owner: 'Commerce', team: 'Engagement', updatedAt: T0, metrics: sim(2, 60, 0), metadata: { exchangeType: 'topic' } },
  { id: 'queue-notifications-email-prod', name: 'notifications.email', type: 'queue', provider: 'on-prem', parentResourceId: 'rabbitmq-fra-prod', health: 'degraded', owner: 'Commerce', team: 'Engagement', updatedAt: T1, metrics: sim(4200, 18, 0), metadata: { durable: true, depth: 12840, note: 'backlog growing: consumers unavailable' } },
  { id: 'pg-ledger-prod', name: 'ledger-db', type: 'database', provider: 'on-prem', parentResourceId: 'dc-fra', health: 'healthy', owner: 'Payments', team: 'Payments', updatedAt: T0, metrics: sim(3, 210, 0), metadata: { engine: 'PostgreSQL 16' } },

  // SaaS (environment-independent) ------------------------------------------------------------
  { id: 'ext-card-processor', name: 'Card Processor API', type: 'external-resource', provider: 'saas', health: 'healthy', owner: 'Third party', updatedAt: T0, metrics: sim(180, 42, 0.2) },
  { id: 'ext-email-delivery', name: 'Email Delivery API', type: 'external-resource', provider: 'saas', health: 'unknown', owner: 'Third party', updatedAt: T0 },
];

// ---------------------------------------------------------------------------------------------
// Service instances (exactly one environment each)
// ---------------------------------------------------------------------------------------------

const serviceInstances: ServiceInstance[] = [
  // Production
  { id: 'api-gateway.production', serviceDefinitionId: 'api-gateway', environmentId: 'production', provider: 'aws', health: 'healthy', version: '3.14.2', endpoint: 'https://api.example.test', resourceId: 'ns-edge-prod', metrics: sim(18, 2400, 0.1), updatedAt: T0 },
  { id: 'web-bff.production', serviceDefinitionId: 'web-bff', environmentId: 'production', provider: 'aws', health: 'healthy', version: '2.8.0', resourceId: 'ns-edge-prod', metrics: sim(42, 1300, 0.2), updatedAt: T0 },
  { id: 'auth-service.production', serviceDefinitionId: 'auth-service', environmentId: 'production', provider: 'aws', health: 'healthy', version: '5.2.1', resourceId: 'ns-edge-prod', metrics: sim(9, 900, 0), updatedAt: T0 },
  { id: 'cart-service.production', serviceDefinitionId: 'cart-service', environmentId: 'production', provider: 'aws', health: 'healthy', version: '1.19.0', resourceId: 'ns-commerce-prod', metrics: sim(14, 610, 0.1), updatedAt: T0 },
  { id: 'catalog-service.production', serviceDefinitionId: 'catalog-service', environmentId: 'production', provider: 'aws', health: 'healthy', version: '4.3.0', resourceId: 'ns-commerce-prod', metrics: sim(27, 1500, 0.1), updatedAt: T0 },
  { id: 'order-service.production', serviceDefinitionId: 'order-service', environmentId: 'production', provider: 'aws', health: 'healthy', version: '7.0.3', resourceId: 'ns-commerce-prod', metrics: sim(64, 220, 0.3), updatedAt: T0 },
  { id: 'inventory-service.production', serviceDefinitionId: 'inventory-service', environmentId: 'production', provider: 'aws', health: 'degraded', version: '3.6.1', resourceId: 'ns-commerce-prod', metrics: sim(210, 180, 2.4), updatedAt: T1, metadata: { note: 'p95 latency elevated; waiting on inventory-db replica' } },
  { id: 'notification-service.production', serviceDefinitionId: 'notification-service', environmentId: 'production', provider: 'on-prem', health: 'unavailable', version: '2.1.0', resourceId: 'ns-messaging-prod', metrics: sim(0, 0, 100), updatedAt: T1, metadata: { note: '2 of 4 replicas crash-looping' } },
  { id: 'email-dispatcher.production', serviceDefinitionId: 'email-dispatcher', environmentId: 'production', provider: 'on-prem', health: 'healthy', version: '1.4.2', resourceId: 'ns-messaging-prod', metrics: sim(95, 16, 0.5), updatedAt: T0 },
  { id: 'legacy-report-cron.production', serviceDefinitionId: 'legacy-report-cron', environmentId: 'production', provider: 'on-prem', health: 'unknown', version: '0.9.7', resourceId: 'ns-batch-prod', updatedAt: T0, metadata: { schedule: '0 2 * * *' } },
  { id: 'payment-service.production', serviceDefinitionId: 'payment-service', environmentId: 'production', provider: 'azure', health: 'healthy', version: '6.2.0', resourceId: 'ns-payments-prod', metrics: sim(120, 140, 0.2), updatedAt: T0 },
  { id: 'fraud-scoring.production', serviceDefinitionId: 'fraud-scoring', environmentId: 'production', provider: 'azure', health: 'degraded', version: '2.0.5', resourceId: 'ns-risk-prod', metrics: sim(340, 140, 1.1), updatedAt: T1, metadata: { note: '1 of 3 replicas restarting' } },
  { id: 'ledger-service.production', serviceDefinitionId: 'ledger-service', environmentId: 'production', provider: 'azure', health: 'healthy', version: '3.1.0', resourceId: 'ns-payments-prod', metrics: sim(21, 120, 0), updatedAt: T0 },
  { id: 'payout-worker.production', serviceDefinitionId: 'payout-worker', environmentId: 'production', provider: 'azure', health: 'healthy', version: '1.7.4', resourceId: 'ns-payments-prod', updatedAt: T0, metadata: { schedule: '0 */6 * * *' } },

  // Staging
  { id: 'api-gateway.staging', serviceDefinitionId: 'api-gateway', environmentId: 'staging', provider: 'aws', health: 'healthy', version: '3.15.0-rc.1', endpoint: 'https://api.staging.example.test', resourceId: 'ns-commerce-staging', metrics: sim(21, 40, 0.1), updatedAt: T0 },
  { id: 'catalog-service.staging', serviceDefinitionId: 'catalog-service', environmentId: 'staging', provider: 'aws', health: 'healthy', version: '4.4.0-rc.2', resourceId: 'ns-commerce-staging', metrics: sim(30, 22, 0), updatedAt: T0 },
  { id: 'order-service.staging', serviceDefinitionId: 'order-service', environmentId: 'staging', provider: 'aws', health: 'healthy', version: '7.1.0-rc.1', resourceId: 'ns-commerce-staging', metrics: sim(70, 6, 0), updatedAt: T0 },
  { id: 'inventory-service.staging', serviceDefinitionId: 'inventory-service', environmentId: 'staging', provider: 'aws', health: 'healthy', version: '3.7.0-rc.1', resourceId: 'ns-commerce-staging', metrics: sim(35, 5, 0), updatedAt: T0 },
  { id: 'payment-service.staging', serviceDefinitionId: 'payment-service', environmentId: 'staging', provider: 'azure', health: 'degraded', version: '6.3.0-rc.3', resourceId: 'ns-payments-staging', metrics: sim(480, 4, 6.5), updatedAt: T1, metadata: { note: 'sandbox card processor rate-limited' } },

  // Development
  { id: 'catalog-service.development', serviceDefinitionId: 'catalog-service', environmentId: 'development', provider: 'aws', health: 'healthy', version: '4.5.0-dev', resourceId: 'ns-commerce-dev', updatedAt: T0 },
  { id: 'order-service.development', serviceDefinitionId: 'order-service', environmentId: 'development', provider: 'aws', health: 'unknown', version: '7.2.0-dev', resourceId: 'ns-commerce-dev', updatedAt: T0 },
];

// ---------------------------------------------------------------------------------------------
// Communication relationships (source → target; producer → topic → consumer)
// ---------------------------------------------------------------------------------------------

function rel(
  sourceEntityId: string,
  targetEntityId: string,
  protocol: Protocol,
  pattern: CommunicationPattern,
  extra: Partial<Omit<CommunicationRelationship, 'id' | 'sourceEntityId' | 'targetEntityId' | 'protocol' | 'pattern'>> & {
    status?: RelationshipStatus;
  } = {},
): CommunicationRelationship {
  return {
    id: `rel:${sourceEntityId}->${targetEntityId}`,
    sourceEntityId,
    targetEntityId,
    protocol,
    pattern,
    direction: 'unidirectional',
    status: 'active',
    updatedAt: T0,
    ...extra,
  };
}

const relationships: CommunicationRelationship[] = [
  // Production — edge and commerce
  rel('api-gateway.production', 'web-bff.production', 'http', 'synchronous', { metrics: sim(40, 1300, 0.2) }),
  rel('api-gateway.production', 'auth-service.production', 'grpc', 'synchronous', { authenticationType: 'mTLS', metrics: sim(8, 900, 0) }),
  rel('api-gateway.production', 'order-service.production', 'https', 'synchronous', { authenticationType: 'JWT', endpoint: '/v1/orders', metrics: sim(62, 220, 0.3) }),
  rel('api-gateway.production', 'catalog-service.production', 'http', 'synchronous', { metrics: sim(25, 900, 0.1) }),
  rel('web-bff.production', 'cart-service.production', 'grpc', 'synchronous', { metrics: sim(13, 610, 0.1) }),
  rel('web-bff.production', 'catalog-service.production', 'grpc', 'synchronous', { metrics: sim(24, 600, 0.1) }),
  rel('auth-service.production', 'redis-sessions-prod', 'redis', 'database', { metrics: sim(1, 900, 0) }),
  rel('cart-service.production', 'redis-sessions-prod', 'redis', 'database', { metrics: sim(1, 1200, 0) }),
  rel('cart-service.production', 'catalog-service.production', 'grpc', 'synchronous', { metrics: sim(20, 300, 0) }),
  rel('order-service.production', 'payment-service.production', 'https', 'synchronous', { authenticationType: 'mTLS', endpoint: '/v2/payments', metrics: sim(118, 140, 0.2), metadata: { note: 'cross-cloud: AWS → Azure' } }),
  rel('order-service.production', 'inventory-service.production', 'grpc', 'synchronous', { status: 'degraded', metrics: sim(205, 180, 2.4) }),
  rel('order-service.production', 'rds-orders-prod', 'postgresql', 'database', { metrics: sim(4, 600, 0) }),
  rel('order-service.production', 'topic-orders-events-prod', 'kafka', 'asynchronous', { metrics: sim(9, 140, 0) }),
  rel('topic-orders-events-prod', 'inventory-service.production', 'kafka', 'asynchronous', { metrics: sim(14, 140, 0) }),
  rel('topic-orders-events-prod', 'notification-service.production', 'kafka', 'asynchronous', { status: 'degraded', metrics: sim(0, 0, 100) }),
  rel('inventory-service.production', 'rds-inventory-prod', 'postgresql', 'database', { status: 'degraded', metrics: sim(38, 410, 0.4) }),
  rel('inventory-service.production', 'topic-inventory-updates-prod', 'kafka', 'asynchronous', { metrics: sim(12, 95, 0) }),
  rel('topic-inventory-updates-prod', 'catalog-service.production', 'kafka', 'asynchronous', { metrics: sim(16, 95, 0) }),
  rel('catalog-service.production', 'search-catalog-prod', 'https', 'synchronous', { metrics: sim(21, 640, 0.1) }),
  rel('notification-service.production', 'exchange-notifications-prod', 'rabbitmq', 'asynchronous', { status: 'inactive', metrics: sim(0, 0, 0) }),
  rel('exchange-notifications-prod', 'queue-notifications-email-prod', 'rabbitmq', 'asynchronous', { metadata: { bindingKey: 'notify.email.*' }, metrics: sim(1, 60, 0) }),
  rel('queue-notifications-email-prod', 'email-dispatcher.production', 'rabbitmq', 'asynchronous', { metrics: sim(3, 16, 0) }),
  rel('email-dispatcher.production', 'ext-email-delivery', 'https', 'synchronous', { authenticationType: 'API key', metrics: sim(90, 16, 0.5) }),
  rel('legacy-report-cron.production', 'rds-orders-prod', 'postgresql', 'scheduled', { status: 'unknown', metadata: { note: 'cross-site: on-prem → AWS' } }),

  // Production — payments
  rel('payment-service.production', 'fraud-scoring.production', 'grpc', 'synchronous', { status: 'degraded', metrics: sim(330, 140, 1.1) }),
  rel('payment-service.production', 'pg-payments-prod', 'postgresql', 'database', { metrics: sim(6, 310, 0) }),
  rel('payment-service.production', 'ext-card-processor', 'https', 'synchronous', { authenticationType: 'mTLS', metrics: sim(178, 42, 0.2) }),
  rel('payment-service.production', 'topic-payments-events-prod', 'kafka', 'asynchronous', { metrics: sim(10, 120, 0) }),
  rel('topic-payments-events-prod', 'ledger-service.production', 'kafka', 'asynchronous', { metrics: sim(13, 120, 0) }),
  rel('ledger-service.production', 'pg-ledger-prod', 'postgresql', 'database', { metadata: { note: 'cross-site: Azure → on-prem' }, metrics: sim(9, 210, 0) }),
  rel('payout-worker.production', 'ledger-service.production', 'grpc', 'scheduled'),
  rel('payout-worker.production', 'ext-card-processor', 'https', 'scheduled', { authenticationType: 'mTLS' }),

  // Staging
  rel('api-gateway.staging', 'order-service.staging', 'https', 'synchronous', { metrics: sim(68, 6, 0) }),
  rel('api-gateway.staging', 'catalog-service.staging', 'http', 'synchronous', { metrics: sim(28, 22, 0) }),
  rel('order-service.staging', 'payment-service.staging', 'https', 'synchronous', { status: 'degraded', metrics: sim(470, 4, 6.5) }),
  rel('order-service.staging', 'topic-orders-events-staging', 'kafka', 'asynchronous', { metrics: sim(10, 6, 0) }),
  rel('topic-orders-events-staging', 'inventory-service.staging', 'kafka', 'asynchronous', { metrics: sim(12, 6, 0) }),
  rel('payment-service.staging', 'ext-card-processor', 'https', 'synchronous', { status: 'degraded', metadata: { note: 'sandbox credentials' } }),

  // Development
  rel('order-service.development', 'catalog-service.development', 'grpc', 'synchronous'),
];

/**
 * Event types (ADR-014): logical contracts on the channels above. Producers and consumers match the
 * messaging relationships exactly; definitions without an instance in an environment are simply not
 * deployed there (e.g. Notification Service in staging).
 */
const ORDERS = ['topic-orders-events-prod', 'topic-orders-events-staging'];
const eventTypes: EventType[] = [
  { id: 'event-order-placed', name: 'OrderPlaced', description: 'Emitted when a customer order is accepted and awaiting payment.', schemaVersion: 'v3', owner: 'Commerce', team: 'Orders', channelResourceIds: ORDERS, producerServiceIds: ['order-service'], consumerServiceIds: ['inventory-service', 'notification-service'] },
  { id: 'event-order-cancelled', name: 'OrderCancelled', description: 'Emitted when an order is cancelled before fulfilment.', schemaVersion: 'v2', owner: 'Commerce', team: 'Orders', channelResourceIds: ORDERS, producerServiceIds: ['order-service'], consumerServiceIds: ['inventory-service'] },
  { id: 'event-order-shipped', name: 'OrderShipped', description: 'Emitted when an order leaves the warehouse.', schemaVersion: 'v1', owner: 'Commerce', team: 'Orders', channelResourceIds: ORDERS, producerServiceIds: ['order-service'], consumerServiceIds: ['notification-service'] },
  { id: 'event-stock-level-changed', name: 'StockLevelChanged', description: 'Emitted when available stock for an item changes.', schemaVersion: 'v2', owner: 'Commerce', team: 'Fulfilment', channelResourceIds: ['topic-inventory-updates-prod'], producerServiceIds: ['inventory-service'], consumerServiceIds: ['catalog-service'] },
  { id: 'event-stock-reserved', name: 'StockReserved', description: 'Emitted when stock is held against an open order.', schemaVersion: 'v1', owner: 'Commerce', team: 'Fulfilment', channelResourceIds: ['topic-inventory-updates-prod'], producerServiceIds: ['inventory-service'], consumerServiceIds: ['catalog-service'] },
  { id: 'event-payment-captured', name: 'PaymentCaptured', description: 'Emitted when funds are captured for an order.', schemaVersion: 'v4', owner: 'Payments', team: 'Payments', channelResourceIds: ['topic-payments-events-prod'], producerServiceIds: ['payment-service'], consumerServiceIds: ['ledger-service'] },
  { id: 'event-payment-failed', name: 'PaymentFailed', description: 'Emitted when a capture attempt is declined or errors. No consumer is modeled yet.', schemaVersion: 'v2', owner: 'Payments', team: 'Payments', channelResourceIds: ['topic-payments-events-prod'], producerServiceIds: ['payment-service'], consumerServiceIds: [] },
  { id: 'event-refund-issued', name: 'RefundIssued', description: 'Emitted when a refund is sent back to the customer.', schemaVersion: 'v1', owner: 'Payments', team: 'Payments', channelResourceIds: ['topic-payments-events-prod'], producerServiceIds: ['payment-service'], consumerServiceIds: ['ledger-service'] },
  { id: 'event-notification-requested', name: 'NotificationRequested', description: 'Published when a customer message is ready for delivery; routed to the email queue.', schemaVersion: 'v1', owner: 'Commerce', team: 'Engagement', channelResourceIds: ['exchange-notifications-prod'], producerServiceIds: ['notification-service'], consumerServiceIds: ['email-dispatcher'], metadata: { routingKey: 'notify.email.order' } },
];

export const mockTopology: TopologyData = {
  environments,
  serviceDefinitions,
  serviceInstances,
  resources,
  relationships,
  eventTypes,
};
