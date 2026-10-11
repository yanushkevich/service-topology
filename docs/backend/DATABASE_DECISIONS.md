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

## ADR-DB-002: ArcadeDB adapter conventions (2026-10-11, Milestone B2)

**Status:** Accepted (implemented in `backend/internal/adapters/arcadedb`).

### Decisions
- **Query language: SQL only.** All statements use ArcadeDB SQL over the HTTP API with named parameters (`:name`). `ARCADEDB_QUERY_LANGUAGE` accepts only `sql`; another language needs an ADR and its own integration tests.
- **No driver dependency.** A small `net/http` client (`client.go`) covers exactly what is used: `exists`, server `create`/`drop database`, `query`, `command`, and session transactions (`begin` → `arcadedb-session-id` header → `commit`/`rollback`). Verified behaviour against 26.10.1: a failed command inside a session aborts the whole transaction, so a later commit fails and nothing partial is committed.
- **Statement safety.** Values are always bound parameters. Type and property names come from constants and the domain types' JSON tags, checked against `^[A-Za-z][A-Za-z0-9]*$`; database names are checked before use in server commands (which cannot bind parameters).
- **Import semantics.** `ReplaceTopology` validates with `domain.Validate`, then in one transaction deletes the canonical vertices (which removes their edges) and recreates them. Rerunning the same input yields the same state (idempotent seed). Snapshots and layouts are separate types and untouched. Each `CREATE EDGE` must create exactly one edge; zero is an error (no silent dangling references).
- **Storage shape.** Every canonical field is stored as a property (maps and lists as embedded values); backend-only properties `ord` (collection order), `recordedAt`, `sourceType` are stripped on read. Reads decode strictly into the domain types, so an unexpected stored field is an error. A round trip of the shared mock fixture is byte-for-byte equal as JSON (integration test).
- **Truncation.** Every query sends `limit` 100,000 and fails with `ErrTruncated` when ArcadeDB reports `truncated: true`; partial graphs are never returned as complete.
- **Schema versioning.** Idempotent DDL plus a `SchemaInfo` document holding `version` (currently 1). The backend refuses a database with a newer version. Readiness requires the schema to be initialized; the API initializes it in the background and retries every 5 s while the database is unavailable.
- **Errors.** Duplicate keys → `ErrConflict`; 401/403 → `ErrAuth`; missing database → `ErrDatabaseNotFound`; 5xx, timeouts, and connection failures → `ports.ErrUnavailable`. Error strings never contain credentials, statements, or parameter values (unit tests).

### Consequences
- Imports are whole-topology replacements, which suits mock and fixture data. Incremental, per-source upserts arrive with provider adapters (future milestone) and need their own ADR.
- Reads of the full topology run inside a session so the collections come from one state.
