---
name: topology-backend
description: Conventions for implementing the Go + ArcadeDB backend of the Service Topology platform in backend/. Use when writing or reviewing backend code, queries, or the API contract.
---

# Skill: Service Topology Backend

Not installed. To enable, copy to `.claude/skills/topology-backend/SKILL.md` (decide in B1).

## Architecture
Use Go modular-monolith boundaries: domain, application services, ports/interfaces, HTTP adapters, ArcadeDB adapter, config and observability. ArcadeDB is the only authoritative database in the v4 specification.

## Graph and identity
Represent canonical entities as vertices and canonical relationships as one `COMMUNICATES` edge each; containment as `CONTAINS`/`HOSTED_IN` (`docs/backend/PERSISTENCE.md`). Stable application IDs are public identities; never expose ArcadeDB internal record IDs. Enforce uniqueness constraints and validate relationship endpoints. Use parameterized queries and strict allowlists for dynamic labels/relationship types.

## Product invariants
- Mock-first implementation; label mock, observed, and simulated provenance correctly.
- Infrastructure containment differs from communication/dependency relationships.
- 2D topology remains primary; 3D galaxy is secondary.
- Keep renderer layout/camera state out of resource identity.
- Bound traversal depth, result count, query time, and authorization scope.
- Preserve target workloads: 250 visible nodes, 750 visible edges, navigation across 1,000 entities; benchmark rather than promise.

## Workflow
Inspect `docs/backend/` and the contract (`docs/api/openapi.json`, `docs/schemas/`, `src/domain/`) before coding. Implement only the requested milestone. Use deterministic seeds, integration tests against ArcadeDB, explicit transaction boundaries, and graceful driver shutdown. Update API/OpenAPI and architecture records when contracts change. Do not introduce MongoDB/ArangoDB or a second store without an approved ADR. ArcadeDB is Apache-2.0, not MIT; review license notices and production support/operations before deployment.
