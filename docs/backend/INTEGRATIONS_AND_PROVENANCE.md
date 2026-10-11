# Data Sources, Mock Mode, and Provenance

**Status:** Required product constraint plus proposed backend extension pattern.

## Phase 1: deterministic seed/mock source
- Seed at least 15 connected service/resource entities across AWS, Azure, GCP and on-prem examples, with multiple environments, protocols, and health states.
- Seed IDs are stable across restarts and test fixtures.
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
Use at least `simulated`, `observed`, and `imported` provenance values; clarify whether imported inventory is observed or imported based on source semantics. Telemetry records should also include source identifier and timestamps. Provenance must survive persistence, aggregation, snapshotting, API serialization and frontend rendering.

## Simulation semantics
- Keep simulation application service separate from HTTP handlers and persistence adapters.
- Deterministic rules define which relationship patterns propagate failures and why.
- Every generated event/metric has `provenance=simulated` and timestamps.
- Support traffic/latency changes and health transitions including fail/recover.
- Tests use a fixed clock/seed and assert exact state/event changes.
- Decide whether simulation is ephemeral per session, persisted globally, or isolated per user/workspace before concurrent multi-user use. Do not implement global shared mutation accidentally.


## Persistence provenance
ArcadeDB stores canonical resource and relationship records. Source identity, observation/ingestion timestamps, sync status and provenance are domain data, not projection metadata. Do not mark inventory as observed merely because it has been persisted.
