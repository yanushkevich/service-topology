import type { TopologyIndex } from './topologyIndex';
import type { CommunicationRelationship, EntityId, HealthStatus, ResourceType } from './types';

/**
 * Failure propagation (Milestone 3). Rules are explicit data so the UI can list them and every
 * impact can say which rule produced it. Pure and deterministic: same index + same failures →
 * same impacts in the same order.
 *
 * Scope: rules apply to *simulated* failures only. Baseline health in the data is never propagated;
 * that would invent incidents the data does not describe.
 */

export type FailureMode = 'unavailable' | 'degraded';

export const PROPAGATION_RULE_IDS = [
  'containment',
  'synchronous-call',
  'data-access',
  'scheduled-job',
  'publish-to-failed-channel',
  'consume-from-failed-channel',
  'consumer-backlog',
] as const;
export type PropagationRuleId = (typeof PROPAGATION_RULE_IDS)[number];

export interface PropagationRule {
  id: PropagationRuleId;
  title: string;
  /** When the rule fires, in plain language. */
  when: string;
  /** Who is affected and how. */
  effect: string;
  /** Why this is the modeled behavior. */
  rationale: string;
  /** Whether the affected entity propagates further. */
  transitive: boolean;
}

export const PROPAGATION_RULES: readonly PropagationRule[] = [
  {
    id: 'containment',
    title: 'Containment failure',
    when: 'An infrastructure resource (cluster, namespace, broker, region…) becomes unavailable.',
    effect: 'Everything it contains, including service instances running in it, becomes unavailable.',
    rationale: 'Containment answers "where does this run?": if the host is gone, so is what runs on it.',
    transitive: true,
  },
  {
    id: 'synchronous-call',
    title: 'Synchronous dependency',
    when: 'A service is called synchronously (HTTP, HTTPS, gRPC, GraphQL, WebSocket) and the callee is unavailable or degraded.',
    effect: 'The caller becomes degraded. Callers of the caller are affected in turn.',
    rationale: 'A synchronous caller waits for the response, so callee failures and latency surface in the caller.',
    transitive: true,
  },
  {
    id: 'data-access',
    title: 'Data store dependency',
    when: 'A database, cache, or search index the service reads or writes is unavailable or degraded.',
    effect: 'The service becomes degraded. Its callers are affected in turn.',
    rationale: 'Data access is synchronous from the service’s point of view.',
    transitive: true,
  },
  {
    id: 'scheduled-job',
    title: 'Scheduled job dependency',
    when: 'A scheduled job’s target is unavailable or degraded.',
    effect: 'The job becomes degraded (its runs fail or slow down).',
    rationale: 'A job run is a synchronous call that happens on a timer.',
    transitive: true,
  },
  {
    id: 'publish-to-failed-channel',
    title: 'Publishing to a failed topic/queue',
    when: 'A Kafka topic, RabbitMQ queue, or exchange that a service publishes to is unavailable.',
    effect: 'The producer becomes degraded (publishes fail).',
    rationale: 'Producers depend on the channel accepting messages. A merely degraded channel (backlog) still accepts them.',
    transitive: true,
  },
  {
    id: 'consume-from-failed-channel',
    title: 'Consuming from a failed topic/queue',
    when: 'A topic, queue, or exchange that delivers to a consumer is unavailable.',
    effect: 'The consumer becomes degraded (no new messages; data goes stale).',
    rationale: 'The consumer keeps running but its input stops.',
    transitive: true,
  },
  {
    id: 'consumer-backlog',
    title: 'Consumer backlog',
    when: 'A consumer of a topic or queue is unavailable.',
    effect: 'The topic/queue becomes degraded (backlog grows). Producers are not affected.',
    rationale: 'Asynchronous messaging decouples producers from consumers; the channel absorbs the failure as backlog.',
    transitive: false,
  },
];

/** Not a rule but stated explicitly in the UI: what does *not* propagate. */
export const NON_PROPAGATION_NOTES: readonly string[] = [
  'A failed producer does not affect consumers or the topic/queue: consumers simply receive fewer messages.',
  'A degraded topic/queue (backlog) does not affect its producers or other consumers.',
  'Propagation never escalates: communication rules make dependents degraded, never unavailable. Only containment makes dependents unavailable.',
  'Baseline health from the data is shown as-is and is not propagated.',
];

const CHANNEL_TYPES: ReadonlySet<ResourceType> = new Set(['topic', 'queue', 'exchange']);
const SYNC_PROTOCOLS = new Set(['http', 'https', 'grpc', 'graphql', 'websocket', 'tcp', 'tls']);
const DATA_PROTOCOLS = new Set(['postgresql', 'mysql', 'mongodb', 'redis']);

export interface FailureRoot {
  entityId: EntityId;
  mode: FailureMode;
}

export interface Impact {
  entityId: EntityId;
  effect: FailureMode;
  ruleId: PropagationRuleId;
  /** Root failure this impact traces back to. */
  rootId: EntityId;
  /** Relationship the impact travelled over (absent for containment). */
  viaRelationshipId?: EntityId;
  /** Entity whose failure caused this one (previous hop). */
  causeId: EntityId;
  /** Root → … → entityId. */
  path: EntityId[];
}

const isChannel = (index: TopologyIndex, id: EntityId) => {
  const type = index.resources.get(id)?.type;
  return type !== undefined && CHANNEL_TYPES.has(type);
};

/** Rule that makes the *source* of `r` affected when its target fails, if any. */
function ruleForCaller(index: TopologyIndex, r: CommunicationRelationship, targetEffect: FailureMode): PropagationRuleId | null {
  if (isChannel(index, r.targetEntityId)) {
    return targetEffect === 'unavailable' ? 'publish-to-failed-channel' : null;
  }
  if (isChannel(index, r.sourceEntityId)) return null; // channel → consumer: handled as backlog
  if (r.pattern === 'scheduled') return 'scheduled-job';
  if (r.pattern === 'database' || DATA_PROTOCOLS.has(r.protocol)) return 'data-access';
  if (r.pattern === 'synchronous' || SYNC_PROTOCOLS.has(r.protocol)) return 'synchronous-call';
  return null; // asynchronous point-to-point: decoupled
}

/** Containment descendants: child resources (recursively) and instances hosted in them. */
function containedEntities(index: TopologyIndex, resourceId: EntityId): EntityId[] {
  const out: EntityId[] = [];
  const stack = [resourceId];
  const seen = new Set<EntityId>([resourceId]);
  while (stack.length > 0) {
    const id = stack.pop() as EntityId;
    for (const instance of index.instancesByResource.get(id) ?? []) out.push(instance.id);
    for (const child of index.childResources.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out.sort();
}

const SEVERITY: Record<FailureMode, number> = { degraded: 1, unavailable: 2 };

/**
 * Breadth-first impact analysis from simulated failure roots. Each entity appears at most once,
 * with its most severe effect (ties: shortest path, then root/rule order). Roots are not listed.
 */
export function analyzeImpact(index: TopologyIndex, roots: readonly FailureRoot[]): Impact[] {
  const rootIds = new Set(roots.map((r) => r.entityId));
  const best = new Map<EntityId, Impact>();
  // Queue entries: entity currently "failing" and its effect.
  const queue: { id: EntityId; effect: FailureMode; rootId: EntityId; path: EntityId[] }[] = [...roots]
    .sort((a, b) => a.entityId.localeCompare(b.entityId))
    .map((r) => ({ id: r.entityId, effect: r.mode, rootId: r.entityId, path: [r.entityId] }));

  const record = (impact: Impact, transitive: boolean) => {
    if (rootIds.has(impact.entityId)) return;
    const existing = best.get(impact.entityId);
    if (existing && SEVERITY[existing.effect] >= SEVERITY[impact.effect]) return;
    best.set(impact.entityId, impact);
    if (transitive) queue.push({ id: impact.entityId, effect: impact.effect, rootId: impact.rootId, path: impact.path });
  };

  while (queue.length > 0) {
    const { id, effect, rootId, path } = queue.shift() as (typeof queue)[number];

    if (effect === 'unavailable' && index.resources.has(id)) {
      for (const child of containedEntities(index, id)) {
        record({ entityId: child, effect: 'unavailable', ruleId: 'containment', rootId, causeId: id, path: [...path, child] }, true);
      }
    }

    // Callers / producers of the failing entity.
    for (const r of [...(index.incoming.get(id) ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      if (isChannel(index, r.sourceEntityId)) {
        // Failing consumer → its channel backs up (terminal).
        if (effect === 'unavailable') {
          record(
            { entityId: r.sourceEntityId, effect: 'degraded', ruleId: 'consumer-backlog', rootId, viaRelationshipId: r.id, causeId: id, path: [...path, r.sourceEntityId] },
            false,
          );
        }
        continue;
      }
      const rule = ruleForCaller(index, r, effect);
      if (rule) {
        record(
          { entityId: r.sourceEntityId, effect: 'degraded', ruleId: rule, rootId, viaRelationshipId: r.id, causeId: id, path: [...path, r.sourceEntityId] },
          true,
        );
      }
    }

    // Consumers of a failing channel.
    if (effect === 'unavailable' && isChannel(index, id)) {
      for (const r of [...(index.outgoing.get(id) ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
        record(
          { entityId: r.targetEntityId, effect: 'degraded', ruleId: 'consume-from-failed-channel', rootId, viaRelationshipId: r.id, causeId: id, path: [...path, r.targetEntityId] },
          true,
        );
      }
    }
  }

  return [...best.values()].sort((a, b) => a.path.length - b.path.length || a.entityId.localeCompare(b.entityId));
}

/** Worse of two health values (unavailable > degraded > unknown > healthy). */
export function worseHealth(a: HealthStatus, b: HealthStatus): HealthStatus {
  const rank: Record<HealthStatus, number> = { healthy: 0, unknown: 1, degraded: 2, unavailable: 3 };
  return rank[b] > rank[a] ? b : a;
}
