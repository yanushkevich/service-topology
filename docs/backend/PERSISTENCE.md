# Persistence and Data Storage (ArcadeDB only)

**Decision status:** Selected for this specification, pending prototype validation. ArcadeDB is the sole authoritative database for registry records and graph traversal; there is no second canonical store or derived graph projection.

## Data model

### Resources and documents
Represent resources as ArcadeDB vertices (for graph-connected resources) with a common `Resource` type and kind-specific types/labels where useful, such as `Service`, `Workload`, `Cluster`, `Database`, `Topic`, and `Queue`. Keep a stable application-level `id` property independent of ArcadeDB internal record IDs. Use ArcadeDB document types for records that do not need graph identity, such as some snapshots, saved views, import runs, and configuration records. Choose vertex vs document deliberately and document it.

Common resource fields include `id`, `kind`, `name`, `environmentId`, `schemaVersion`, `sourceType`, `sourceExternalId`, `createdAt`, and `updatedAt`. Store common queryable fields as explicit typed properties. Keep provider-specific metadata in a validated, versioned JSON/document representation. Promote fields used in frequent filters into indexed properties. Verify how nested maps and JSON payloads are represented by the selected ArcadeDB API/driver; do not assume every query engine exposes them identically. Apply metadata size limits and schema validation.

### Edges and relationships
Represent domain connections as native, directed graph edges with semantic types such as `CALLS`, `DEPENDS_ON`, `RUNS_ON`, `CONTAINS`, `PUBLISHES_TO`, and `CONSUMES_FROM`. Add edge properties such as stable `id`, `environmentId`, `sourceType`, `confidence`, `observedAt`, `createdAt`, and compact metadata as appropriate. The Go domain model uses a normalized `Relationship` DTO independent of ArcadeDB record shapes.

Avoid duplicating an edge as both a native edge and a separate relationship document unless relationships need an independent lifecycle, approvals, or extensive provenance. If an independently addressable relationship record is required, define and test a consistent pattern.

### Other domain data
- Environments may be document records or vertices connected to resources; choose one consistent pattern.
- Topology events and telemetry observations should be append-oriented records with retention/aggregation rules; avoid unbounded arrays on resource vertices.
- Snapshots need explicit size and retention limits. Consider immutable snapshot documents and links to resources, or bounded serialized snapshot payloads.
- Saved views need stable IDs, owner/workspace scope, filters, and layout/camera state separate from resource identity.
- Simulation runs and simulated edges/events must be explicitly marked simulated and never presented as observed telemetry.

## Schema, constraints, and indexes
Create repeatable, versioned schema initialization. At minimum, enforce uniqueness for resource IDs and other independently identified records where supported; add indexes for `environmentId`, `kind`, `name`, `sourceExternalId`, status/health, and timestamps only where query patterns justify them. Validate exact index/constraint syntax and uniqueness behavior for the selected ArcadeDB version in integration tests. Initializers must be idempotent and must not delete user data. Use additive migrations where possible and document breaking changes.

## Transaction and write flow
1. Parse and validate commands at the HTTP boundary.
2. Apply domain invariants in Go.
3. Execute related graph/document writes in an explicit ArcadeDB transaction through the chosen API/client.
4. Use stable IDs and the database's supported upsert/unique semantics deliberately; test concurrent duplicate writes.
5. Commit before returning success. Retry only classified transient errors and only when operation semantics are safe to retry.
6. Use bounded batches and deterministic stable IDs for seed/import so repeated runs are safe.

There is no cross-database outbox or graph-projection rebuild process. Provide a documented local reset/reseed process and production backup/restore runbook. External event delivery, if added later, needs its own durable delivery design and must not be confused with database projection synchronization.

## Query routing and API behavior
All resource registry, detail, topology, relationship, path, impact, snapshot, and saved-view operations use ArcadeDB through repository/query interfaces. Use indexed lookups for registry entry points, then bounded graph traversals for graph operations.

Required query classes include direct upstream/downstream neighbors; bounded dependency neighborhoods; shortest or constrained paths between stable resource IDs; downstream blast radius; and filtered topology subgraphs by environment, resource kind, relationship type, and health/status.

Choose one primary query language for the application and standardize it in the adapter. ArcadeDB supports multiple query languages, including SQL and Cypher, but syntax, supported features, parameter binding, and behavior can differ. The initial implementation should use the language demonstrated by the selected client/API, and integration-test each query. Parameterize values; validate dynamic type names against a server-side allowlist. Enforce depth, result-count, timeout, and authorization limits. If ArcadeDB is unavailable, return a clear dependency error rather than a silently incomplete graph. Check response truncation indicators if using the HTTP driver/API.

## Example API resource envelope
```json
{
  "id": "service:payments-api",
  "kind": "service",
  "name": "Payments API",
  "environmentId": "env:development",
  "metadata": { "team": "payments", "language": "go" },
  "schemaVersion": 1,
  "source": { "type": "mock", "externalId": "payments-api" },
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

Keep API DTOs and Go domain structs independent from driver-specific records. Normalize source/provenance and schema-version handling in the application layer. Reject unsupported metadata rather than silently dropping it.

## Operations and recovery
- Back up ArcadeDB using the selected deployment's supported backup procedure and regularly test restore. Persist the database directory in Docker/Kubernetes.
- Monitor availability, HTTP/client errors, transaction failures, query latency, timeouts, memory, disk, and connection behavior.
- Use supported explain/profile tools and representative data to tune queries and indexes.
- Keep telemetry/event retention bounded; never store the entire graph as one document or unbounded payload.
- Include local seed/reset workflow and production recovery runbook.
- Reassess the single-database decision only through an ADR backed by measured limitations or concrete operational requirements.
