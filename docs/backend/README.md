# Go Backend Specification (MongoDB)

**Status (2026-10-11):** B1–B6 are implemented in `backend/`. Remaining production decisions (browser SSO, tenancy, observed telemetry ingestion, deployment) are listed in the B6 closeout of `IMPLEMENTATION_PLAN.md`. Operations: `RUNBOOK.md`. The database is MongoDB since ADR-019 (it replaced ArcadeDB after B6; ADR-DB-004).

The backend serves the **existing** HTTP contract (`docs/api/openapi.json`, `docs/API_CONTRACT.md`) and the **existing** canonical domain (`src/domain`, `docs/schemas`). It does not define its own contract or domain. Preserve: mock-first delivery, stable IDs, provenance labeling, scale targets, and the distinction between containment and communication.

## Monorepo layout

```text
service_topology/
├── apps/web/                    frontend (React + TypeScript + Vite)
├── backend/                     Go module (Milestone B1)
│   ├── cmd/api, cmd/seed
│   ├── internal/…
│   ├── CLAUDE.md                backend agent rules
│   └── Makefile, docker-compose.yml, .env.example, .gitignore
├── docs/
│   ├── api/openapi.json         the one HTTP contract (frontend and backend)
│   ├── schemas/                 payload schemas shared by both
│   └── backend/                 this folder
├── fixtures/                    shared JSON fixtures exported from the frontend mock
└── package.json                 forwards npm scripts to apps/web
```

## Start here
1. `SOURCE_ALIGNMENT.md`: what the backend must preserve and which decisions are binding.
2. `BACKEND_SPEC.md`: scope, architecture, invariants, non-functional requirements.
3. `DOMAIN_MODEL.md`: canonical entities, mapped 1:1 to `TopologyData` v1, and the validation rules to implement.
4. `API_SPEC.md`: how the backend implements `openapi.json`, and proposed additions.
5. `OPENAPI_NOTES.md`: contract maintenance rules.
6. `PERSISTENCE.md`: MongoDB collections, validators, indexes, query patterns, transactions.
7. `DATABASE_DECISIONS.md`: ADR-DB-004, MongoDB as the single database (ADR-DB-001–003: the earlier ArcadeDB decisions).
8. `LOCAL_DEVELOPMENT.md`: Docker Compose, configuration, reset/seed.
9. `INTEGRATIONS_AND_PROVENANCE.md`: mock source now, adapters later.
10. `SECURITY.md`: security baseline and unresolved deployment decisions.
11. `TESTING_AND_PERFORMANCE.md`: quality gates, contract and conformance tests.
12. `IMPLEMENTATION_PLAN.md`: Milestones B1–B6 with closeouts.
12a. `RUNBOOK.md`: start/stop, seed, backup, restore, recovery.
13. `CLAUDE_CODE_PROMPT.md`: agent prompt for implementing a backend milestone.
14. `scaffold/`: files that move into `backend/` in B1 (see `scaffold/README.md`).

## Baseline stack
- Go (pin a supported version in `go.mod` and CI).
- REST over HTTP; OpenAPI 3.1 contract in `docs/api/openapi.json`.
- MongoDB 8.0 as the sole authoritative database (Community Server, SSPL-1.0; see ADR-019); local image `mongo:8.0.30` as a single-node replica set (transactions need one), tested 2026-10-11.
- Official Go driver `go.mongodb.org/mongo-driver/v2` (v2.9.1) behind repository interfaces; structured logging, health/readiness, metrics, idempotent schema setup, deterministic seed, unit and integration tests.

## Scope guardrails
Modular monolith. No microservices, Kubernetes requirements, Kafka, or cloud-provider integrations in the initial milestones. Frontend rendering structures are never the domain model. MongoDB is authoritative; there is no second store or projection. Review MongoDB licensing (SSPL for Community Server; Atlas or Enterprise otherwise), support, and operations before production.

## Agent rules (from the pack's `CLAUDE.md` and skill)
- Follow `SOURCE_ALIGNMENT.md`; never silently redefine product behavior or the contract.
- Domain types are independent of HTTP and MongoDB driver packages; use repository/query interfaces and stable application IDs (`_id`); never expose database-internal identifiers.
- Typed driver filters with input only as values (no `$where`, JavaScript, or query strings); constants for collection and field names.
- Bound traversal depth, result count, query time, and authorization scope.
- Implement only the requested backend milestone; add tests; update docs and `openapi.json` with contract changes; never claim a check passed without running it.
- Commit per milestone with Conventional Commits, scope `b1`…`b6` (`docs/AGENT_WORKFLOW.md` §6), directly on `main`; do not push unless asked.

## Review changes (2026-10-11, against the v4 pack)

Historical: the pack specified ArcadeDB, and the items below describe the ArcadeDB period. ADR-019 later replaced it with MongoDB; current persistence is in `PERSISTENCE.md`.

- **One contract:** `API_SPEC.md` and `OPENAPI_NOTES.md` now implement `docs/api/openapi.json` instead of proposing a second API: `/registry` and `/entities/{kind}/{id}` instead of `/services`, `/resources`, `/relationships`; `q` instead of `query`; `limit` ≤ 500; RFC 9457 problems with `errors[]` (plus a proposed `requestId` extension) instead of `code`/`fieldErrors`. Additions (health, meta, traversal, event types, telemetry) are listed as proposals that must enter `openapi.json` first.
- **Domain aligned with the implementation:** IDs unique across all collections; environment inheritance and isolation; instance host via `resourceId` (removed denormalized region/cluster/namespace strings); explicit messaging relationships (removed `topic_or_queue_resource_id`); RabbitMQ bindings; event types (ADR-014); snapshot and layout fields from the v1 schemas; validation codes identical to `validateTopology`; provenance mapped to the API's `isSimulated`.
- **Persistence:** one `COMMUNICATES` edge type per canonical relationship instead of `CALLS`/`DEPENDS_ON`/`PUBLISHES_TO`/`CONSUMES_FROM`, so traversal and propagation follow one edge set (ADR-008 reasoning); containment as `CONTAINS`/`HOSTED_IN`; example IDs use the shared fixture IDs.
- **Seed parity:** the backend seeds from the same mock topology as the frontend, exported to shared JSON fixtures, plus conformance fixtures for validation parity.
- **Simulation:** recorded as client-side today (ADR-010); server-side simulation stays an open decision.
- **Local security:** Compose now binds ArcadeDB to `127.0.0.1` (the pack's own `SECURITY.md` required it; the original published it on all interfaces). The healthcheck depends on `curl` being in the image, which is unverified.
- **Placement:** root-level files moved to `scaffold/`; the skill file gained the frontmatter Claude Code needs, but it is not installed into `.claude/skills/`.
