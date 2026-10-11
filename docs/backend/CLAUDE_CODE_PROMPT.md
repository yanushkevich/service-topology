# Claude Code Prompt — Implement the Go Backend (ArcadeDB)

You are implementing the backend for the Service Topology & Registry Platform. First inspect all project docs, especially `CLAUDE.md`, `docs/BACKEND_SPEC.md`, `docs/DOMAIN_MODEL.md`, `docs/PERSISTENCE.md`, `docs/DATABASE_DECISIONS.md`, `docs/API_SPEC.md`, `docs/TESTING_AND_PERFORMANCE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Non-negotiable architecture
- Use Go and a modular monolith.
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
6. Update documentation and OpenAPI whenever behavior/contracts change.

## First task
If no milestone is named, implement B1 only: project foundation, config validation, HTTP lifecycle, health/readiness skeleton, domain model/validation, repository/query interfaces and deterministic seed fixture contract. Do not implement database persistence until requested.
