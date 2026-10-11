# Go Backend Implementation Plan (ArcadeDB)

**Status:** B1 implemented (closeout below); B2–B6 not started. Execute one milestone at a time; do not automatically start the next. Backend milestones are B1–B6, a separate track from frontend Milestones 1–7. Code lives in `backend/`. Commit each milestone with scope `b1`…`b6`. Track status in the root `docs/IMPLEMENTATION_PLAN.md`.

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

## Milestone B1 closeout (2026-10-11)
Toolchain: Go 1.27.2 (`go.mod` `go 1.27.2`), standard library only (no third-party modules). Evidence, run in `backend/` with `/usr/local/go/bin/go`: `make check` exit 0 (gofmt clean, `go vet ./...`, `go test ./...`); `go test -race -count=1 ./...` passes; manual smoke run of the built `cmd/api` binary: `/healthz` 200, `/readyz` 503 (`database: not configured`), unknown path 404 `application/problem+json` with `requestId`, JSON request logs, clean exit on SIGTERM, exit 2 on invalid `HTTP_ADDR`. Frontend: `npm run check` passes in `apps/web` (fixture drift test included).

| Criterion | Result | Evidence |
|---|---|---|
| `go test ./...`, `go vet ./...` | Pass | `make check` |
| Liveness/readiness tests | Pass | `internal/adapters/httpapi/server_test.go` (incl. bounded readiness), `internal/app/app_test.go` (serve + graceful shutdown) |
| No HTTP/database dependencies in `internal/domain` | Pass | `internal/domain/boundaries_test.go` (standard library only; no `net`, `database`, adapters, config) |
| Go validation returns the same codes as `validateTopology` on every conformance fixture | Pass | `internal/domain/conformance_test.go`: 24 cases, exact order; shown to fail when an expected code is altered |
| Domain types cover `TopologyData` v1 | Pass | mock fixture decodes strictly (unknown fields rejected) and re-encodes to identical JSON |
| Config validation fails fast | Pass | `internal/config/config_test.go` (all problems reported at once, secrets not leaked) |
| Repository/query interfaces | Done | `internal/ports` (topology, snapshots, layouts, readiness), mirroring the frontend repositories |
| Shared fixture export | Done | `fixtures/topology/mock.v1.json`, `fixtures/conformance/validation/*.json` |
| Root `npm run check` still passes | Pass | see evidence |

Known limitations: no database (readiness is always 503); no API routes from `openapi.json` yet (B3); `seed load` and `schema-check` exit with "available in B2"; no third-party linter (staticcheck/golangci-lint) configured; the lifecycle test uses a client without keep-alives because Go's `Shutdown` leaves never-used client connections open for 5 s, longer than the test's 2 s timeout (production default is 10 s).

