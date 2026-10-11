import type {
  CommunicationRelationship,
  EnvironmentRecord,
  HealthStatus,
  InfrastructureResource,
  Metrics,
  Protocol,
  Provider,
  ResourceType,
  ServiceCategory,
  ServiceDefinition,
  ServiceInstance,
  TopologyData,
} from '../../domain/types';

/**
 * Deterministic synthetic topology for scale tests and benchmarks (ADR-005). Same options → same
 * data. Every generated metric is simulated. Relationships never cross environments; SaaS
 * externals are environment-independent.
 */

export interface GenerateOptions {
  seed: number;
  environments: readonly ('production' | 'staging' | 'development')[];
  /** Per environment. */
  instances: number;
  databases: number;
  caches: number;
  topics: number;
  queues: number;
  /** Shared across environments. */
  externals: number;
  /** Communication relationships per environment (target; capped by available unique pairs). */
  relationships: number;
}

/** Benchmark fixture: exactly 250 visible nodes and 750 edges in production. */
export const SCALE_250: GenerateOptions = {
  seed: 250,
  environments: ['production'],
  instances: 180,
  databases: 30,
  caches: 10,
  topics: 20,
  queues: 5,
  externals: 5,
  relationships: 750,
};

/** Navigability fixture: ~1,000 entities across three environments. */
export const INVENTORY_1000: GenerateOptions = {
  seed: 1000,
  environments: ['production', 'staging', 'development'],
  instances: 256,
  databases: 26,
  caches: 8,
  topics: 18,
  queues: 5,
  externals: 6,
  relationships: 700,
};

const PROVIDERS: readonly Provider[] = ['aws', 'azure', 'gcp', 'on-prem'];
const ROOT_TYPE: Record<string, ResourceType> = { aws: 'account', azure: 'subscription', gcp: 'project', 'on-prem': 'datacenter' };
const REGION: Record<string, string> = { aws: 'us-east-1', azure: 'westeurope', gcp: 'us-central1', 'on-prem': 'fra' };
const DOMAINS = ['orders', 'payments', 'catalog', 'users', 'search', 'billing', 'shipping', 'inventory', 'pricing', 'reviews', 'identity', 'notify', 'ledger', 'fraud', 'media', 'analytics'];
const ROLES: readonly [string, ServiceCategory][] = [
  ['api', 'api'],
  ['worker', 'worker'],
  ['gateway', 'gateway'],
  ['sync', 'worker'],
  ['scheduler', 'scheduled-job'],
  ['web', 'application'],
];
const T = '2026-10-11T08:00:00Z';
const ENV_SHORT = { production: 'prod', staging: 'stg', development: 'dev' } as const;

/** mulberry32: small, fast, deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(3, '0');

export function generateTopology(options: GenerateOptions): TopologyData {
  const random = rng(options.seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const health = (): HealthStatus => {
    const r = random();
    return r < 0.86 ? 'healthy' : r < 0.95 ? 'degraded' : r < 0.98 ? 'unavailable' : 'unknown';
  };
  const sim = (latency: number): Metrics => ({
    latencyMs: Math.round(latency * (0.5 + random())),
    throughputPerSecond: Math.round(10 + random() * 900),
    errorRatePercent: Math.round(random() * 20) / 10,
    isSimulated: true,
    observedAt: T,
  });

  const environments: EnvironmentRecord[] = options.environments.map((id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    kind: id,
  }));

  const resources: InfrastructureResource[] = [];
  for (const p of PROVIDERS) {
    resources.push({ id: `gen-${p}-root`, name: `${p}-root`, type: ROOT_TYPE[p] ?? 'account', provider: p });
    resources.push({ id: `gen-${p}-region`, name: REGION[p] ?? 'region', type: 'region', provider: p, parentResourceId: `gen-${p}-root` });
  }

  const definitions: ServiceDefinition[] = Array.from({ length: options.instances }, (_, i) => {
    const domain = DOMAINS[i % DOMAINS.length] as string;
    const [role, category] = ROLES[Math.floor(i / DOMAINS.length) % ROLES.length] as [string, ServiceCategory];
    return {
      id: `gen-svc-${pad(i)}`,
      name: `${domain}-${role}-${pad(i)}`,
      owner: domain.charAt(0).toUpperCase() + domain.slice(1),
      team: `${domain} team`,
      category,
      protocols: ['grpc', 'https'],
    };
  });

  const externals: InfrastructureResource[] = Array.from({ length: options.externals }, (_, i) => ({
    id: `gen-ext-${pad(i)}`,
    name: `external-api-${pad(i)}`,
    type: 'external-resource',
    provider: 'saas',
    health: 'healthy',
    owner: 'Third party',
    updatedAt: T,
  }));
  resources.push(...externals);

  const instances: ServiceInstance[] = [];
  const relationships: CommunicationRelationship[] = [];

  for (const env of options.environments) {
    const e = ENV_SHORT[env];
    const namespaces: string[] = [];
    for (const p of PROVIDERS) {
      resources.push({ id: `gen-${p}-cluster-${e}`, name: `${p}-cluster-${e}`, type: 'cluster', provider: p, parentResourceId: `gen-${p}-region`, environmentId: env });
      for (let n = 0; n < 3; n++) {
        const id = `gen-${p}-ns${n}-${e}`;
        resources.push({ id, name: `ns-${n}`, type: 'namespace', provider: p, parentResourceId: `gen-${p}-cluster-${e}` });
        namespaces.push(id);
      }
    }
    const kafka = `gen-kafka-${e}`;
    const rabbit = `gen-rabbit-${e}`;
    resources.push({ id: kafka, name: `kafka-${e}`, type: 'broker', provider: 'gcp', parentResourceId: 'gen-gcp-region', environmentId: env, health: 'healthy', updatedAt: T });
    resources.push({ id: rabbit, name: `rabbitmq-${e}`, type: 'broker', provider: 'on-prem', parentResourceId: 'gen-on-prem-region', environmentId: env, health: 'healthy', updatedAt: T });

    const envInstances = definitions.map((d, i): ServiceInstance => {
      const namespace = namespaces[i % namespaces.length] as string;
      return {
        id: `${d.id}.${env}`,
        serviceDefinitionId: d.id,
        environmentId: env,
        provider: PROVIDERS[Math.floor((i % namespaces.length) / 3)] ?? 'aws',
        health: health(),
        version: `1.${i % 10}.0`,
        resourceId: namespace,
        metrics: sim(40),
        updatedAt: T,
      };
    });
    instances.push(...envInstances);

    const make = (type: ResourceType, count: number, prefix: string, parent: (i: number) => string, provider: (i: number) => Provider) =>
      Array.from({ length: count }, (_, i): InfrastructureResource => ({
        id: `gen-${prefix}-${pad(i)}-${e}`,
        name: `${prefix}-${pad(i)}`,
        type,
        provider: provider(i),
        parentResourceId: parent(i),
        // Databases and caches sit under regions (no environment), so they declare their own.
        ...(type === 'database' || type === 'cache' ? { environmentId: env } : {}),
        health: health(),
        owner: definitions[i % definitions.length]?.owner ?? 'Platform',
        updatedAt: T,
        metrics: sim(8),
      }));
    const dbProvider = (i: number) => PROVIDERS[i % PROVIDERS.length] as Provider;
    const dbs = make('database', options.databases, 'db', (i) => `gen-${dbProvider(i)}-region`, dbProvider);
    const caches = make('cache', options.caches, 'cache', (i) => `gen-${dbProvider(i)}-region`, dbProvider);
    const topics = make('topic', options.topics, 'topic', () => kafka, () => 'gcp');
    const queues = make('queue', options.queues, 'queue', () => rabbit, () => 'on-prem');
    resources.push(...dbs, ...caches, ...topics, ...queues);

    // Relationships: first guarantee every node is connected, then fill to the target randomly.
    const seen = new Set<string>();
    const add = (source: string, target: string, protocol: Protocol, pattern: CommunicationRelationship['pattern']) => {
      const key = `${source}->${target}`;
      if (source === target || seen.has(key)) return false;
      seen.add(key);
      relationships.push({
        id: `gen-rel:${key}`,
        sourceEntityId: source,
        targetEntityId: target,
        protocol,
        pattern,
        direction: 'unidirectional',
        status: random() < 0.92 ? 'active' : 'degraded',
        metrics: sim(20),
        updatedAt: T,
      });
      return true;
    };
    const ids = envInstances.map((i) => i.id);
    const n = ids.length;
    ids.forEach((id, i) => add(id, ids[(i + 1) % n] as string, 'grpc', 'synchronous'));
    dbs.forEach((r) => add(pick(ids), r.id, 'postgresql', 'database'));
    caches.forEach((r) => add(pick(ids), r.id, 'redis', 'database'));
    for (const r of [...topics, ...queues]) {
      const protocol: Protocol = r.type === 'topic' ? 'kafka' : 'rabbitmq';
      add(pick(ids), r.id, protocol, 'asynchronous');
      add(r.id, pick(ids), protocol, 'asynchronous');
    }
    externals.forEach((r) => add(pick(ids), r.id, 'https', 'synchronous'));

    const envStart = relationships.length - seen.size;
    const maxPairs = n * (n - 1);
    let attempts = 0;
    while (relationships.length - envStart < options.relationships && attempts < maxPairs * 4) {
      attempts++;
      const r = random();
      const source = pick(ids);
      if (r < 0.62) add(source, pick(ids), random() < 0.5 ? 'grpc' : 'https', 'synchronous');
      else if (r < 0.8) add(source, pick(random() < 0.75 ? dbs : caches).id, random() < 0.75 ? 'postgresql' : 'redis', 'database');
      else if (r < 0.9) add(source, pick(topics).id, 'kafka', 'asynchronous');
      else if (r < 0.96) add(pick(topics).id, source, 'kafka', 'asynchronous');
      else add(source, pick(externals.length > 0 ? externals : dbs).id, 'https', 'synchronous');
    }
  }

  return { environments, serviceDefinitions: definitions, serviceInstances: instances, resources, relationships };
}

/** Datasets selectable at runtime (`?dataset=`) for benchmarks and scale checks. */
export const GENERATED_DATASETS = {
  'scale-250': SCALE_250,
  'inventory-1000': INVENTORY_1000,
} as const;
export type GeneratedDatasetName = keyof typeof GENERATED_DATASETS;
