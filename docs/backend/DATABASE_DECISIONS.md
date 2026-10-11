# Database Decision Record

## ADR-DB-001: ArcadeDB as the single authoritative database

**Status:** Selected for this specification and adopted for the monorepo by root ADR-015 (2026-10-11); validate a working prototype, current release compatibility, operational fit, and representative query performance before production commitment.

### Context
The product needs a registry for heterogeneous resources and flexible provider-specific metadata, while its distinguishing workflows are graph-shaped: service dependencies, infrastructure containment, upstream/downstream impact, paths, neighborhood exploration, and a 2D topology plus a spatial 3D galaxy. Maintaining separate document and graph databases would introduce synchronization and recovery complexity before the workload has been measured.

### Decision
- Use ArcadeDB as the only required database. ArcadeDB supports graph and document models in one engine and transaction.
- Model canonical entities as vertices and canonical relationships as directed edges (`PERSISTENCE.md`: one `COMMUNICATES` edge per relationship, `CONTAINS`/`HOSTED_IN` for containment); use document types for snapshots, layouts, and append-only records.
- Keep stable application-level IDs (`id`) separate from database-internal record IDs. Never expose internal record IDs as public API identifiers.
- Store common queryable fields as typed properties. Keep provider-specific metadata in a validated, versioned document/map representation; promote fields used for filtering or traversal into indexed properties or related records. Confirm nested JSON mapping behavior in integration tests.
- Keep the Go modular monolith responsible for validation, authorization, commands, and persistence interfaces.
- Keep frontend layout/camera state separate from resource identity. Store saved-view data as documents or a deliberate graph representation.
- Start with the ArcadeDB HTTP/JSON API and its supported query endpoint, behind repository/query interfaces. The official generated Go HTTP driver is another option, but verify its current Go toolchain requirement before adopting it.

### Benefits
- One authoritative store for graph relationships and flexible documents.
- Native graph traversal for dependency, path, and neighborhood queries.
- No cross-database projection lag, dual-write workflow, or synchronization/rebuild pipeline.
- Multiple query language options; choose one default for maintainability and use others only for a clear reason.
- Apache License 2.0, a permissive license generally suitable for commercial use; retain license and notice obligations and review bundled dependencies. This is not the MIT License.

### Costs and risks
- ArcadeDB is a smaller ecosystem than some established databases; validate community, support, driver maturity, upgrade practices, and operational tooling.
- The team must learn ArcadeDB's graph/document model and selected query language.
- Query-language compatibility does not guarantee full behavioral compatibility with Neo4j or PostgreSQL; test every required query and transaction behavior.
- Flexible metadata still needs schema validation, indexing strategy, size limits, and versioning.
- Performance depends on data shape, indexes, query cardinality, and bounded traversal; do not rely on vendor benchmarks alone.

### Alternatives considered
1. MongoDB only: strong document-first fit, but graph traversal and path analysis require careful query/application design.
2. ArangoDB only: combines document and graph capabilities; a viable alternative, but ArcadeDB is selected for this specification.
3. Neo4j only: graph-first model and ecosystem; compare with a representative prototype if graph query maturity/support outweighs multi-model consolidation.
4. PostgreSQL with JSONB: strong relational constraints and transactions, but not the preferred initial model for graph-centric behavior.

### Consequences and guardrails
- Use parameterized query values; never concatenate untrusted input into SQL, Cypher, or other query strings. Map dynamic type/label names through a strict server-side allowlist.
- Define uniqueness constraints for stable IDs and indexes for frequent registry filters; verify supported syntax and semantics against the chosen ArcadeDB version.
- Bound traversal depth, result count, query time, and authorization scope. Never return the entire graph by default.
- Use explicit transactions for multi-step graph writes and test rollback behavior.
- The initial UI targets remain 250 visible nodes, 750 visible edges, and navigation across 1,000 entities. Treat these as benchmark targets, not guarantees.
- ArcadeDB is Apache-2.0 licensed, not MIT. If MIT is a strict legal requirement, this decision does not satisfy it.
