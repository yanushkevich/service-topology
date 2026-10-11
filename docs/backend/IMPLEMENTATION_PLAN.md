# Go Backend Implementation Plan (ArcadeDB)

**Status:** Proposed plan. Execute one milestone at a time; do not automatically start the next.

## Milestone B1 — Go service foundation and domain
Scope: Go module, configuration validation, HTTP lifecycle, health/readiness skeleton, structured logging, domain types/validation, repository/query interfaces and seed fixture contract.
Acceptance: `go test ./...`, `go vet ./...`; liveness/readiness tests; no HTTP/database dependencies in domain package; domain invariants covered.

## Milestone B2 — ArcadeDB persistence foundation and seed data
Scope: ArcadeDB HTTP API client lifecycle, connection/session handling, schema constraints/index initialization, resource and relationship repositories, environment representation, deterministic idempotent seed command, property/metadata mapping and schema versioning.
Acceptance: fresh local database initializes; seed reruns safely; uniqueness and relationship endpoint invariants validated; 15+ connected sample entities; repository integration tests run against ArcadeDB.

## Milestone B3 — REST registry and topology API
Scope: registry list/detail/search, filters, topology query DTOs, bounded neighbor queries, pagination, saved-view CRUD, OpenAPI contract and frontend fixture parity.
Acceptance: contract tests, pagination/filter tests, stable resource IDs, clear error behavior and consistent 2D/3D data envelope.

## Milestone B4 — Graph traversal and dependency intelligence
Scope: parameterized ArcadeDB queries using the selected primary query language for upstream/downstream dependencies, bounded neighborhood exploration, paths and blast-radius analysis; query time/result limits; explain/profile benchmark fixtures and query metrics.
Acceptance: traversal tests cover cycles, disconnected resources, depth limits, environment boundaries and authorization; query plans reviewed; latency measured on representative datasets; no unbounded traversal endpoint.

## Milestone B5 — Provenance, simulation, events and snapshots
Scope: simulated vs observed distinction, telemetry/event persistence, snapshot creation/comparison, bounded simulation runs, retention settings.
Acceptance: no simulated event is presented as observed; snapshot and simulation tests; retention policy documented; oversized payloads rejected or bounded.

## Milestone B6 — Security, hardening and frontend integration
Scope: auth decision, authorization boundaries, request limits, rate limits where needed, secrets handling, observability, backup/restore exercises, integration tests, performance tests and docs.
Acceptance: security tests, full integration suite, measured performance against targets, and runbook for local reset, backup/restore and recovery.

## Future milestone — provider integrations
Cloud, Kubernetes, Kafka and other adapters are out of initial milestones. Introduce them only behind normalized source adapters and provenance rules.

## Delivery rules
- Implement only the current milestone unless explicitly instructed otherwise.
- Do not invent provider data or represent illustrative traffic as observed telemetry.
- ArcadeDB is the sole database in the initial architecture; do not introduce MongoDB, ArangoDB, or a second persistence engine without a new architecture decision record.
- Use parameterized queries and an allowlist for dynamic labels/relationship types.
- Record architecture changes as ADRs and update OpenAPI/domain docs with behavior changes.
