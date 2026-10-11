# Persistence and Data Storage (ArcadeDB only)

**Decision status:** Selected for this specification, pending prototype validation. ArcadeDB is the sole authoritative database for registry records and graph traversal; there is no second canonical store or derived graph projection.

## Data model
The stored model maps 1:1 to the canonical domain (`DOMAIN_MODEL.md`, `TopologyData` v1). Every record keeps its application `id` as an indexed, unique property; ArcadeDB record IDs never leave the adapter.

### Vertex and document types

| Domain entity | ArcadeDB type | Notes |
|---|---|---|
| Environment | vertex `Environment` | `id`, `name`, `kind` |
| ServiceDefinition | vertex `ServiceDefinition` | typed common fields; `protocols` as a list |
| ServiceInstance | vertex `ServiceInstance` | `environmentId` stored as a property (indexed) and as an edge |
| InfrastructureResource | vertex `Resource` | `type` property from the `ResourceType` enum; one vertex type for all resource types, so traversal never depends on dynamic type names |
| EventType | vertex `EventType` | ADR-014 |
| TopologySnapshot | document `Snapshot` | immutable; `data` stored as a bounded JSON payload validated before insert |
| SavedLayout | document `SavedLayout` | presentation only |
| TelemetryObservation, TopologyEvent (B5) | documents | append-oriented, with retention |

Common queryable fields are typed properties (`id`, `name`, `type`/`category`, `provider`, `environmentId` where set, `health`, `updatedAt`, `owner`, `team`). `metrics` is a nested map with `isSimulated` required; `metadata` is a bounded, validated map. Backend-only fields (`provenance`, `sourceType`, `sourceExternalId`, `recordedAt`, `schemaVersion`) are properties never returned unless added to the contract. Verify how nested maps are stored and queried by the selected ArcadeDB API before relying on them.

### Edge types
One edge type per canonical concept, so every traversal and the propagation rules follow a single edge set (the reasoning of ADR-008 for RabbitMQ bindings):

| Edge | From → To | Source of truth |
|---|---|---|
| `COMMUNICATES` | source entity → target entity | one edge per `CommunicationRelationship`, carrying its `id`, `protocol`, `pattern`, `direction`, `status`, `authenticationType`, `endpoint`, `metrics`, `metadata`, `updatedAt` |
| `CONTAINS` | parent `Resource` → child `Resource` | `parentResourceId` |
| `HOSTED_IN` | `ServiceInstance` → `Resource` | instance `resourceId` |
| `INSTANCE_OF` | `ServiceInstance` → `ServiceDefinition` | `serviceDefinitionId` |
| `IN_ENVIRONMENT` | `ServiceInstance`/`Resource` → `Environment` | explicit `environmentId` only (inherited environments are computed, not stored) |
| `CARRIED_ON`, `PRODUCED_BY`, `CONSUMED_BY` | `EventType` → channel `Resource` / `ServiceDefinition` | event type fields |

Semantic names such as "publishes", "consumes", "routes to", or "calls" are **derived** from `pattern`, `protocol`, and endpoint types when presenting data; they are not separate stored edge types. A relationship is never stored twice (native edge plus document). The reference properties (`parentResourceId`, `resourceId`, `serviceDefinitionId`, `environmentId`) are also kept on the vertices so the canonical payload can be returned without traversal, and the adapter writes property and edge in one transaction; integration tests assert they agree.

### Other domain data
- Environments may be document records or vertices connected to resources; choose one consistent pattern.
- Topology events and telemetry observations should be append-oriented records with retention/aggregation rules; avoid unbounded arrays on resource vertices.
- Snapshots need explicit size and retention limits. Consider immutable snapshot documents and links to resources, or bounded serialized snapshot payloads.
- Saved views need stable IDs, owner/workspace scope, filters, and layout/camera state separate from resource identity.
- Simulation runs and simulated edges/events must be explicitly marked simulated and never presented as observed telemetry.

## Implementation notes (Milestone B2, ADR-DB-002)
- Implemented: all vertex and edge types above except telemetry/event documents; `Snapshot`/`SavedLayout` documents arrive with their endpoints (B3/B5).
- Unique `id` indexes on every vertex type, `COMMUNICATES`, and `SchemaInfo`; non-unique indexes on `ServiceInstance.environmentId`, `Resource.type`, `Resource.parentResourceId`.
- Backend-only properties: `ord`, `recordedAt`, `sourceType`.
- Imports replace the topology in one transaction; reads preserve collection order via `ord`.

## Schema, constraints, and indexes
Create repeatable, versioned schema initialization. At minimum, enforce uniqueness for resource IDs and other independently identified records where supported; add indexes for `environmentId`, `kind`, `name`, `sourceExternalId`, status/health, and timestamps only where query patterns justify them. Validate exact index/constraint syntax and uniqueness behavior for the selected ArcadeDB version in integration tests. Initializers must be idempotent and must not delete user data. Use additive migrations where possible and document breaking changes.

## Transaction and write flow
1. Parse and validate commands at the HTTP boundary.
2. Apply domain invariants in Go.
3. Execute related graph/document writes in an explicit ArcadeDB transaction through the chosen API/client.
4. Use stable IDs and the database's supported upsert/unique semantics deliberately; test concurrent duplicate writes.
5. Commit before returning success. Retry only classified transient errors and only when operation semantics are safe to retry.
6. Use bounded batches and deterministic stable IDs for seed/import so repeated runs are safe.

There is no cross-database outbox or graph-projection rebuild process. Provide a documented local reset/reseed process and production backup/restore runbook. External event delivery, if added later, needs its own durable delivery design and must not be confused with database projection synchronization.

## Query routing and API behavior
All resource registry, detail, topology, relationship, path, impact, snapshot, and saved-view operations use ArcadeDB through repository/query interfaces. Use indexed lookups for registry entry points, then bounded graph traversals for graph operations.

Required query classes, each matching a client function so results can be compared: direct and transitive upstream/downstream (`reachFrom`, `dependencyTree` in `apps/web/src/domain/traversal.ts`); undirected neighborhoods with depth 1–3 (`neighborhood`); failure impact per the propagation rules (`analyzeImpact` in `apps/web/src/domain/propagation.ts`); containment forests with roll-ups (`containmentForest`); event flows (`resolveEventFlow`); and filtered topology subgraphs by environment (including inherited and environment-independent resources), provider, health, and entity group.

Choose one primary query language for the application and standardize it in the adapter. ArcadeDB supports multiple query languages, including SQL and Cypher, but syntax, supported features, parameter binding, and behavior can differ. The initial implementation should use the language demonstrated by the selected client/API, and integration-test each query. Parameterize values; validate dynamic type names against a server-side allowlist. Enforce depth, result-count, timeout, and authorization limits. If ArcadeDB is unavailable, return a clear dependency error rather than a silently incomplete graph. Check response truncation indicators if using the HTTP driver/API.

## Example stored resource (adapter view, illustrative)
The API returns the canonical JSON from `docs/schemas/topology.v1.schema.json`. Internally a `Resource` vertex for the fixture topic looks like:

```json
{
  "id": "topic-orders-events-prod",
  "name": "orders.events",
  "type": "topic",
  "provider": "gcp",
  "parentResourceId": "kafka-events-prod",
  "health": "healthy",
  "owner": "Commerce",
  "team": "Orders",
  "updatedAt": "2026-10-11T08:00:00Z",
  "metrics": { "latencyMs": 12, "throughputPerSecond": 140, "errorRatePercent": 0, "isSimulated": true, "observedAt": "2026-10-11T08:45:00Z" },
  "metadata": { "partitions": 6, "retention": "7d" },
  "provenance": "mock",
  "sourceType": "fixture",
  "sourceExternalId": "topic-orders-events-prod",
  "schemaVersion": 1,
  "recordedAt": "2026-10-11T08:00:00Z"
}
```

`provenance`, `sourceType`, `sourceExternalId`, `schemaVersion`, and `recordedAt` are backend-only. Normalize provenance and schema versions in the application layer; reject unsupported metadata instead of silently dropping it.

## Operations and recovery
- Back up ArcadeDB using the selected deployment's supported backup procedure and regularly test restore. Persist the database directory in Docker/Kubernetes.
- Monitor availability, HTTP/client errors, transaction failures, query latency, timeouts, memory, disk, and connection behavior.
- Use supported explain/profile tools and representative data to tune queries and indexes.
- Keep telemetry/event retention bounded; never store the entire graph as one document or unbounded payload.
- Include local seed/reset workflow and production recovery runbook.
- Reassess the single-database decision only through an ADR backed by measured limitations or concrete operational requirements.
