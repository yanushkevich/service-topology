# Service Topology & Registry Platform — Go Backend Specification Pack (v4: ArcadeDB)

**Status:** Proposed implementation specification; not evidence of an existing backend. **Language:** Go. **Persistence:** ArcadeDB is the only required database and the authoritative store for resources, relationships, environments, graph traversals, snapshots and saved-view data.

This package complements UI/product documentation Revision 4. It does not replace it. Preserve canonical domain rules, mock-first delivery, stable IDs, data provenance, scale targets, and the distinction between infrastructure containment and communication dependencies.

## Start here
1. `docs/BACKEND_SPEC.md` — scope, architecture, invariants and non-functional requirements.
2. `docs/DOMAIN_MODEL.md` — canonical backend entities and invariants.
3. `docs/API_SPEC.md` — proposed REST API.
4. `docs/PERSISTENCE.md` — ArcadeDB graph model, constraints, query patterns and transaction boundaries.
5. `docs/DATABASE_DECISIONS.md` — rationale and trade-offs for ArcadeDB-only storage.
6. `docs/LOCAL_DEVELOPMENT.md` — Docker Compose, local configuration and reset/seed workflow.
7. `docs/INTEGRATIONS_AND_PROVENANCE.md` — mock source now, provider adapters later.
8. `docs/SECURITY.md` — security baseline and unresolved deployment decisions.
9. `docs/TESTING_AND_PERFORMANCE.md` — quality gates and graph query tests.
10. `docs/IMPLEMENTATION_PLAN.md` — milestone-by-milestone implementation.
11. `docs/CLAUDE_CODE_PROMPT.md` and root `CLAUDE.md` — agent implementation guidance.

## Proposed baseline stack
- Go (pin a supported version in `go.mod` and CI).
- HTTP REST API with OpenAPI 3.1 as the contract.
- ArcadeDB as the sole authoritative database for graph entities, relationships, flexible resource metadata, snapshots, saved views and simulation records.
- Docker Compose for local ArcadeDB development.
- Official ArcadeDB HTTP/JSON API adapter (pin a supported version), structured logging, health/readiness endpoints, metrics, schema constraints/index setup, deterministic seed data, unit/integration tests.

## Source-of-truth relationship
ArcadeDB is authoritative; there is no second database projection in the initial architecture. Go application services validate commands and execute graph writes/queries through repository interfaces and explicit transaction boundaries. Use stable application IDs stored as node/relationship properties; never expose ArcadeDB internal record IDs as API identity. Because there is no separate graph projection, there is no cross-database projection lag to report. Still report database availability and transaction/query failures accurately.

## Scope guardrails
Start as a modular monolith. Do not introduce microservices, Kubernetes deployment requirements, Kafka, or cloud-provider integrations in the first implementation milestones. Do not make frontend rendering structures the canonical domain model. Keep 2D/3D UI-specific layout and camera state separate from resource identity and relationships. Review ArcadeDB licensing and support and deployment terms for the intended commercial distribution before production commitment.
