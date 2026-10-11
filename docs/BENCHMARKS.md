# Benchmarks

Recorded measurements for ADR-005 (250 visible nodes / 750 edges; 1,000 entities navigable). Re-run and append; do not overwrite older results.

## How to run
- Layout and graph-model timings (Node, single thread, bundled ELK): `npm run bench`
- In-browser end-to-end timings (production build, headless Chrome):
  ```sh
  npm run build && npx vite preview --port 4173 &
  npm run bench:browser -- --url http://localhost:4173 --runs 20
  ```
- Fixtures: `?dataset=scale-250` (exactly 250 nodes / 750 edges in production) and `?dataset=inventory-1000` (1,007 service instances and resources over three environments; 321 registry rows in production). Generator: `apps/web/src/data/mock/generateTopology.ts` (deterministic).

## 2026-10-11 — Milestone 2

**Environment:** Apple M2, 8 cores, 8 GB, macOS (Darwin 27.0.0), Chrome 154.0.8037.98 headless, 1440×900, DPR 1, production build via `vite preview`. **Caveat:** the machine was not idle (other apps at ~170% CPU, load average ≈ 5), and headless Chrome rasterizes in software. Treat absolute numbers as indicative; they vary between runs (see below).

### Node (`npm run bench`) — median of 10–50 runs
| Case | Median | p95 |
|---|---|---|
| ELK layout 250/750, topology | 357 ms | 385 ms |
| ELK layout 250/750, infrastructure (nested groups) | 1,374 ms | 1,441 ms |
| Graph model 250/750 (no layout) | 0.4 ms | 0.6 ms |
| Search filter over the 1,000-entity inventory | 0.5 ms | 0.7 ms |
| 1,000 inventory grouped + collapsed to providers | 1.0 ms | 1.7 ms |

ELK tuning: `considerModelOrder: NODES_AND_EDGES` made layout ~10× slower (5.6 s → 0.53 s without it) and was removed; `layered.thoroughness: 3` (default 7) gives ~1.5× more speed with the same output size on the mock fixture.

### Browser (`npm run bench:browser`, two consecutive runs, 20 samples)
| Case | Run 1 median / p95 | Run 2 median / p95 |
|---|---|---|
| 250/750: navigation → map painted | 1,034 / 1,163 ms | 1,039 / 1,094 ms |
| 250/750: ELK worker layout incl. transfer | 528 / 662 ms | 534 / 553 ms |
| 250/750: rendered elements | 250 nodes / 750 edges | 250 / 750 |
| 250/750: select node → inspector + highlight painted | 210 / 281 ms | 190 / 312 ms |
| 250/750: filter toggle → state/UI updated (excl. layout) | 42 / 143 ms | 34 / 166 ms |
| 250/750: filter toggle → relaid out and painted | 567 / 601 ms | 462 / 570 ms |
| 250/750: wheel-zoom frame interval | 50 ms (18.5 fps) | 67 ms (17.3 fps) |
| 1,000 inventory: navigation → "too many" guard | 320 / 338 ms | 319 / 330 ms |
| 1,000 inventory: group by provider → painted | 227 / 228 ms | 228 / 234 ms |
| 1,000 inventory: registry first paint (321 rows) | 304 ms | 305 ms |
| 1,000 inventory: registry search keystroke → rows | 16 / 54 ms | 11 / 32 ms |

Variance note: an isolated steady-state selection test on the same build (12 selections after a 5 s settle, one tab) measured **73 ms (dark) / 83 ms (light) median**, and an earlier full-script run measured 60 fps zoom (16.7 ms frames). The full script's later runs are slower; the cause was not isolated (machine load, headless frame scheduling). Re-measure on an idle machine or CI before treating selection or zoom numbers as final.

### Assessment against ADR-005
- **250 / 750 renderable:** yes; all 250 nodes and 750 edges render; initial paint ≈ 1.0 s including worker layout.
- **< 100 ms UI/state response excluding layout:** filter state update ≈ 34–42 ms median (meets). Selection: 73–83 ms median in the isolated test, 190–210 ms in the full script (inconclusive; see variance note).
- **1,000 entities navigable:** yes, via the >300-node guard, search (sub-ms model), filters, provider grouping with collapse (5 nodes), and neighborhood exploration; registry search ≈ 10–16 ms per keystroke.
- **Layout runtime:** 0.36 s (topology) / 1.37 s (grouped) in Node; ≈ 0.53 s topology in the browser worker, off the main thread.

Optimizations applied during measurement: ELK in a Web Worker; lazy-loaded map chunk; dimming via one container class instead of per-element data; unchanged React Flow node/edge objects reused; opacity transitions removed from nodes/edges (~50 ms per selection).

## 2026-10-11 — Milestone 4 (3D galaxy)

Run: `npm run bench:3d -- --url <preview-url>` (`apps/web/scripts/bench-3d.mjs`; add `--gpu` on a machine with a GPU).

**Environment:** Apple M2, 8 cores, 8 GB, macOS, Chrome 154 headless, 1440×900, scene DPR capped at 1.75, production build. **WebGL renderer: SwiftShader (CPU software rendering)**, because headless Chrome here has no GPU. The machine was heavily loaded by other apps (load average ≈ 20). These numbers are a pessimistic floor, not representative of a GPU-equipped browser.

| Case | Result |
|---|---|
| 250/750 fixture: entities in the overview | 254 (250 entities + 4 constellation anchors) |
| 250/750: navigation → 3D scene drawn | 1,839 ms (median of 3) |
| 250/750: frame interval, idle with simulated traffic particles | 133 ms median (~7.5 fps) |
| 250/750: frame interval while orbiting | 167 ms median (~6 fps) |
| 250/750: Explore inside → new scope shown (includes the ~0.6 s dive animation) | 1,067 ms |
| 250/750: select entity → inspector + highlight drawn | not measured (harness step timed out; the step is non-fatal) |
| 1,000 inventory: navigation → aggregated overview drawn | 1,004 ms; 5 constellation nodes for 319 matching entities |

Assessment: the 250/750 fixture renders completely in 3D and stays interactive, but frame rate on software WebGL is far below 60 fps. **GPU measurement is still needed** before claiming the 3D target. Product owner accepted current performance for now (2026-10-11). Mitigations already in place: on-demand rendering when nothing animates, instanced arrows/particles, one line object per edge kind, label level-of-detail, and aggregation above 250 nodes.



## 2026-10-11 — Backend B4 (Go API on ArcadeDB)

**How to run:** `cd backend && make dev-up && make bench` (`cmd/apibench`: loads `fixtures/topology/inventory-1000.v1.json` into a temporary database, serves the real HTTP handler in-process, 3 warm-ups + 30 timed requests per row, drops the database).

**Conditions:** Apple M2, 8 cores, 8 GB; Go 1.27.2; ArcadeDB 26.10.1 in Rancher Desktop (Docker 29.1.3, 2 GB VM shared with k3s and other containers; ArcadeDB capped at a 384 MB heap, Serial GC, `mem_limit` 768 MB). Client and API on the host, database in the VM. Dataset: 768 instances, 239 resources, 2,100 relationships (no event types in generated data). Not an idle machine: treat as indicative.

Import (`seed load`, one statement per record in one transaction): 4.4–5.4 s for ~3,100 records.

| Request (worst-case start entities) | p50 before cache | p50 with revision cache | p95 with cache | Response |
|---|---|---|---|---|
| `GET /topology` (all) | 87.3 ms | 5.8 ms | 6.7 ms | 1,187 KB |
| `GET /topology?environmentId=` | 87.2 ms | 3.9 ms | 4.9 ms | 424 KB |
| `GET /registry` page of 100, sort name | 81.8 ms | 3.4 ms | 5.1 ms | 28 KB |
| `GET /registry` search (q + filters) | 83.6 ms | 2.5 ms | 3.9 ms | 13 KB |
| `GET /topology/dependencies` upstream, depth 10 (busiest caller) | 24.0 ms | 23.9 ms | 27.4 ms | 93 KB |
| `GET /topology/dependencies` downstream, depth 10 (most-called resource) | 55.2 ms | 55.5 ms | 62.5 ms | 146 KB |
| `GET /topology/neighborhood` depth 3 | 11.0 ms | 10.8 ms | 13.3 ms | 16 KB |
| `GET /topology/impact` (largest container unavailable) | 89.2 ms | 5.5 ms | 6.1 ms | 231 KB |
| `GET /event-types` | 83.9 ms | 2.0 ms | 2.4 ms | <1 KB |

Breakdown before caching (median): reading the full topology from ArcadeDB 85.9 ms; index, registry rows, and sort in Go 3.3 ms. With the cache, the read is a revision lookup (1.5 ms).

Query-plan review (`EXPLAIN`, printed by `make bench`):
- ID lookups use the unique indexes (`FETCH FROM INDEX ServiceInstance[id]`).
- `TRAVERSE … MAXDEPTH n STRATEGY BREADTH_FIRST` starts from an index lookup.
- Loading relationships between traversed entities did a **full scan of `COMMUNICATES`**; schema v3 adds indexes on `sourceEntityId`/`targetEntityId` (plan now `FETCH FROM INDEX COMMUNICATES[targetEntityId]`). No measurable latency change at 2,100 relationships; it keeps the query from growing with the total edge count.

Assessment: with the revision cache, every full-topology endpoint answers in under 7 ms (p95) at 1,000 entities. Bounded traversals (11–56 ms) are now the slowest; their cost follows the size of the traversed neighbourhood, not the inventory (ADR-DB-003). Not yet measured: concurrency, larger inventories, a production-like database host.

## 2026-10-11 — Backend B6 (concurrency, traversal source)

Same machine and conditions as "Backend B4" (`make bench BENCHFLAGS="-c 8 -n 25"`, 8 concurrent clients × 25 timed requests per row after 3 warm-ups; requests/s is wall-clock throughput for the row).

| Request (1,000 entities) | 8 clients, traversal in database: p50 / p95 / req/s | 8 clients, traversal in memory (default): p50 / p95 / req/s | 1 client, memory: p50 / p95 |
|---|---|---|---|
| `GET /topology` (all) | 21.3 / 33.1 ms / 177 | 18.1 / 26.0 ms / 184 | 9.1 / 16.7 ms |
| `GET /registry` page of 100 | 13.0 / 19.2 ms / 590 | 15.9 / 26.3 ms / 468 | 3.9 / 5.5 ms |
| `GET /topology/dependencies` upstream, depth 10 | 135.1 / 269.4 ms / 52 | 16.5 / 28.8 ms / 422 | 3.9 / 5.2 ms |
| `GET /topology/dependencies` downstream, depth 10 | 382.1 / 907.1 ms / 18 | 20.1 / 27.4 ms / 377 | 5.5 / 6.7 ms |
| `GET /topology/neighborhood` depth 3 | 69.8 / 123.2 ms / 106 | 10.6 / 20.0 ms / 687 | 2.7 / 7.1 ms |
| `GET /topology/impact` | 21.8 / 33.3 ms / 332 | 19.6 / 30.3 ms / 378 | 7.0 / 10.3 ms |
| `GET /event-types` | 13.6 / 25.0 ms / 542 | 8.1 / 14.6 ms / 870 | 2.9 / 5.6 ms |

Outcome: traversal now runs on the cached index by default (ADR-DB-003 amendment). No ArcadeDB restarts or OOM kills during the runs. Rows without traversal differ between columns only by run-to-run noise on a shared VM.
