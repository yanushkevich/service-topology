# Backend Specification

## Purpose
Provide a Go backend for the Service Topology & Registry Platform, aligned with the UI reference docs. The backend supplies normalized resources and relationships for the 2D topology, grouped infrastructure view, registry, inspector, and 3D galaxy. The backend is mock-first; provider integrations are future work.

## Architecture
- Go modular monolith with clear domain, application, ports, HTTP adapters, ArcadeDB adapter, configuration and observability packages.
- REST API described with OpenAPI 3.1.
- ArcadeDB is the sole authoritative database and serves both registry reads/writes and graph traversal.
- Domain types and API DTOs are independent of ArcadeDB driver types and frontend rendering models.

Suggested packages: `cmd/api`, `cmd/seed`, `internal/domain`, `internal/application`, `internal/ports`, `internal/adapters/http`, `internal/adapters/arcadedb`, `internal/config`, `internal/observability`.

## Core invariants
- Stable application IDs are the public identity for resources and relationships; never expose ArcadeDB internal IDs.
- Every relationship endpoint must reference an existing resource in the same allowed environment/workspace scope.
- Infrastructure containment and communication/dependency relationships are distinct concepts.
- Provenance distinguishes mock, observed, and simulated data. Simulated events must never be described as observed telemetry.
- Common fields are typed and validated; provider-specific metadata is extensible but size-limited and validated by resource kind.
- Layout/camera state is not part of resource identity.
- Graph traversal is always bounded by depth, result count, timeout and authorization scope.

## API and query behavior
Topology queries accept environment, resource kinds, relationship types, health/status, text search, scope/root, depth, and pagination/limit controls as appropriate. Responses include nodes/resources, edges/relationships, counts and query metadata. Never return an unbounded full graph by default. Use stable IDs in all API responses.

## Reliability and observability
- Liveness and readiness endpoints; readiness requires ArcadeDB connectivity and schema initialization.
- Structured logs with request/correlation IDs; metrics for request latency/errors, transaction failures, database connection pool usage, and graph-query latency/timeouts.
- Explicit transaction boundaries for multi-step writes; bounded retry only for transient/retryable operations.
- Database unavailability should produce clear errors; never silently claim incomplete topology results are complete.
- Graceful shutdown closes the driver and HTTP server.

## Performance and scope
Preserve UI targets of 250 visible nodes, 750 visible edges, and navigation across 1,000 entities as targets to benchmark, not promises. Use representative graph shapes, realistic metadata, and query plans. Start without cloud/Kubernetes/Kafka integrations, microservices, or mandatory Kubernetes deployment.

## Open decisions before production
Authentication/authorization and tenant boundaries, retention windows, observed telemetry ingestion, snapshot semantics, availability/performance SLOs, backup/restore, ArcadeDB edition/license, and production deployment topology must be resolved.
