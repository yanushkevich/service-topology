---
name: topology-backend
description: Conventions for implementing the Go + MongoDB backend of the Service Topology platform in backend/. Use when writing or reviewing backend code, queries, or the API contract.
---

# Skill: Service Topology Backend

Not installed. To enable, copy to `.claude/skills/topology-backend/SKILL.md` (decide in B1).

## Architecture
Use Go modular-monolith boundaries: domain, application services, ports/interfaces, HTTP adapters, MongoDB adapter, config and observability. MongoDB is the only authoritative database (ADR-019).

## Graph and identity
Store canonical entities as one document per entity in a collection per kind, with `_id` = the stable ID, and relationships as documents in `relationships`; containment stays in the reference fields (`docs/backend/PERSISTENCE.md`). Stable application IDs are public identities; never expose database-internal identifiers. Rely on `_id` uniqueness and validate relationship endpoints before writing. Use typed driver filters with input only as values; never `$where` or JavaScript.

## Product invariants
- Mock-first implementation; label mock, observed, and simulated provenance correctly.
- Infrastructure containment differs from communication/dependency relationships.
- 2D topology remains primary; 3D galaxy is secondary.
- Keep renderer layout/camera state out of resource identity.
- Bound traversal depth, result count, query time, and authorization scope.
- Preserve target workloads: 250 visible nodes, 750 visible edges, navigation across 1,000 entities; benchmark rather than promise.

## Workflow
Inspect `docs/backend/` and the contract (`docs/api/openapi.json`, `docs/schemas/`, `apps/web/src/domain/`) before coding. Implement only the requested milestone. Use deterministic seeds, integration tests against MongoDB, explicit transaction boundaries, and graceful driver shutdown. Update API/OpenAPI and architecture records when contracts change. Do not introduce a second store or graph projection without an approved ADR. MongoDB Community Server is SSPL-1.0; review licensing and production support/operations before deployment.
