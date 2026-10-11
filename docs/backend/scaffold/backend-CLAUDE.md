# Backend instructions (`backend/`) — Service Topology & Registry Platform

Becomes `backend/CLAUDE.md` in Milestone B1. The root `CLAUDE.md` still applies; specs are in `docs/backend/`.


- Follow `docs/backend/SOURCE_ALIGNMENT.md`; do not silently redefine product behavior.
- Implement the existing contract `docs/api/openapi.json` and schemas in `docs/schemas/`; the validation rules and codes match `src/domain/validation.ts`. Change the contract only together with the frontend types and contract tests.
- Backend language: Go. Architecture: modular monolith with REST/OpenAPI.
- ArcadeDB is the sole authoritative database in the v4 specification. Do not add MongoDB, ArangoDB, graph projections, or cross-database synchronization without a user-approved architecture decision record.
- Keep domain types independent from HTTP and ArcadeDB driver packages. Use repository/query interfaces and stable application IDs.
- Model canonical entities as vertices and canonical relationships as directed edges (`docs/backend/PERSISTENCE.md`). Use parameterized queries and allowlists for dynamic labels/relationship types.
- Do not expose ArcadeDB internal record IDs as API identifiers.
- Preserve mock-first delivery and explicit mock/observed/simulated provenance.
- Never confuse infrastructure containment with runtime communication dependencies.
- Preserve the 2D topology as the primary operational view; 3D galaxy is a secondary visualization. Do not put renderer-specific layout/camera state into resource identity.
- Bound graph traversal depth, result count, query time and authorization scope.
- Implement only the requested backend milestone (B1–B6). Commit it with scope `b1`…`b6`; do not push unless asked. Add tests and update docs for behavior changes. Do not claim tests passed unless executed.
- Treat 250 visible nodes, 750 visible edges and navigation across 1,000 entities as benchmark targets, not guarantees.
- Confirm ArcadeDB edition, licensing and deployment constraints before production commercialization.
