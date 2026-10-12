# Claude Code Prompt — Implement the Go Backend (ArcadeDB)

> **Historical.** This prompt drove Milestones B1–B6 on ArcadeDB. The database is MongoDB since ADR-019; where this prompt says ArcadeDB, follow `PERSISTENCE.md` and `DATABASE_DECISIONS.md` ADR-DB-004 instead.

You are implementing the backend for the Service Topology & Registry Platform. This is a monorepo: the frontend is in `apps/web/`, the Go backend in `backend/`, shared fixtures in `fixtures/`. First inspect the root `CLAUDE.md`, `docs/backend/README.md`, `docs/backend/SOURCE_ALIGNMENT.md`, `docs/backend/BACKEND_SPEC.md`, `docs/backend/DOMAIN_MODEL.md`, `docs/backend/PERSISTENCE.md`, `docs/backend/DATABASE_DECISIONS.md`, `docs/backend/API_SPEC.md`, `docs/backend/TESTING_AND_PERFORMANCE.md`, `docs/backend/IMPLEMENTATION_PLAN.md`, the contract (`docs/api/openapi.json`, `docs/API_CONTRACT.md`, `docs/schemas/`), and the canonical domain in `apps/web/src/domain/`.

## Non-negotiable architecture
- Use Go and a modular monolith.
- Implement the existing contract (`docs/api/openapi.json`) and the existing validation rules; do not invent a parallel API or domain.
- ArcadeDB is the sole authoritative database for the initial implementation.
- Model resources as nodes and domain connections as directed, semantically typed relationships. Use stable application IDs; never expose ArcadeDB internal record IDs.
- Use the ArcadeDB HTTP API client with a supported pinned version and explicit lifecycle/session/transaction handling.
- Keep domain types independent from HTTP/database libraries; use repository and graph-query interfaces.
- Use parameterized queries. Dynamic labels and relationship types must be selected from strict server-side allowlists.
- Use mock data first; clearly label provenance.
- Keep frontend rendering details and 2D/3D layout state out of canonical resource identity.
- Do not introduce MongoDB or ArangoDB, a projection process, or cross-database outbox workflow unless a later user-approved ADR changes the architecture.

## Workflow
1. Summarize the existing docs and current repository state before coding.
2. Implement only the milestone requested by the user; do not advance automatically.
3. Present a short plan, file changes and acceptance tests.
4. Use current stable, mutually compatible library versions and pin versions in module/container config; verify current ArcadeDB driver/image compatibility.
5. Add tests with each behavior. Never claim a test passed unless you ran it and observed success.
6. Update documentation and `docs/api/openapi.json` whenever behavior/contracts change; keep `npm run check` passing.
7. Commit the milestone with a Conventional Commit, scope `b1`…`b6`, directly on `main`; do not push unless asked.

## First task
If no milestone is named, implement B1 only: create `backend/` from `docs/backend/scaffold/`, project foundation, config validation, HTTP lifecycle, health/readiness skeleton, domain model/validation, repository/query interfaces and deterministic seed fixture contract. Do not implement database persistence until requested.
