# Database Decision Record

**Current database: MongoDB 8.0 (ADR-DB-004, root ADR-019).** ADR-DB-001 to ADR-DB-003 record the ArcadeDB period (Milestones B1–B6) and are superseded except where ADR-DB-004 carries a rule forward.

## ADR-DB-001: ArcadeDB as the single authoritative database

**Status:** Superseded by ADR-DB-004 (2026-10-11). Was: selected for this specification and adopted for the monorepo by root ADR-015 (2026-10-11); validate a working prototype, current release compatibility, operational fit, and representative query performance before production commitment.

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

**Status:** Superseded by ADR-DB-004 (the ArcadeDB adapter was removed). Was implemented in `backend/internal/adapters/arcadedb`.

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

## ADR-DB-003: Bounded traversal in the database, results computed in Go, revision-cached reads (2026-10-11, Milestone B4)

**Status:** Superseded by ADR-DB-004, which keeps its traversal split, bounds, and revision cache and replaces `TRAVERSE` with `$graphLookup`. Measurements in `docs/BENCHMARKS.md` "Backend B4".

### Decisions
- **Traversal split.** The database fetches the bounded subgraph (`TRAVERSE out|in|both("COMMUNICATES") … MAXDEPTH n STRATEGY BREADTH_FIRST`, capped at 5,000 visited entities, then the relationships among them through the new endpoint indexes). Go computes the exact client result on that subgraph (`DependencyTree`, `Neighborhood`). Shortest paths up to the bound are identical to the full graph; verified on 918 traversals (every mock entity, both directions, depths 1/2/10, neighbourhoods 1–3, and a sample of the 250-entity dataset).
- **Why not compute the order in SQL:** the client's tie-breaks (relationships in collation order, results by depth then collated ID) are part of the contract; reproducing them in SQL would duplicate logic that conformance fixtures already pin in Go.
- **Impact analysis and event flows** need containment and multi-hop callers across the topology, so they run on the full in-memory index (bounded by the topology size, not by a traversal).
- **Revision-cached reads.** Every import writes a random revision to `TopologyState` in the same transaction. Reads fetch the revision (one indexed lookup) in their read session and reuse the cached topology when it is unchanged. Imports from other processes are picked up on the next read (integration test). Cached data is shared and read-only.
- **Bounds:** dependencies `maxDepth` ≤ 10 (default 10), `limit` ≤ 1,000 (default 500, `truncated` flag); neighbourhood depth ≤ 3; impact ≤ 20 roots; 5,000 visited entities per traversal (400 above that).

### Consequences and alternatives
- With the cache, an in-memory traversal on the cached index would be faster at 1,000 entities (milliseconds instead of 11–56 ms). The database traversal is kept because its cost follows the neighbourhood size rather than the inventory size, and it does not require the whole topology in memory. Revisit if traversal latency matters more than memory at the target size (switching is a small change behind `ports.GraphRepository`).
- Imports are one statement per record (about 5 s for 3,100 records). Batch them (e.g. `sqlscript`) if import time matters.

### Amendment (2026-10-11, Milestone B6): traversal in memory by default
Measured with 8 concurrent clients on 1,000 entities (`docs/BENCHMARKS.md` "Backend B6"): database traversal degraded to 382 ms p50 / 907 ms p95 (18 requests/s) for the widest downstream query, while the revision cache already keeps the whole topology in memory, so the database traversal saved no memory. The default is now in-memory traversal on the cached index (`TRAVERSAL_SOURCE=memory`): 20 ms p50 / 27 ms p95 (377 requests/s) for the same query, and 3.9–5.5 ms single-client. `TRAVERSAL_SOURCE=database` keeps the TRAVERSE path for inventories too large to cache; its parity test (918 traversals) still runs. Results are identical by construction (same Go functions, conformance-tested against the client).

## ADR-DB-004: MongoDB as the single authoritative database (2026-10-11)

**Status:** Accepted (product owner direction; root ADR-019). Implemented in `backend/internal/adapters/mongodb`; verified by the integration suite, `make contract-check` (59/59), and benchmarks (`docs/BENCHMARKS.md` "MongoDB").

### Context
ArcadeDB's graph engine had stopped doing load-bearing work: the domain logic (validation, traversal, impact, event flows, simulation) is Go code conformance-tested against the client, and traversal ran on the cached in-memory index by default (ADR-DB-003 amendment). The product owner chose MongoDB and asked to replace ArcadeDB rather than support both.

### Decisions
- **Server and driver.** MongoDB 8.0 (locally `mongo:8.0.30`) with the official Go driver `go.mongodb.org/mongo-driver/v2`. Configuration: `MONGODB_URI` (no credentials allowed in it), `MONGODB_DATABASE`, `MONGODB_USERNAME` + `MONGODB_PASSWORD_FILE` (both or neither), `MONGODB_AUTH_SOURCE`, `MONGODB_TIMEOUT` (per operation, also bounding server selection).
- **Replica set.** Imports, simulation runs, and retention are multi-document transactions (snapshot read concern, majority write concern), which need a replica set. Local development runs a single-node set `rs0` (`backend/docker-compose.yml`; the health check initiates it). The driver retries transactions on transient errors, so transaction bodies are written to be safe to repeat.
- **Collections.** Canonical: `environments`, `serviceDefinitions`, `serviceInstances`, `resources`, `relationships`, `eventTypes`. Each document is the entity's canonical JSON plus `_id` (= its stable ID, so the default unique `_id` index enforces ID uniqueness) and `_meta` (`ord`, `recordedAt`, `sourceType`, and for relationships `endpoints`), which is stripped on read. Others: `topologyState` (revision), `schemaInfo` (version), `snapshots` and `savedLayouts` (`_id`, sort field, `payload`; snapshots also a `summary` for listing), `simulationRuns`, `simulationEvents`, `telemetryObservations` (filter fields + `payload`).
- **Containment and references** (`parentResourceId`, `resourceId`, `serviceDefinitionId`, event channels/producers/consumers) are the canonical reference fields; there are no separate edge collections. `validateTopology` guarantees the references resolve before anything is written.
- **JSON ↔ BSON.** Documents are converted from the domain values' canonical JSON value by value (objects → documents, integers → int64, other numbers → double) and back, never through Extended JSON. User data such as metadata keys `$date`, `$where`, or `a.b` therefore round-trips literally (MongoDB 5.0+ stores `$`-prefixed and dotted field names; tested). Reads decode strictly: an unexpected stored field or BSON type is an error. The shared fixtures round-trip exactly (unit and integration tests).
- **Schema.** `EnsureSchema` creates missing collections, a `$jsonSchema` validator on canonical collections (string `_id` and `id`, `_meta` with its fields), and named indexes (`_meta.ord` on canonical collections; `sourceEntityId`, `targetEntityId`, `_meta.endpoints` on relationships; registry filters; `takenAt`, `createdAt`; unique `(simulationId, seq)` on run records). `schemaInfo.version` restarts at 1 for this layout; a newer version is refused. `seed schema-check` verifies collections, validators, indexes, and version.
- **Traversal.** Default unchanged: in memory on the revision-cached index. `TRAVERSAL_SOURCE=database` uses `$graphLookup` on `relationships` (`connectFromField`/`connectToField` per direction; `_meta.endpoints` for undirected neighbourhoods; `maxDepth` = hops − 1) inside one snapshot transaction, then loads the relationships among the visited entities. Parity: 918 traversals equal the full-graph results (integration test). The 5,000-entity bound still returns `ErrTooLarge`.
- **Queries.** Typed driver filters with input only as values; no `$where`, JavaScript, or query strings; field and collection names are constants. Operator-shaped IDs match nothing (integration test).
- **Errors.** Duplicate keys → `ErrConflict` (message without the key value); authentication failures → `ErrAuth`; network errors, server-selection failures, and timeouts → `ports.ErrUnavailable` (HTTP 503).
- **Rules carried forward from ADR-DB-001–003:** stable application IDs as identity; whole-topology replacement imports in one transaction; strict reads; revision-cached reads; bounded traversal (depth, results, visited entities); explicit transactions with tested rollback.

### Benefits
- A widely used database with mature tooling (Atlas, `mongodump`/`mongorestore`, monitoring), drivers, and hosting options.
- Online backup and restore into a new database without restarting the server.
- The document model matches the canonical JSON one to one; no edge bookkeeping.

### Costs and risks
- No native graph query language: graph questions are answered in Go (default) or with `$graphLookup`, which has no shortest-path or path-returning operator. Path features must be built in Go.
- A replica set is required for transactions, even locally.
- `mongodump` of a single database is not a point-in-time snapshot across collections under concurrent writes; quiesce writes or use storage snapshots for production backups (RUNBOOK).
- A document is limited to 16 MB, which bounds snapshot size (about 1.2 MB for 1,000 entities).
- **Licensing:** MongoDB Community Server is SSPL-1.0. Internal use is unaffected; offering the product as a hosted service to third parties needs a legal review (or MongoDB Atlas / Enterprise). The Go driver is Apache-2.0.

### Alternatives considered
1. Keep ArcadeDB (rejected by the product owner).
2. Keep both behind configuration (rejected: two adapters and integration suites to maintain).
3. MongoDB without transactions (rejected: imports and simulation runs must be all-or-nothing).

