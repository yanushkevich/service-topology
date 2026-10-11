import { worseHealth } from './propagation';
import { environmentOf, type TopologyIndex } from './topologyIndex';
import type { EntityId, EntityRef, HealthStatus, Provider } from './types';

/**
 * Containment hierarchy (PRODUCT_SPEC Revision 5 §K.3), built only from explicit
 * `parentResourceId` / `ServiceInstance.resourceId`, never inferred from names. Each node rolls up
 * the worst health and the number of contained entities beneath it.
 */

export interface ContainmentNode {
  /** Resource or instance ID, or `provider:<id>` for the synthetic provider level. */
  id: string;
  ref: EntityRef | null;
  name: string;
  /** Resource type, 'service-instance', or 'provider'. */
  type: string;
  provider: Provider;
  /** Explicit or inherited environment; undefined = environment-independent. */
  environmentId: EntityId | undefined;
  environmentInherited: boolean;
  /** Own health (undefined when not modeled). */
  health: HealthStatus | undefined;
  /** Worst health of this node and everything below it. */
  rollupHealth: HealthStatus;
  /** Count of instances and resources below this node. */
  descendantCount: number;
  /** Unhealthy (degraded or unavailable) entities below or at this node. */
  unhealthyCount: number;
  children: ContainmentNode[];
}

export interface ContainmentForest {
  /** One root per provider with containment in the environment. */
  roots: ContainmentNode[];
  /** Top-level resources without environment and without parents (e.g. SaaS APIs). */
  independent: ContainmentNode[];
}

const UNHEALTHY = new Set<HealthStatus>(['degraded', 'unavailable']);
const PROVIDER_NAMES: Record<Provider, string> = {
  aws: 'AWS', azure: 'Azure', gcp: 'GCP', 'on-prem': 'On-premises', saas: 'SaaS / external', internal: 'Internal', unknown: 'Unknown provider',
};

function finalize(node: ContainmentNode): ContainmentNode {
  node.children.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  let rollup: HealthStatus = node.health ?? 'healthy';
  let count = 0;
  let unhealthy = node.health && UNHEALTHY.has(node.health) ? 1 : 0;
  for (const child of node.children) {
    finalize(child);
    rollup = worseHealth(rollup, child.rollupHealth);
    count += 1 + child.descendantCount;
    unhealthy += child.unhealthyCount;
  }
  node.rollupHealth = node.health === undefined && node.children.length === 0 ? 'unknown' : rollup;
  node.descendantCount = count;
  node.unhealthyCount = unhealthy;
  return node;
}

/**
 * Hierarchy for one environment: a resource is included when it belongs to the environment
 * (explicitly or by inheritance) or contains something that does. Instances are included when they
 * are in the environment.
 */
export function containmentForest(index: TopologyIndex, environmentId: EntityId): ContainmentForest {
  const memo = new Map<EntityId, ContainmentNode | null>();

  const build = (resourceId: EntityId): ContainmentNode | null => {
    if (memo.has(resourceId)) return memo.get(resourceId) ?? null;
    const resource = index.resources.get(resourceId);
    if (!resource) return null;
    const env = environmentOf(index, resourceId);
    const children: ContainmentNode[] = [];
    for (const child of index.childResources.get(resourceId) ?? []) {
      const node = build(child.id);
      if (node) children.push(node);
    }
    for (const instance of index.instancesByResource.get(resourceId) ?? []) {
      if (instance.environmentId !== environmentId) continue;
      children.push({
        id: instance.id,
        ref: { kind: 'service-instance', id: instance.id },
        name: index.definitions.get(instance.serviceDefinitionId)?.name ?? instance.id,
        type: 'service-instance',
        provider: instance.provider,
        environmentId: instance.environmentId,
        environmentInherited: false,
        health: instance.health,
        rollupHealth: instance.health,
        descendantCount: 0,
        unhealthyCount: 0,
        children: [],
      });
    }
    const relevant = env === environmentId || children.length > 0;
    const node: ContainmentNode | null = relevant
      ? {
          id: resource.id,
          ref: { kind: 'resource', id: resource.id },
          name: resource.name,
          type: resource.type,
          provider: resource.provider,
          environmentId: env,
          environmentInherited: env !== undefined && resource.environmentId === undefined,
          health: resource.health,
          rollupHealth: resource.health ?? 'healthy',
          descendantCount: 0,
          unhealthyCount: 0,
          children,
        }
      : null;
    memo.set(resourceId, node);
    return node;
  };

  const byProvider = new Map<Provider, ContainmentNode[]>();
  const independent: ContainmentNode[] = [];
  for (const resource of index.data.resources) {
    if (resource.parentResourceId !== undefined) continue;
    const node = build(resource.id);
    if (!node) {
      // Environment-independent leaf (e.g. SaaS API), shown separately.
      if (environmentOf(index, resource.id) === undefined && (index.childResources.get(resource.id) ?? []).length === 0) {
        independent.push(
          finalize({
            id: resource.id,
            ref: { kind: 'resource', id: resource.id },
            name: resource.name,
            type: resource.type,
            provider: resource.provider,
            environmentId: undefined,
            environmentInherited: false,
            health: resource.health,
            rollupHealth: resource.health ?? 'unknown',
            descendantCount: 0,
            unhealthyCount: 0,
            children: [],
          }),
        );
      }
      continue;
    }
    byProvider.set(node.provider, [...(byProvider.get(node.provider) ?? []), node]);
  }

  const roots = [...byProvider.entries()]
    .map(([provider, children]) =>
      finalize({
        id: `provider:${provider}`,
        ref: null,
        name: PROVIDER_NAMES[provider] ?? provider,
        type: 'provider',
        provider,
        environmentId: undefined,
        environmentInherited: false,
        health: undefined,
        rollupHealth: 'healthy',
        descendantCount: 0,
        unhealthyCount: 0,
        children,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return { roots, independent: independent.sort((a, b) => a.name.localeCompare(b.name)) };
}
