# Benchmarks

Recorded measurements for ADR-005 (250 visible nodes / 750 edges; 1,000 entities navigable). Re-run and append; do not overwrite older results.

## How to run
- Layout and graph-model timings (Node, single thread, bundled ELK): `npm run bench`
- In-browser end-to-end timings (production build, headless Chrome):
  ```sh
  npm run build && npx vite preview --port 4173 &
  npm run bench:browser -- --url http://localhost:4173 --runs 20
  ```
- Fixtures: `?dataset=scale-250` (exactly 250 nodes / 750 edges in production) and `?dataset=inventory-1000` (1,007 service instances and resources over three environments; 321 registry rows in production). Generator: `src/data/mock/generateTopology.ts` (deterministic).

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
