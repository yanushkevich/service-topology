# Persistence and Data Storage (MongoDB only)

**Decision status:** Accepted (root ADR-019, `DATABASE_DECISIONS.md` ADR-DB-004). MongoDB 8.0 is the sole authoritative database for registry records, history, layouts, and simulation runs; there is no second canonical store or derived graph projection. It replaced ArcadeDB (ADR-DB-001–003) on 2026-10-11.

## Data model
The stored model maps 1:1 to the canonical domain (`DOMAIN_MODEL.md`, `TopologyData` v1). Every document's `_id` is the entity's stable application ID, so MongoDB's unique `_id` index enforces ID uniqueness; no database-generated identifier ever leaves the adapter.

### Collections

| Domain entity | Collection | Document |
|---|---|---|
| Environment | `environments` | canonical JSON + `_id` + `_meta` |
| ServiceDefinition | `serviceDefinitions` | canonical JSON + `_id` + `_meta` |
| ServiceInstance | `serviceInstances` | canonical JSON + `_id` + `_meta`; `environmentId` indexed |
| InfrastructureResource | `resources` | canonical JSON + `_id` + `_meta`; `type` and `parentResourceId` indexed. One collection for all resource types, so queries never depend on dynamic names |
| CommunicationRelationship | `relationships` | canonical JSON + `_id` + `_meta` (with `endpoints`); `sourceEntityId`, `targetEntityId`, `_meta.endpoints` indexed |
| EventType | `eventTypes` | canonical JSON + `_id` + `_meta` (ADR-014) |
| Topology revision | `topologyState` | one document `{_id: "topology", revision, recordedAt, sourceType}` |
| Schema version | `schemaInfo` | one document `{_id: "schema", version}` |
| TopologySnapshot | `snapshots` | `{_id, takenAt, summary, payload}`; immutable, validated before insert |
| SavedLayout | `savedLayouts` | `{_id, createdAt, payload}`; presentation only |
| SimulationRun (B5) | `simulationRuns` | `{_id, createdAt, payload}` |
| StoredEvent, TelemetryObservation (B5) | `simulationEvents`, `telemetryObservations` | `{simulationId, seq, <filter fields>, payload}`; unique `(simulationId, seq)`; removed with their run by retention |

`_meta` holds backend-only bookkeeping and is stripped on read: `ord` (position in the canonical collection, so reads keep the original order), `recordedAt`, `sourceType`, and on relationships `endpoints` (`[sourceEntityId, targetEntityId]`, for undirected traversal). Nothing in `_meta` is returned unless it is added to the contract.

### References instead of edges
Containment and references are the canonical fields themselves: `parentResourceId` (containment), `resourceId` (hosting), `serviceDefinitionId`, `environmentId` (explicit only; inherited environments are computed), and an event type's `channelResourceIds`, `producerServiceIds`, `consumerServiceIds`. There are no separate edge collections and nothing is stored twice. `validateTopology` (Go port) guarantees every reference resolves before an import writes anything. Communication is the `relationships` collection, one document per `CommunicationRelationship`. Semantic names such as "publishes" or "consumes" are derived from `pattern`, `protocol`, and endpoint types when presenting data.

### JSON ↔ BSON
Documents are built from the domain values' canonical JSON (the contract's field names), converted value by value: objects become documents, integers int64, other numbers doubles. They are never parsed as Extended JSON, so user data such as a metadata key `$date`, `$where`, or `a.b` is stored and returned literally (MongoDB 5.0+ allows `$`-prefixed and dotted field names in stored documents). Reads decode strictly into the domain types: an unexpected field or BSON type is an error. The shared fixtures round-trip exactly (unit and integration tests).

### Other domain data
- Telemetry and events are append-only records with retention (`SIMULATION_RETENTION`, `SIMULATION_MAX_RUNS`); never unbounded arrays inside entity documents.
- Snapshots are bounded by MongoDB's 16 MB document limit (about 1.2 MB at 1,000 entities) and are not pruned yet (open decision).
- Simulation runs and their records are always `provenance: simulated` and never presented as observed telemetry.

## Schema, constraints, and indexes
`EnsureSchema` (run by the API at start-up, retrying in the background, and by `seed load`) is idempotent and never deletes data:
- creates missing collections;
- sets a `$jsonSchema` validator on canonical collections (`_id` and `id` strings, `_meta` with `ord`, `recordedAt`, `sourceType`), `validationLevel: strict`;
- creates named indexes: `_meta.ord_1` on canonical collections; `sourceEntityId_1`, `targetEntityId_1`, `_meta.endpoints_1` on `relationships`; `environmentId_1`; `type_1`, `parentResourceId_1`; `takenAt_1`; `createdAt_1`; unique `simulationId_1_seq_1` on run records;
- records `schemaInfo.version` (currently 1) and refuses a database with a newer version.

`make schema-check` verifies every collection, validator, index, and the version. Changes are additive; breaking ones need an ADR.

## Transaction and write flow
1. Parse and validate commands at the HTTP boundary.
2. Apply domain invariants in Go (`domain.Validate`, `ValidateSnapshot`, layout normalization).
3. Write related documents in one multi-document transaction (snapshot read concern, majority write concern): topology imports (delete and re-insert the canonical collections, then a new revision), simulation runs (run + events + telemetry), and retention (run + its records). Transactions need a replica set; local development runs a single-node set.
4. The driver retries a transaction on transient errors, so transaction bodies must be safe to repeat (they are: they build their documents beforehand and replace whole sets).
5. Single-document writes (snapshot save, layout create/replace/remove) rely on `_id` uniqueness: duplicates → `ErrConflict`; replace/remove of a missing ID → `ErrNotFound`.

There is no outbox or projection rebuild. Local reset: `make dev-down`, `docker volume rm backend_mongodb_data`, `make dev-up`, `make seed`.

## Query routing and API behavior
Every registry, detail, topology, snapshot, layout, and simulation operation goes through repository interfaces (`backend/internal/ports`). Full-topology reads are cached by revision: each read fetches `topologyState` by `_id`; an unchanged revision returns the cached topology, a changed one (also from another process such as `seed load`) re-reads all canonical collections in one snapshot transaction.

Required query classes, each matching a client function so results can be compared: direct and transitive upstream/downstream (`reachFrom`, `dependencyTree` in `apps/web/src/domain/traversal.ts`); undirected neighborhoods with depth 1–3 (`neighborhood`); failure impact (`analyzeImpact` in `apps/web/src/domain/propagation.ts`); containment forests (`containmentForest`); event flows (`resolveEventFlow`); filtered topology by environment. They run in Go on the cached index (default). With `TRAVERSAL_SOURCE=database`, dependency and neighborhood queries fetch a bounded subgraph with `$graphLookup` (connect fields per direction, `_meta.endpoints` for undirected; at most 5,000 visited entities) and compute the result in Go on it; 918 traversals match the full-graph results (integration test).

Queries are typed driver filters (`bson.D`) with input only as values: no `$where`, JavaScript, aggregation built from input, or query strings; collection and field names are constants. If MongoDB is unavailable, the API returns 503 rather than an incomplete graph.

## Example stored resource (adapter view, illustrative)
The API returns the canonical JSON from `docs/schemas/topology.v1.schema.json`. Internally the fixture topic is stored as:

```json
{
  "_id": "topic-orders-events-prod",
  "id": "topic-orders-events-prod",
  "name": "orders.events",
  "type": "topic",
  "provider": "gcp",
  "parentResourceId": "kafka-events-prod",
  "health": "healthy",
  "metrics": { "latencyMs": 12, "throughputPerSecond": 140, "errorRatePercent": 0, "isSimulated": true },
  "metadata": { "partitions": 6, "retention": "7d" },
  "_meta": { "ord": 17, "recordedAt": "2026-10-11T23:50:00Z", "sourceType": "fixture" }
}
```

## Operations and recovery
- Back up with `make backup` (`mongodump` archive, gzip, owner-only file in `backend/backups/`) and restore into a new database with `make restore` (`mongorestore`, online; verifies schema and per-collection counts). See `RUNBOOK.md`. A single-database dump is not point-in-time across collections under concurrent writes; for production use storage snapshots or a managed service's backups.
- Monitor availability, command errors and latency (`mongodb_commands_total`, `mongodb_command_duration_seconds` on `/metrics`), transaction failures, memory, and disk.
- Use `explain` (printed by `make bench`) with representative data to tune indexes.
- Keep telemetry/event retention bounded; never store the entire graph in one document.
- Reassess the database decision only through an ADR backed by measured limitations or concrete operational requirements.
