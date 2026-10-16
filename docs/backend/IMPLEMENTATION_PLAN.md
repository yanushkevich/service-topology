# Go Backend Implementation Plan (ArcadeDB)

**Status:** B1–B8 implemented (closeouts below; B7 entity writes, B8 business flows). Open decisions that block production are listed in the B6 closeout. Execute one milestone at a time; do not automatically start the next. Backend milestones are B1–B6, a separate track from frontend Milestones 1–7. Code lives in `backend/`. Commit each milestone with scope `b1`…`b6`. Track status in the root `docs/IMPLEMENTATION_PLAN.md`.

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

## Milestone B8 — Business flows (ADR-022, planned)
Scope:
- the `business-flow` entity kind: Go types and the validation rules of `docs/BUSINESS_FLOWS.md` section 2, with the same codes as the TypeScript validator on the shared fixtures;
- a `businessFlows` MongoDB collection with a `$jsonSchema` validator;
- `businessFlows` in `GET /topology` and the snapshot payload;
- `business-flow` as a writable kind of the entity API (ADR-020), where imported flows are refused (409, `imported-read-only`);
- an importer behind a port, with adapters for the native JSON/YAML flow file and BPMN 2.0 XML. It is idempotent by id, validates the whole topology, and is exposed as `POST /imports/business-flows` (editor role) and `make import-flows FILE=…`;
- OpenAPI and contract-check updates.

Acceptance:
- the parity tests pass;
- an import of each example file round-trips;
- a re-import is a no-op;
- a BPMN file with an unmapped task is rejected with the task named;
- `make check`, `make test-integration`, and `make contract-check` pass.

## Future milestone — provider integrations
Cloud, Kubernetes, Kafka and other adapters are out of initial milestones. Introduce them only behind normalized source adapters and provenance rules.

## Milestone B12 — Dynatrace connector (ADR-034, implemented 2026-10-15)
The first provider integration, for frontend Milestone 15. Spec: `docs/DYNATRACE_CONNECTOR.md`.
- **Adapter:** `internal/adapters/dynatrace`: the Grail query client, constant DQL queries, and the mapping to a discovered topology. A fake tenant serves `fixtures/dynatrace/example-tenant.json`.
- **Application:** a pure reconcile (owned, authored, linked, kept), aliases, held previews, an atomic apply (`ApplyChanges`), and a refresh loop writing the observation overlay.
- **API:** `/integrations/dynatrace` (status, check, preview, apply, aliases).

Acceptance: the criteria in `docs/milestones/MILESTONE_15_DYNATRACE.md`; `make check`, `make test-integration`, and `make contract-check` pass.

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

## Milestone B2 closeout (2026-10-11)
Environment: Rancher Desktop (2 GB VM, k3s enabled), Docker 29.1.3, `arcadedata/arcadedb:26.10.1`, Go 1.27.2. Evidence: `make check` exit 0; `make test-integration` passes (27 tests incl. 6 against ArcadeDB, 3 consecutive runs, ~2–4 s); `go test -race -count=1 ./...` passes; `make seed` twice → identical counts (Environment 3, ServiceDefinition 14, ServiceInstance 21, Resource 41, EventType 9, COMMUNICATES 39, CONTAINS 34, IN_ENVIRONMENT 31; matching the fixture); `make schema-check` passes; `cmd/api` against the database: `/readyz` 200 `{"database":"ok"}` after background schema initialization.

| Criterion | Result | Evidence |
|---|---|---|
| Fresh local database initializes | Pass | `TestFreshDatabaseInitializesIdempotently` (database not found → created; two `EnsureSchema` runs; `CheckSchema` passes) |
| Seed from the shared mock reruns safely | Pass | `TestSeedRoundTripsTheFixtureAndRerunsSafely` (two imports, record counts per type equal the fixture), manual `make seed` ×2 |
| Stored-then-read topology equals the fixture exactly | Pass | same test: JSON deep-equal after each import; result validates |
| Uniqueness and endpoint invariants enforced | Pass | database unique indexes (`TestUniquenessAndRollbackAreEnforcedByTheDatabase`), validation before write (`TestInvalidTopologyIsRejectedBeforeWriting`), exactly-one-edge check, `TestEdgesMatchReferenceProperties` |
| Transactions roll back on failure | Pass | duplicate inside a session aborts it; commit fails; nothing persisted |
| Repository integration tests run against ArcadeDB | Pass | `internal/adapters/arcadedb/integration_test.go` (`-tags=integration`; fails, never skips, without configuration) |
| Errors classified, no secret leakage | Pass | `client_test.go` (fake server: conflict, auth, missing DB, 5xx, truncation, timeout, unreachable), `readiness_test.go` |

Fixed along the way: scaffold healthcheck used `curl` (absent from the image) → `wget`; ArcadeDB memory defaults caused VM-wide OOM kills → explicit budget (see `LOCAL_DEVELOPMENT.md`); a local password was printed during manual probing and was rotated (container user file reset by recreating the empty volume).

Known limitations: environment filtering of `GET /topology` is defined in B3; imports are whole-topology replacements (ADR-DB-002); snapshots and layouts are not persisted yet (B3/B5); no performance measurement yet (B4).

## Milestone B3 closeout (2026-10-11)
Evidence: `make check` exit 0; `make test-integration` passes (incl. snapshot and layout repositories against ArcadeDB); `make contract-check`: 32/32 operations and error cases validate against `docs/api/openapi.json` (status, content type, body; ajv, JSON Schema 2020-12) on a disposable, seeded database that is dropped afterwards; the checker was shown to reject extra fields, null arrays, and unknown enum values. Frontend `npm run check` passes (contract tests include the extended `openapi.json`).

| Criterion | Result | Evidence |
|---|---|---|
| Contract v1 endpoints | Pass | `internal/adapters/httpapi/api.go` (route table) and `routes_*.go`: environments, topology (with environment projection), registry, entities, snapshots (list, get, capture), layouts (list, create, replace, delete) |
| Responses validate against `openapi.json` | Pass | `make contract-check` (`apps/web/scripts/check-api-contract.mjs`) |
| Registry equals the client's filter/sort | Pass | `TestRegistryConformance`: 104 TypeScript-generated cases (mock and a collation-stress topology, all 14 sort orders, 7 filter sets), exact rows and order; CLDR collation via `golang.org/x/text` v0.42.0 |
| Pagination and filter tests | Pass | `TestRegistryPaginationAndParameters`: paged rows equal one page, cursor bound to query, 400s for every bad parameter |
| Clear errors | Pass | RFC 9457 problems for 400/404/405/409/413/415/422/500/503 with `requestId`; database details never returned (`TestDatabaseFailuresAreServiceUnavailable`) |
| Snapshots and layouts persisted | Pass | ArcadeDB schema v2 (additive; upgraded in place from v1), `TestSnapshotAndLayoutRepositories`; seed loads the 3 history fixtures idempotently and refuses to change an existing snapshot |

Contract changes (additive, v1): documented error responses (400/404/409/413/415), environment projection and cursor semantics, `Problem.requestId`, validation code families. Known limitations: every request reads the full topology from ArcadeDB (fine at mock size; measured in B4); registry cursors are offset-based; layout concurrency control is still open.

## Milestone B4 closeout (2026-10-11)
Evidence: `make check` exit 0; `go test -race -count=1 ./...` passes; `make test-integration` passes; `make contract-check` 46/46 (14 new checks for the traversal, impact, rule, and event-type endpoints); `make bench` on 1,000 entities (`docs/BENCHMARKS.md`); frontend `npm run check` passes.

| Criterion | Result | Evidence |
|---|---|---|
| Endpoints added to `openapi.json` first | Pass | `/topology/dependencies`, `/topology/neighborhood`, `/topology/impact`, `/propagation-rules`, `/event-types`, `/event-types/{id}` with schemas; frontend contract tests pass |
| Results equal the TypeScript functions | Pass | Go ports tested on TypeScript-generated fixtures: 124 dependency trees, 186 neighbourhoods, 186 reach sets, 127 impact analyses, event flows for 3 environments (shown to fail on altered expectations) |
| Parameterized database traversal | Pass | `GraphRepository.Subgraph` (SQL `TRAVERSE`, bound parameters, allowlisted direction); 918 database-backed traversals equal the full-graph results (`TestTraversalOnTheDatabaseEqualsTheFullGraph`) |
| Cycles, disconnected entities, depth limits, environment boundaries | Pass | BFS with visited sets (the mock has cycles through bindings/channels); every entity incl. isolated containment resources; depths 1/2/10 and neighbourhoods 1–3; projections validated per environment |
| Authorization | Not applicable yet | No authentication exists; decided in B6 |
| Query plans reviewed | Pass | `make bench` prints `EXPLAIN`; full edge scan found and fixed with schema v3 indexes |
| Latency measured on a representative dataset | Pass | 1,000 entities: full-topology endpoints 2–6 ms p50 with the revision cache (82–89 ms before), traversals 11–56 ms |
| No unbounded traversal endpoint | Pass | depth, limit, roots, and visited-entity caps (ADR-DB-003) |

Known limitations: measurements on a shared 2 GB VM, single client, no concurrency test; imports are one statement per record; generated datasets have no event types.

## Milestone B5 closeout (2026-10-11)
Evidence: `make check` exit 0; `make test-integration` passes; `make contract-check` 58/58 (12 new checks); frontend `npm run check` passes.

| Criterion | Result | Evidence |
|---|---|---|
| Simulated vs observed distinction | Pass | Stored events/telemetry/runs carry `provenance: simulated` and `isSimulated: true`; schema `const`s in `openapi.json`; tests on memory and ArcadeDB; no ingestion path can label data observed |
| Telemetry/event persistence | Pass | ArcadeDB schema v4: `SimulationRun`, `SimulationEvent`, `TelemetryObservation` (batched `INSERT … CONTENT :docs`, one transaction); `TestSimulationRunsOnTheDatabase` |
| Snapshot creation/comparison | Pass | Runs can capture `simulation` snapshots; `GET /topology/snapshots/{id}/diff` (port of `diffTopology`, identical on 9 fixture pairs) |
| Bounded simulation runs | Pass | Go port of `engine.ts`, identical on 3 scripted scenarios (16 recorded states incl. drift RNG, anomalies, scheduled recovery, reset); ≤ 100 actions, ≤ 500 ticks, ≤ 5 watched entities; runs never change the canonical topology (asserted) |
| Retention documented and applied | Pass | ADR-017; `SIMULATION_RETENTION`/`SIMULATION_MAX_RUNS`; pruning removes events and telemetry with runs (tests) |
| Oversized payloads rejected or bounded | Pass | 413 body limits, 400 for action/tick/watch bounds, stored events capped at 5,000 per run with `eventsTruncated` |

Notes: exact float parity needed explicit conversions to stop Go fusing `x*y±z` into FMA on arm64, and a `toFixed` port that rounds exact binary ties up. Known limitations: runs are one-shot (no incremental sessions); telemetry exists only for simulation runs; snapshots are not pruned and cannot be deleted yet.

## Milestone B6 closeout (2026-10-11)
Evidence: backend `make check` exit 0; `go test -race -count=1 ./...` passes; `make test-integration` passes; `make contract-check` 59/59; `make vulncheck` (govulncheck v1.8.0): no vulnerabilities; frontend `npm run check` passes (361 tests) and `npm audit`: 0 vulnerabilities; live end-to-end run: Go API on ArcadeDB + production frontend build (`vite preview` proxy) in headless Chrome with `?source=api`: map rendered 27 nodes, registry 9 staging rows labelled "Backend API · mock inventory · simulated telemetry", event catalog 9 entries, API access log shows `/api/v1/meta` and `/api/v1/topology`; backup → restore into a new database → schema check and equal record counts for 14 types.

| Criterion | Result | Evidence |
|---|---|---|
| Auth decision and authorization boundaries | Pass (scoped) | ADR-018: optional hashed bearer tokens, reader/editor, loopback default, refusal to expose unauthenticated; OIDC/tenancy still open |
| Request limits and rate limits | Pass | body/parameter caps (B3–B5), per-client token bucket with 429 + `Retry-After` |
| Secrets handling | Pass | password file only, digests for tokens, nothing secret in logs/errors/bundle (tests) |
| Observability | Pass | structured logs with request ID, route, principal; Prometheus `/metrics` (HTTP by route pattern, ArcadeDB by endpoint, cache hits) on loopback |
| Backup/restore exercised | Pass | `make backup` / `make restore` run end to end; `docs/backend/RUNBOOK.md` |
| Security tests | Pass | auth/roles, exposure guard, rate limit, CORS, headers, injection-shaped IDs (memory and ArcadeDB), error hygiene |
| Full integration suite | Pass | `make test-integration` (all ArcadeDB tests, temporary databases) |
| Measured performance against targets | Pass | 1,000 entities (ADR-005 navigation target): every endpoint ≤ 10 ms p50 single-client and ≤ 30 ms p50 with 8 clients after moving traversal to the cached index (`docs/BENCHMARKS.md`) |
| Frontend integration | Pass | HTTP repositories (`apps/web/src/data/http/`), `?source=api`, Vite proxy, honest labels from `/meta`, startup parameters kept in the URL |
| Runbook | Pass | `docs/backend/RUNBOOK.md` (start/stop, seed, backup, restore, recovery, reset, tokens) |

### Still open before production (not implemented, by design)
- Identity for browsers (OIDC/SSO), tenancy, per-user layout ownership and concurrency (`ETag`/`If-Match`), audit trail.
- Observed telemetry ingestion and provider adapters (future milestone; provenance rules are in place).
- Snapshot retention/deletion; incremental (non-replacing) imports.
- TLS termination and deployment topology (reverse proxy), production database sizing (MongoDB since ADR-019) and backups off-host.
- Measurements on production-like hardware (all numbers here come from a 2 GB laptop VM).

## Database migration to MongoDB (2026-10-11, ADR-019)
Product owner direction: replace ArcadeDB with MongoDB (no dual support). Scope: persistence adapter, configuration, local tooling, operations, and docs. The API contract, frontend, fixtures, domain logic, and parity tests are unchanged. Committed as `feat(db)`.

Evidence: `make check` exit 0; `make test-integration` passes (17 tests in the MongoDB adapter, including 918 traversal-parity checks, transaction rollback, validators, operator- and key-injection round trips); `make contract-check` 59/59; `make seed` twice (idempotent) and `make schema-check` pass; `make backup` → `make restore` into a new database with schema check and equal document counts in 13 collections, and refusal to overwrite; `make bench` results in `docs/BENCHMARKS.md` "Backend on MongoDB".

| Criterion | Result | Evidence |
|---|---|---|
| Same contract and behaviour | Pass | contract check 59/59; seeded fixture round-trips exactly; frontend unchanged except two Settings labels |
| All-or-nothing writes | Pass | imports, simulation runs, and retention in transactions; a colliding run leaves nothing behind (integration test) |
| Database-side constraints | Pass | unique `_id`; `$jsonSchema` validators reject documents without string `id`/`_meta` |
| Injection safety | Pass | typed filters only; operator-shaped IDs match nothing; `$where`/`$date`/dotted keys in metadata and layout positions round-trip literally |
| Traversal parity in the database | Pass | `$graphLookup` subgraphs give the client's results on 918 traversals; entity bound returns 400 |
| Secrets | Pass | password via file and Docker secret; never on a command line (`scripts/mongosh.sh`, `mongodump --config` inside the container); credentials in the URI rejected; auth failures surface as "credentials rejected" without the password (test) |
| Operations | Pass | online backup and restore (`RUNBOOK.md`), readiness, metrics per MongoDB command |
| Performance | Pass (single client), not measurable under load on this VM | `docs/BENCHMARKS.md`; the 2 GB VM OOM-killed `mongod` under 8 concurrent clients |

Not migrated: existing ArcadeDB data (re-seed instead). The `backend_arcadedb_data` volume and `secrets/arcadedb_root_password.txt` were left in place for the owner to delete.

## Milestone B7 closeout — entity writes (2026-10-12, ADR-020)
Product owner direction: create, update, and delete every entity kind from the UI, against the backend. Committed as `feat(b7)`.

Evidence: `make check` exit 0 (new unit tests: field rules equal the schema enums, write round trip and error mapping over HTTP); `make test-integration` passes (new: writes on MongoDB with revision guard in the adapter, ordering, kept telemetry, blocked delete, schema still valid); `make contract-check` 71/71 (12 new write checks, including ETag, 409, 412, 422 blocked delete, 204).

| Criterion | Result | Evidence |
|---|---|---|
| Create/replace/delete for all six kinds | Pass | `internal/application/entities.go`; HTTP tests; contract check |
| Topology always valid after a write | Pass | whole-topology `domain.Validate` before `ApplyChange`; invalid writes 422 with codes |
| Referenced entities cannot be deleted | Pass | 422 lists the blockers (HTTP and MongoDB tests, contract check on `production`) |
| No lost updates | Pass | `ETag` / `If-Match` → 412; adapter re-checks the revision inside the transaction (integration test) |
| Telemetry and timestamps not client-writable | Pass | `updatedAt` server-set; metrics dropped on create, kept on replace (tests) |
| Authorization | Pass | non-GET requires the editor role in token mode (existing middleware, ADR-018) |

## Milestone B8 closeout — business flows (2026-10-12, ADR-022)
Delivered:
- **Domain:** `internal/domain/businessflow.go` holds the types and transition backing; the validation codes are identical to TypeScript, with 8 new conformance cases.
- **Storage:** a `businessFlows` collection with the canonical validator and an `_meta.ord` index; flows are part of `GET /topology` and snapshots.
- **Entity API:** `business-flow` is a writable kind, with schema-level field checks (`invalid-field`). Imported flows are read-only through it (409 `imported-read-only`).
- **Import:**
  - Port `ports.FlowFormat`, with adapters in `internal/adapters/flowformats` (native JSON/YAML through `go.yaml.in/yaml/v3`, and BPMN 2.0 through `encoding/xml`).
  - `application.ImportFlows`: whole-topology validation first; no writes on an unchanged re-import; never overwrites an authored flow (409 `import-overwrites-authored`).
  - `POST /api/v1/imports/business-flows` (editor role) and `make import-flows FILE=… [FORMAT=…] [MAPPING=…]` (`cmd/importflows`).

| Criterion | Result | Evidence |
|---|---|---|
| Parity tests pass | Pass | `make check` (conformance on `fixtures/conformance/validation`) |
| Import of each example file round-trips | Pass | `flowformats_test.go` (both examples validate against the example topology); `TestImportFlowsOnTheDatabase` |
| Re-import is a no-op | Pass | API test (same ETag) and integration test (same revision) |
| BPMN with an unmapped task is rejected with the task named | Pass | `TestBPMNRejectsUnmappedTasksAndAcceptsAMapping`; API 422 `import-invalid` for `Task_void` |
| `make check`, `make test-integration`, `make contract-check` | Pass | 80/80 contract checks; `make vulncheck`: no reachable vulnerabilities |

## Milestone B10 closeout — transit board definitions (2026-10-13, ADR-031)
Delivered with frontend Milestone 11.4 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Domain:** `internal/domain/board.go` holds the types and `ValidateBoard`, a port of `validateBoardDefinition` with the same codes, order, and field paths (`Issue.Path`).
- **Storage:** the `transitBoards` collection (schema version 2), `_id` = service definition ID, with an integer revision bumped atomically (`FindOneAndUpdate` with a revision guard). Implemented for MongoDB and memory.
- **Application:** `application/boards.go` validates every write against the current topology. The path's service must equal the body's.
- **API:** `GET`/`POST /api/v1/transit-boards` and `GET`/`PUT`/`DELETE /api/v1/transit-boards/{serviceId}`, with `ETag` / `If-Match`. Errors: 404, 409 (exists), 412 (stale), 422 (`errors[]` with `path`), and 503 without a board store. Documented in `docs/api/openapi.json`.

| Criterion | Result | Evidence |
|---|---|---|
| Validation parity on shared fixtures | Pass | `board_test.go` (conformance plus enums against the schema) |
| Revision-guarded writes on the database | Pass | `TestBoardRepositoryOnTheDatabase` (`make test-integration`) |
| API matches the contract | Pass | `httpapi/boards_test.go`; `make contract-check` 91/91 |
| End to end with the UI | Pass | Milestone 11.4 closeout |

## Milestone B11 closeout — data bundle import (2026-10-13, ADR-032)
Delivered with frontend Milestone 11.5 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Domain:** `internal/domain/bundle.go` holds the bundle type and `ParseBundle`, a port of `validateBundle` with the same codes, order, and paths. Unknown fields are rejected.
- **Port:** `ports.BundleImporter.ReplaceAll`. In MongoDB it is one transaction (canonical collections, `transitBoards`, a new revision with `sourceType: "import"`), with an optional revision check. Memory implements it too.
- **Application:** `ImportBundle` runs the bundle checks, then the entity field checks; boards are normalised.
- **API:** `POST /api/v1/imports/bundle` (16 MB, editor role, `If-Match`). Responses: 200 with counts and `ETag`; 400, 412, 422, and 503. Documented in `docs/api/openapi.json`.

| Criterion | Result | Evidence |
|---|---|---|
| Parity with the TypeScript checks | Pass | `TestBundleValidationConformance` (11 cases) |
| Atomic replace and revision guard on the database | Pass | `TestReplaceAllOnTheDatabase` |
| API behaviour and contract | Pass | `bundle_test.go`; `make contract-check` 96/96 |

## Milestone B9 closeout — flows in impact analysis (2026-10-13, ADR-025)
Delivered with frontend Milestone 12 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Domain:** `internal/domain/flowimpact.go` ports `flowImpact.ts` (same sections and names); `BusinessFlow.TypicalPath` and `Outcome` in `businessflow.go`.
- **Application/API:** `GET /api/v1/topology/impact` returns `flows`. Documented in `docs/api/openapi.json` (`FlowImpact`, `AffectedFlowStep`, `LikelyFlowOutcome`).

| Criterion | Result | Evidence |
|---|---|---|
| Parity with TypeScript on shared fixtures | Pass | `TestFlowImpactConformance` (126 cases) |
| Example scenario over HTTP | Pass | `api_test.go` |
| Contract check against a running API | Pass (2026-10-15) | `make contract-check` 110/110, including `impact with business flows` |

## Milestone B12 closeout — Dynatrace connector (2026-10-15, ADR-034)
Delivered with frontend Milestone 15 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Adapter:** `internal/adapters/dynatrace` (configuration, platform token or OAuth client, the Grail query client, seven constant queries, the mapping, observations, the connection check) and `dynatracefake` with `cmd/fakedynatrace` (`make fake-dynatrace`).
- **Application:** `reconcile.go` and `reconcile_kinds.go` (owned, authored, linked, kept, deleted), `sourcesync.go` (status, check, held previews, apply, aliases), `observations.go` (overlay, freshness, write guard).
- **Ports and storage:** `TopologySource`, `SourceWriter` (`ApplyChanges`, `SourceTypes`; a replace keeps the creating `_meta.sourceType`), `IntegrationStore`; collections `integrations` and `observations` (schema version 3).
- **API:** `/integrations/dynatrace` (status, check, preview, apply, aliases); `GET /meta` gains `observations`. Documented in `docs/api/openapi.json`.

| Criterion | Result | Evidence |
|---|---|---|
| Unit, API, and conformance tests | Pass | `make check` |
| Database behaviour (batch, ownership, aliases, observations) | Pass (2026-10-15) | `make test-integration`; `sourcesync_integration_test.go` on MongoDB 8.0.30 |
| Contract check against a running API with the fake tenant | Pass (2026-10-15) | `make contract-check` 110/110 |

## Milestone B12.1 closeout — Dynatrace hosts, channels, metric join (2026-10-15, ADR-034 amendment)
Delivered with frontend Milestone 15.1 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Domain:** the `host` resource type, containment only (`fields.go`, `types.go`, schema).
- **Adapter:** queries `hosts`, `service-runs-on`, `messaging-publish`, `messaging-receive`; `service-metrics` by `dt.smartscape.service`; `messaging.go` (channels); at most four queries at once per tenant.
- **Application:** channel matching by type, name, and effective environment; re-derived relationship IDs; an empty change list is `[]`.

| Criterion | Result | Evidence |
|---|---|---|
| Unit, conformance, API tests | Pass | `make check` |
| Database | Pass | `make test-integration` |
| Contract with the fake tenant | Pass | `make contract-check` 111/111 |

## Milestone B12.2 closeout — calls from spans, no workload resources (2026-10-15, ADR-034 amendment)
Delivered with frontend Milestone 15.2 (closeout in `docs/IMPLEMENTATION_PLAN.md`):
- **Adapter:**
  - no workload resources: the instance runs in its namespace, and the workload is in its link (ADR-008);
  - `calls.go`: the `call-metrics` span query, read every `callMetrics.interval` and cached between reads, with failures reported as warnings;
  - relationship links `calls:<caller>-><callee>`;
  - numeric strings accepted.
- **Application:** the overlay merges metrics onto relationships and merges the states of services merged into one instance; `lastRefresh.warnings`.
- **API:** `callMetricsIntervalSeconds` and `lastRefresh.warnings` on `GET /integrations/dynatrace`; `call-metrics` in the check.

| Criterion | Result | Evidence |
|---|---|---|
| Unit, conformance, and API tests | Pass | `make check` |
| Database | Pass | `make test-integration` |
| Contract with the fake tenant and call metrics on | Pass | `make contract-check` 111/111 |
| Migration from an earlier sync on MongoDB | Pass | the previous build's sync, then the current preview and apply |

