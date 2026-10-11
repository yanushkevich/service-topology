# Testing, Performance, and Acceptance

## Test layers
1. **Domain unit tests:** validation, stable IDs, enum/unknown handling, parent-cycle detection, typed references, dependency traversal, failure propagation.
2. **Application tests:** filtering, pagination, topology scope, snapshot immutability, deterministic simulation, provenance propagation.
3. **Repository integration tests:** ArcadeDB constraints, transaction rollback, migration compatibility, indexes/query semantics.
4. **HTTP contract tests:** responses validated against `docs/api/openapi.json` and `docs/schemas/*` (the same documents `src/contract/contract.test.ts` uses), status/problem behavior, invalid input and bounds.
4a. **Conformance (parity) tests:** shared fixtures under `fixtures/` (planned): the mock topology, the scale datasets, snapshots, layouts, and one invalid topology per validation rule with its expected codes. The Go validator and `validateTopology` must return identical codes; traversal, neighborhood, dependency, containment, and event-flow results on the mock must equal the TypeScript functions' results.
5. **End-to-end smoke:** startup, readiness, seeded topology, service search, details, relationships, neighborhood, snapshot and layout workflow.
6. **Security tests:** injection-shaped inputs, oversized requests, unauthorized access once auth exists, scope isolation once tenancy exists.
7. **Load/benchmark tests:** record hardware/runtime/database/config, dataset size, request shape, concurrency, p50/p95/p99 latency, throughput, error rate and memory.

## Product scale target inherited from UI docs
- 250 visible nodes / 750 visible edges.
- Navigation across 1,000 total entities via search, filters, grouping and neighborhood exploration.

These are product targets, not existing benchmark results. Establish initial budgets and test them with reproducible fixtures. Backend tests should include topology responses at these sizes and bounded dependency traversal. UI rendering is benchmarked separately (`docs/BENCHMARKS.md`); backend results get their own section there with machine and conditions.

## Initial quality gates
- `gofmt` clean; `go vet ./...` passes.
- `go test ./...` passes, including race-sensitive tests where applicable (`go test -race ./...` in supported CI environments).
- Static analysis/lint is configured and pinned.
- OpenAPI validation passes; migration tests pass.
- `go test -bench` or a repeatable load-test harness produces recorded results before claiming performance.
- Application starts locally using documented instructions; liveness/readiness behave as documented.
- Every test/benchmark status is reported as PASS / FAIL / NOT RUN with exact command and observed output. Never claim a check ran if it did not.

## Suggested baseline performance criteria (proposed; validate against target deployment)
- Avoid arbitrary hard SLA before measuring. First capture baseline on a documented development environment.
- Bound topology responses and neighborhood depth.
- Avoid N+1 query patterns; inspect query plans for main filters.
- Add caching only after measuring a bottleneck and defining invalidation semantics.


## Graph and transaction tests
Test uniqueness constraints, idempotent seed/import, transaction rollback, duplicate-write behavior, relationship endpoint integrity, deletion semantics, schema/index initialization, ArcadeDB unavailable, and consistency of graph reads after committed writes. Test cycle handling, maximum traversal depth, result limits, timeouts, and authorization boundaries. Benchmark representative graph traversals in the selected ArcadeDB query language and inspect query plans; do not assume performance without measurement.
