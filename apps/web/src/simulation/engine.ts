import { analyzeImpact, worseHealth, type FailureMode, type Impact, type PropagationRuleId } from '../domain/propagation';
import { diffTopology } from '../domain/snapshot';
import { buildTopologyIndex, type TopologyIndex } from '../domain/topologyIndex';
import type {
  CommunicationRelationship,
  EntityId,
  HealthStatus,
  Metrics,
  RelationshipStatus,
  TopologyData,
} from '../domain/types';

/**
 * Deterministic topology simulation (ARCHITECTURE §10). Pure functions over an immutable state:
 * no timers, no React, no renderer types. The same baseline, seed, and action sequence always
 * produce the same state. Everything it generates is simulated and labeled so.
 */

export const TICK_SECONDS = 10;
export const MAX_EVENTS = 500;
/** Latency drift factor above which an anomaly event is emitted (and below which it clears). */
const ANOMALY_ON = 1.35;
const ANOMALY_OFF = 1.2;

export type SimulationEventType =
  | 'failure-injected'
  | 'recovered'
  | 'health-changed'
  | 'status-changed'
  | 'latency-anomaly'
  | 'latency-normal';

export interface SimulationEvent {
  /** Stable, sequential: `sim-<n>`. */
  id: string;
  tick: number;
  /** Simulated clock time (ISO 8601), not wall-clock time. */
  at: string;
  type: SimulationEventType;
  entityKind: 'service-instance' | 'resource' | 'relationship';
  entityId: EntityId;
  from?: string;
  to?: string;
  /** For propagated changes: which rule, from which failure, over which relationship. */
  cause?: { ruleId: PropagationRuleId; rootId: EntityId; causeId: EntityId; viaRelationshipId?: EntityId };
  note?: string;
  isSimulated: true;
}

export interface ActiveFailure {
  entityId: EntityId;
  mode: FailureMode;
  injectedTick: number;
  /** Recover automatically at this tick (scheduled recovery). */
  recoverAtTick?: number;
}

export interface SimulationState {
  /** The loaded data. Never mutated; recovery returns to it exactly. */
  baseline: TopologyData;
  /** Baseline + failures + propagated impacts + metric drift. What every view renders. */
  data: TopologyData;
  seed: number;
  tick: number;
  clock: string;
  rng: number;
  /** Per-entity metric drift factor (random walk around 1). */
  drift: Readonly<Record<EntityId, number>>;
  anomalies: readonly EntityId[];
  failures: readonly ActiveFailure[];
  impacts: readonly Impact[];
  events: readonly SimulationEvent[];
  eventSeq: number;
}

// --- deterministic PRNG (mulberry32, functional) -----------------------------------------------
function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

const baselineIndexCache = new WeakMap<TopologyData, TopologyIndex>();
function baselineIndex(baseline: TopologyData): TopologyIndex {
  let index = baselineIndexCache.get(baseline);
  if (!index) {
    index = buildTopologyIndex(baseline);
    baselineIndexCache.set(baseline, index);
  }
  return index;
}

function latestTimestamp(data: TopologyData): string {
  const times = [
    ...data.serviceInstances.flatMap((i) => [i.updatedAt, i.metrics?.observedAt]),
    ...data.resources.flatMap((r) => [r.updatedAt, r.metrics?.observedAt]),
    ...data.relationships.flatMap((r) => [r.updatedAt, r.metrics?.observedAt]),
  ].filter((t): t is string => typeof t === 'string' && !Number.isNaN(Date.parse(t)));
  return times.sort().at(-1) ?? '2026-01-01T00:00:00.000Z';
}

const addSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

const STATUS_RANK: Record<RelationshipStatus, number> = { active: 0, unknown: 1, degraded: 2, inactive: 3 };
const worseStatus = (a: RelationshipStatus, b: RelationshipStatus) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a);

function scaleMetrics(m: Metrics | undefined, factor: number, clock: string, overlay: 'none' | 'degraded' | 'down'): Metrics | undefined {
  if (!m) return undefined;
  // Observed metrics (a topology source, ADR-034) stay observed: no drift, no relabelling. Only a
  // simulated failure that changes the entity replaces them, with simulated values.
  if (!m.isSimulated && overlay === 'none') return m;
  const round = (v: number) => Math.round(v * 10) / 10;
  const latency = m.latencyMs === undefined ? undefined : round(m.latencyMs * factor * (overlay === 'degraded' ? 3 : 1));
  const throughput =
    m.throughputPerSecond === undefined ? undefined : overlay === 'down' ? 0 : round(m.throughputPerSecond * (2 - factor));
  const errors =
    m.errorRatePercent === undefined
      ? undefined
      : overlay === 'down'
        ? 100
        : Math.min(100, round(m.errorRatePercent + (overlay === 'degraded' ? 5 : 0)));
  return {
    ...(latency !== undefined ? { latencyMs: latency } : {}),
    ...(throughput !== undefined ? { throughputPerSecond: throughput } : {}),
    ...(errors !== undefined ? { errorRatePercent: errors } : {}),
    isSimulated: true,
    observedAt: clock,
  };
}

/** Recompute the rendered data from baseline + failures + drift. */
function derive(
  baseline: TopologyData,
  failures: readonly ActiveFailure[],
  drift: Readonly<Record<EntityId, number>>,
  clock: string,
): { data: TopologyData; impacts: Impact[] } {
  const index = baselineIndex(baseline);
  const roots = failures.map((f) => ({ entityId: f.entityId, mode: f.mode }));
  const impacts = analyzeImpact(index, roots);
  const override = new Map<EntityId, HealthStatus>();
  for (const f of failures) override.set(f.entityId, worseHealth(override.get(f.entityId) ?? 'healthy', f.mode));
  for (const i of impacts) override.set(i.entityId, worseHealth(override.get(i.entityId) ?? 'healthy', i.effect));

  const healthOf = (id: EntityId, base: HealthStatus) => worseHealth(base, override.get(id) ?? 'healthy');
  const overlayFor = (base: HealthStatus, now: HealthStatus): 'none' | 'degraded' | 'down' =>
    now === base ? 'none' : now === 'unavailable' ? 'down' : 'degraded';

  const finalHealth = new Map<EntityId, HealthStatus>();
  const serviceInstances = baseline.serviceInstances.map((instance) => {
    const health = healthOf(instance.id, instance.health);
    finalHealth.set(instance.id, health);
    const changed = health !== instance.health;
    const metrics = scaleMetrics(instance.metrics, drift[instance.id] ?? 1, clock, overlayFor(instance.health, health));
    return {
      ...instance,
      health,
      ...(metrics ? { metrics } : {}),
      ...(changed ? { updatedAt: clock } : {}),
    };
  });
  const resources = baseline.resources.map((resource) => {
    const base = resource.health ?? 'unknown';
    const overridden = override.get(resource.id);
    const health = overridden ? worseHealth(base, overridden) : resource.health;
    if (health) finalHealth.set(resource.id, health);
    const changed = health !== resource.health;
    const metrics = scaleMetrics(resource.metrics, drift[resource.id] ?? 1, clock, health && changed ? overlayFor(base, health) : 'none');
    return {
      ...resource,
      ...(health ? { health } : {}),
      ...(metrics ? { metrics } : {}),
      ...(changed ? { updatedAt: clock } : {}),
    };
  });

  const relationships = baseline.relationships.map((r): CommunicationRelationship => {
    const source = finalHealth.get(r.sourceEntityId);
    const target = finalHealth.get(r.targetEntityId);
    let status = r.status;
    // Only simulated changes affect status: compare against each endpoint's baseline health.
    const targetChanged = target !== undefined && override.has(r.targetEntityId);
    const sourceChanged = source !== undefined && override.has(r.sourceEntityId);
    if (sourceChanged && source === 'unavailable') status = worseStatus(status, 'inactive');
    else if (targetChanged && (target === 'unavailable' || target === 'degraded')) status = worseStatus(status, 'degraded');
    const changed = status !== r.status;
    const metrics = scaleMetrics(
      r.metrics,
      drift[r.id] ?? 1,
      clock,
      !changed ? 'none' : status === 'inactive' ? 'down' : 'degraded',
    );
    return { ...r, status, ...(metrics ? { metrics } : {}), ...(changed ? { updatedAt: clock } : {}) };
  });

  return {
    data: { ...baseline, serviceInstances, resources, relationships },
    impacts,
  };
}

/** Events for every health/status change between two derived states, attributed to causes. */
function changeEvents(
  before: TopologyData,
  after: TopologyData,
  impacts: readonly Impact[],
  failures: readonly ActiveFailure[],
  tick: number,
  at: string,
  startSeq: number,
  rootEvent?: Omit<SimulationEvent, 'id' | 'tick' | 'at' | 'isSimulated'>,
): SimulationEvent[] {
  const events: Omit<SimulationEvent, 'id'>[] = [];
  if (rootEvent) events.push({ ...rootEvent, tick, at, isSimulated: true });
  const impactById = new Map(impacts.map((i) => [i.entityId, i]));
  const rootIds = new Set(failures.map((f) => f.entityId));
  for (const change of diffTopology(before, after)) {
    if (change.type === 'health-changed') {
      if (rootEvent && change.id === rootEvent.entityId) continue; // already described by the root event
      const impact = impactById.get(change.id);
      events.push({
        tick,
        at,
        type: 'health-changed',
        entityKind: change.kind,
        entityId: change.id,
        from: change.from,
        to: change.to,
        ...(impact && !rootIds.has(change.id)
          ? {
              cause: {
                ruleId: impact.ruleId,
                rootId: impact.rootId,
                causeId: impact.causeId,
                ...(impact.viaRelationshipId ? { viaRelationshipId: impact.viaRelationshipId } : {}),
              },
            }
          : { note: 'Returned to its recorded state' }),
        isSimulated: true,
      });
    } else if (change.type === 'status-changed') {
      events.push({ tick, at, type: 'status-changed', entityKind: 'relationship', entityId: change.id, from: change.from, to: change.to, isSimulated: true });
    }
  }
  return events.map((e, i) => ({ ...e, id: `sim-${startSeq + i}` }));
}

function appendEvents(state: SimulationState, events: SimulationEvent[]): Pick<SimulationState, 'events' | 'eventSeq'> {
  const all = [...state.events, ...events];
  return { events: all.slice(Math.max(0, all.length - MAX_EVENTS)), eventSeq: state.eventSeq + events.length };
}

export interface CreateOptions {
  seed?: number;
  /** Simulated start time; defaults to the latest timestamp in the data. */
  startAt?: string;
}

export function createSimulation(baseline: TopologyData, options: CreateOptions = {}): SimulationState {
  const seed = options.seed ?? 1;
  const clock = options.startAt ?? latestTimestamp(baseline);
  const { data, impacts } = derive(baseline, [], {}, clock);
  return { baseline, data, seed, tick: 0, clock, rng: seed >>> 0, drift: {}, anomalies: [], failures: [], impacts, events: [], eventSeq: 1 };
}

function withFailures(state: SimulationState, failures: readonly ActiveFailure[], rootEvent: Omit<SimulationEvent, 'id' | 'tick' | 'at' | 'isSimulated'>): SimulationState {
  const { data, impacts } = derive(state.baseline, failures, state.drift, state.clock);
  const events = changeEvents(state.data, data, impacts, failures, state.tick, state.clock, state.eventSeq, rootEvent);
  return { ...state, data, impacts, failures, ...appendEvents(state, events) };
}

/** Simulate a failure of an instance or resource. Replaces any existing failure of the same entity. */
export function injectFailure(
  state: SimulationState,
  entityId: EntityId,
  mode: FailureMode,
  options: { durationTicks?: number } = {},
): SimulationState {
  const index = baselineIndex(state.baseline);
  const instance = index.instances.get(entityId);
  const resource = index.resources.get(entityId);
  if (!instance && !resource) throw new Error(`Cannot fail unknown entity "${entityId}"`);
  const failure: ActiveFailure = {
    entityId,
    mode,
    injectedTick: state.tick,
    ...(options.durationTicks !== undefined ? { recoverAtTick: state.tick + Math.max(1, options.durationTicks) } : {}),
  };
  const before = state.data.serviceInstances.find((i) => i.id === entityId)?.health ?? state.data.resources.find((r) => r.id === entityId)?.health ?? 'unknown';
  return withFailures(state, [...state.failures.filter((f) => f.entityId !== entityId), failure], {
    type: 'failure-injected',
    entityKind: instance ? 'service-instance' : 'resource',
    entityId,
    from: before,
    to: worseHealth(before, mode),
    note: options.durationTicks !== undefined ? `Recovers automatically after ${options.durationTicks * TICK_SECONDS} s (simulated)` : `Simulated ${mode} failure`,
  });
}

export function recover(state: SimulationState, entityId: EntityId, note = 'Recovered (simulated)'): SimulationState {
  if (!state.failures.some((f) => f.entityId === entityId)) return state;
  const index = baselineIndex(state.baseline);
  const before = state.data.serviceInstances.find((i) => i.id === entityId)?.health ?? state.data.resources.find((r) => r.id === entityId)?.health ?? 'unknown';
  const after = index.instances.get(entityId)?.health ?? index.resources.get(entityId)?.health ?? 'unknown';
  return withFailures(
    state,
    state.failures.filter((f) => f.entityId !== entityId),
    { type: 'recovered', entityKind: index.instances.has(entityId) ? 'service-instance' : 'resource', entityId, from: before, to: after, note },
  );
}

export function recoverAll(state: SimulationState): SimulationState {
  return state.failures.reduce((s, f) => recover(s, f.entityId), state);
}

/**
 * Advance the simulated clock: scheduled recoveries, then metric drift (random walk per entity
 * with simulated metrics) and latency-anomaly events. Health only changes through failures/recoveries.
 */
export function step(state: SimulationState, ticks = 1): SimulationState {
  let current = state;
  for (let n = 0; n < ticks; n++) {
    const tick = current.tick + 1;
    const clock = addSeconds(current.clock, TICK_SECONDS);
    current = { ...current, tick, clock };

    for (const failure of current.failures.filter((f) => f.recoverAtTick !== undefined && f.recoverAtTick <= tick)) {
      current = recover(current, failure.entityId, 'Recovered automatically (scheduled, simulated)');
    }

    let rng = current.rng;
    const drift: Record<EntityId, number> = { ...current.drift };
    // Only simulated metrics drift; observed ones are what the source measured.
    const ids = [
      ...current.baseline.serviceInstances.filter((i) => i.metrics?.isSimulated).map((i) => i.id),
      ...current.baseline.resources.filter((r) => r.metrics?.isSimulated).map((r) => r.id),
      ...current.baseline.relationships.filter((r) => r.metrics?.isSimulated).map((r) => r.id),
    ].sort();
    for (const id of ids) {
      const [r, next] = nextRandom(rng);
      rng = next;
      const value = (drift[id] ?? 1) * (1 + (r - 0.5) * 0.16);
      drift[id] = Math.round(Math.min(1.6, Math.max(0.7, value)) * 1000) / 1000;
    }

    const { data, impacts } = derive(current.baseline, current.failures, drift, clock);
    const instanceIds = new Set(current.baseline.serviceInstances.map((i) => i.id));
    const anomalies = new Set(current.anomalies);
    const anomalyEvents: Omit<SimulationEvent, 'id'>[] = [];
    for (const id of ids.filter((x) => instanceIds.has(x))) {
      const factor = drift[id] ?? 1;
      if (!anomalies.has(id) && factor >= ANOMALY_ON) {
        anomalies.add(id);
        anomalyEvents.push({ tick, at: clock, type: 'latency-anomaly', entityKind: 'service-instance', entityId: id, note: `Simulated latency ×${factor.toFixed(2)} of recorded value`, isSimulated: true });
      } else if (anomalies.has(id) && factor <= ANOMALY_OFF) {
        anomalies.delete(id);
        anomalyEvents.push({ tick, at: clock, type: 'latency-normal', entityKind: 'service-instance', entityId: id, note: 'Simulated latency back near recorded value', isSimulated: true });
      }
    }
    const events = anomalyEvents.map((e, i) => ({ ...e, id: `sim-${current.eventSeq + i}` }));
    current = { ...current, rng, drift, data, impacts, anomalies: [...anomalies].sort(), ...appendEvents(current, events) };
  }
  return current;
}

/**
 * Continue the run on a fresh baseline (observed health and metrics refreshed, ADR-034): failures
 * on entities that still exist, the clock, drift, and events are kept. Frontend-only (the Go port
 * runs scripted, bounded runs and has no refresh).
 */
export function rebase(state: SimulationState, baseline: TopologyData): SimulationState {
  const ids = new Set<EntityId>([...baseline.serviceInstances.map((i) => i.id), ...baseline.resources.map((r) => r.id)]);
  const failures = state.failures.filter((f) => ids.has(f.entityId));
  const { data, impacts } = derive(baseline, failures, state.drift, state.clock);
  return { ...state, baseline, failures, data, impacts };
}

/** Reset to the baseline at the original start time, keeping the seed. */
export function reset(state: SimulationState, startAt?: string): SimulationState {
  return createSimulation(state.baseline, { seed: state.seed, ...(startAt ? { startAt } : {}) });
}
