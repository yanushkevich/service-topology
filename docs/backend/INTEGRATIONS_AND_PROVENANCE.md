# Data Sources, Mock Mode, and Provenance

**Status:** Required product constraint plus proposed backend extension pattern.

## Phase 1: deterministic seed/mock source
- Seed from the same mock topology as the frontend (`apps/web/src/data/mock/topology.ts`: 15+ connected entities across AWS, Azure, GCP, on-prem, and SaaS, three environments, Kafka and RabbitMQ, event types), exported to shared JSON fixtures validated by `docs/schemas/topology.v1.schema.json`. The generated scale datasets (`scale-250`, `inventory-1000`) are exported the same way for benchmarks.
- Seed IDs are the fixture IDs, stable across restarts, tests, and the frontend.
- Seed data is reproducible; avoid random values in tests. Any optional demo variation must use a fixed seed and be visibly marked simulated.
- API responses identify dataset/source and provenance. UI labels simulated events/metrics clearly.
- Never describe seeded mock data as observed/live production state.

## Future adapter boundary
A future integration adapter should:
1. Fetch source-specific inventory using least-privilege credentials.
2. Convert source records into canonical domain entities in an anti-corruption mapping layer.
3. Preserve source ID, source type, observation timestamp, ingestion timestamp, and source freshness/error state.
4. Upsert idempotently using stable source identity mapping.
5. Report partial failures without silently deleting records from a failed sync.
6. Record sync status, counts, timestamps and sanitized errors.
7. Avoid letting cloud SDK types leak into domain/application layers.

Potential future sources named in product docs include AWS, Azure, GCP, Kubernetes, Kafka, databases, APIs, SaaS and on-premises systems. Their actual implementation is explicitly out of scope until requested.

## Provenance model
Store `mock`, `simulated`, `observed`, and `imported` provenance values; the API exposes them as `metrics.isSimulated` (true unless observed) and snapshot `source` (`fixture | simulation | observed`). clarify whether imported inventory is observed or imported based on source semantics. Telemetry records should also include source identifier and timestamps. Provenance must survive persistence, aggregation, snapshotting, API serialization and frontend rendering.

## Simulation semantics
- Keep simulation application service separate from HTTP handlers and persistence adapters.
- Deterministic rules define which relationship patterns propagate failures and why.
- Every generated event/metric has `provenance=simulated` and timestamps.
- Support traffic/latency changes and health transitions including fail/recover.
- Tests use a fixed clock/seed and assert exact state/event changes.
- Today the simulation engine (`apps/web/src/simulation/engine.ts`, ADR-010) runs in the browser, and propagation rules live in `apps/web/src/domain/propagation.ts`. A server-side simulation must reuse the same rule IDs and semantics, verified by shared fixtures.
- Decide whether simulation is ephemeral per session, persisted globally, or isolated per user/workspace before concurrent multi-user use. Do not implement global shared mutation accidentally.


## Implementation (B5)
- Stored simulation events and telemetry always carry `provenance: simulated` and `isSimulated: true`; the API exposes provenance on every record (`StoredEvent`, `TelemetryObservation`, `SimulationRun`). Tests assert it end to end (memory and MongoDB).
- Imported fixtures are recorded with `sourceType: fixture`; their metrics keep `isSimulated: true`.
- There is no endpoint that ingests observed telemetry; adding one is a future, ADR-backed change.

## Persistence provenance
MongoDB stores canonical resource and relationship records. Source identity, observation/ingestion timestamps, sync status and provenance are domain data, not projection metadata. Do not mark inventory as observed merely because it has been persisted.
