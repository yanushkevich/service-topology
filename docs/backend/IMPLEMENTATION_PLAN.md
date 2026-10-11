# Go Backend Implementation Plan (ArcadeDB)

**Status:** Proposed plan; not started. Execute one milestone at a time; do not automatically start the next. Backend milestones are B1–B6, a separate track from frontend Milestones 1–7. Code lives in `backend/`. Commit each milestone with scope `b1`…`b6`. Track status in the root `docs/IMPLEMENTATION_PLAN.md`.

## Milestone B1 — Go service foundation and domain
Scope: `backend/` Go module (scaffold files moved in from `docs/backend/scaffold/`), configuration validation, HTTP lifecycle, health/readiness skeleton, structured logging, domain types and the full `validateTopology` rule set, repository/query interfaces, shared fixture export (`fixtures/`, from the frontend mock via a script) and the conformance fixture format.
Acceptance: `go test ./...`, `go vet ./...`; liveness/readiness tests; no HTTP/database dependencies in the domain package; Go validation returns the same codes as `validateTopology` on every conformance fixture; root `npm run check` still passes.

## Milestone B2 — ArcadeDB persistence foundation and seed data
Scope: ArcadeDB HTTP API client lifecycle, connection/session handling, schema constraints/index initialization, resource and relationship repositories, environment representation, deterministic idempotent seed command, property/metadata mapping and schema versioning.
Acceptance: fresh local database initializes; seed from the shared mock fixture reruns safely; a stored-then-read topology equals the fixture exactly; uniqueness and endpoint invariants enforced; repository integration tests run against ArcadeDB.

## Milestone B3 — REST registry and topology API
Scope: the contract v1 endpoints in `docs/api/openapi.json` (environments, topology incl. event types, registry search, entities, snapshots, layouts), RFC 9457 problems, cursor pagination.
Acceptance: responses validate against `openapi.json`; registry search equals the client's `filterRegistryRows`/`sortRegistryRows` on the shared fixtures; pagination/filter tests; clear errors.

## Milestone B4 — Graph traversal and dependency intelligence
Scope: the proposed traversal endpoints (`API_SPEC.md`) added to `openapi.json` first; parameterized ArcadeDB queries using the selected primary query language for upstream/downstream dependencies, bounded neighborhoods, event flows, and impact per the propagation rules; query time/result limits; explain/profile benchmark fixtures and query metrics.
Acceptance: results equal the TypeScript functions on the shared fixtures; traversal tests cover cycles, disconnected resources, depth limits, environment boundaries and authorization; query plans reviewed; latency measured on representative datasets; no unbounded traversal endpoint.

## Milestone B5 — Provenance, simulation, events and snapshots
Scope: simulated vs observed distinction, telemetry/event persistence, snapshot creation/comparison, bounded simulation runs, retention settings.
Acceptance: no simulated event is presented as observed; snapshot and simulation tests; retention policy documented; oversized payloads rejected or bounded.

## Milestone B6 — Security, hardening and frontend integration
Scope: auth decision, authorization boundaries, request limits, rate limits where needed, secrets handling, observability, backup/restore exercises, integration tests, performance tests and docs. Frontend integration: HTTP implementations of `TopologyRepository`, `SnapshotRepository`, and `SavedLayoutRepository` selected in `apps/web/src/data/selectRepository.ts`, with the UI labeling the source accurately (`isMock: false` only for real data).
Acceptance: security tests, full integration suite, measured performance against targets, and runbook for local reset, backup/restore and recovery.

## Future milestone — provider integrations
Cloud, Kubernetes, Kafka and other adapters are out of initial milestones. Introduce them only behind normalized source adapters and provenance rules.

## Delivery rules
- Implement only the current milestone unless explicitly instructed otherwise.
- Do not invent provider data or represent illustrative traffic as observed telemetry.
- ArcadeDB is the sole database in the initial architecture; do not introduce MongoDB, ArangoDB, or a second persistence engine without a new architecture decision record.
- Use parameterized queries and an allowlist for dynamic labels/relationship types.
- Record architecture changes as ADRs and update OpenAPI/domain docs with behavior changes.
