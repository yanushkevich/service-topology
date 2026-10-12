# Backend Specification

## Purpose
Provide a Go backend for the Service Topology & Registry Platform that serves the existing HTTP contract (`docs/api/openapi.json`) and canonical domain (`DOMAIN_MODEL.md`). It supplies the data behind every frontend view: 2D topology, grouped infrastructure, registry, inspector, Overview, Dependencies, Infrastructure, Events catalog, history, and 3D galaxy. The frontend already runs on in-memory repositories that implement the same interfaces; the backend replaces them without UI changes. Mock-first; provider integrations are future work.

## Architecture
- Go modular monolith with clear domain, application, ports, HTTP adapters, MongoDB adapter, configuration and observability packages.
- REST API described with OpenAPI 3.1.
- MongoDB is the sole authoritative database (ADR-019) and serves registry reads/writes; graph traversal runs in Go on the cached topology, with `$graphLookup` as the database option.
- Domain types and API DTOs are independent of MongoDB driver types and frontend rendering models.

Suggested packages (under `backend/` in the monorepo): `cmd/api`, `cmd/seed`, `internal/domain`, `internal/application`, `internal/ports`, `internal/adapters/http`, `internal/adapters/mongodb`, `internal/config`, `internal/observability`.

## Core invariants
- Stable application IDs, unique across all collections, are the public identity; never expose database-internal identifiers.
- Topologies pass the same validation rules as the frontend's `validateTopology` (codes listed in `DOMAIN_MODEL.md`): endpoints exist and are not containment-only, environments are inherited and isolated (only environment-independent entities are shared), event types agree with relationships.
- Infrastructure containment and communication/dependency relationships are distinct concepts.
- Provenance distinguishes mock, observed, and simulated data. Simulated events must never be described as observed telemetry.
- Common fields are typed and validated; provider-specific metadata is extensible but size-limited and validated by resource kind.
- Layout/camera state is not part of resource identity.
- Graph traversal is always bounded by depth, result count, timeout and authorization scope.

## API and query behavior
Endpoints, parameters, pagination, and errors are those of `docs/api/openapi.json` (`API_SPEC.md`). Traversal endpoints, once added, accept bounded depth and limits and report truncation. Never return an unbounded full graph by default. Use stable IDs in all API responses.

## Reliability and observability
- Liveness and readiness endpoints; readiness requires MongoDB connectivity and schema initialization.
- Structured logs with request/correlation IDs; metrics for request latency/errors, transaction failures, database connection pool usage, and graph-query latency/timeouts.
- Explicit transaction boundaries for multi-step writes; bounded retry only for transient/retryable operations.
- Database unavailability should produce clear errors; never silently claim incomplete topology results are complete.
- Graceful shutdown closes the driver and HTTP server.

## Performance and scope
Preserve UI targets of 250 visible nodes, 750 visible edges, and navigation across 1,000 entities as targets to benchmark, not promises. Use representative graph shapes, realistic metadata, and query plans. Start without cloud/Kubernetes/Kafka integrations, microservices, or mandatory Kubernetes deployment.

## Open decisions before production
Authentication/authorization and tenant boundaries, retention windows, observed telemetry ingestion, saved-layout ownership and concurrency, server-side simulation, availability/performance SLOs, backup/restore, MongoDB edition/license (SSPL vs. Atlas/Enterprise), and production deployment topology must be resolved. Several are already listed as open decisions in `docs/API_CONTRACT.md`; resolve them there.
