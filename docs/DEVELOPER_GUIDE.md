# Developer Guide

How to run, understand, test, scale, and extend the Service Topology & Registry Platform. Product intent is in `PRODUCT_SPEC.md`, decisions in `DECISIONS.md`, and per-milestone code maps in `ARCHITECTURE.md` ("Milestone N implementation notes").

## 1. Setup

Requirements: Node.js 22+ (developed on Node 26), npm. Dependencies are pinned exactly (`.npmrc`: `save-exact`).

```sh
npm install
npm run dev                # http://localhost:5173
npm run check              # typecheck → lint → test → build (run before every commit)
```

| Script | Purpose |
|---|---|
| `dev`, `build`, `preview` | Vite dev server, production build (`dist/`), serve the build |
| `typecheck`, `lint` | `tsc -b` (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESLint 10 + typescript-eslint |
| `test`, `test:watch` | Vitest + Testing Library (jsdom), including contract and accessibility tests |
| `bench` | Node timings: ELK layout and graph model at 250/750 and 1,000 entities |
| `bench:browser -- --url <preview>` | 2D timings in headless Chrome against the production build |
| `bench:3d -- --url <preview> [--gpu]` | 3D timings (SwiftShader software WebGL unless `--gpu`) |
| `audit:a11y -- --url <preview>` | axe-core (incl. color contrast and target size), focus-visibility Tab pass, reduced motion, in both themes |

URL helpers: `?dataset=scale-250` or `?dataset=inventory-1000` loads generated fixtures. All other state is in the URL (`docs/schemas/topology-url-state.v1.md`), so any view can be shared as a link.

## 2. Architecture in one page

```text
TopologyRepository (mock today, HTTP later)          SnapshotRepository   SavedLayoutRepository
        │ baseline TopologyData                              │                    │
        ▼                                                    │                    │
Simulation engine (pure, seeded) ── useSimulationStore ◄── useSimulationTicker (one interval)
        │ current data                                       │
        ▼                                                    ▼
TopologyDataProvider ── one TopologyIndex (current, or snapshot when `asOf` is set)
        │
        ├─ Registry ── buildRegistryRows / filter / sort ──────────────► table + FilterBar
        ├─ 2D map ── buildTopologyGraph → ELK (Web Worker) → React Flow adapter ─► React Flow
        ├─ 3D galaxy ── resolveGalaxyScope → layoutGalaxy → buildScene ─► React Three Fiber (lazy)
        ├─ Inspector ── canonical lookups + propagation impacts
        └─ Events & Traffic ── engine events, rules, snapshots, diff
Shared cross-view state (Zustand, IDs/options only) ◄─► URL (useUrlStateSync)
```

Rules that keep this working (enforced by tests where marked):
- `src/domain` imports only itself (boundary test). It holds types, validation, index, registry selectors, traversal, propagation, snapshots.
- `src/simulation` imports only the domain (boundary test). No timers or React; the store and ticker live in `src/state`.
- Renderers get view models with canonical IDs. React Flow nodes and Three.js objects never enter domain data or the store. No React state updates in frame callbacks (guard test).
- Containment (`parentResourceId`) and communication (relationships) are never mixed: groups, rings, and spokes vs. paths with arrows.
- Mock/simulated data is labeled everywhere; the word "live" is never used (test).

## 3. State ownership

| State | Owner |
|---|---|
| Topology data | `TopologyDataProvider` (React context), fed by repository + simulation |
| Selection `{kind,id}`, environment, filters, view, layout mode, highlight mode, neighborhood, `asOf`, `galaxyScope`, effective theme, motion pause | `useUiStore` (Zustand), mirrored to the URL except theme and pause |
| Preferences: theme (incl. system), motion override, default view, 3D labels/traffic, default simulation speed | `usePreferencesStore`, saved locally via `PreferencesRepository`; defaults only, never in URLs or canonical data |
| Simulation state and run controls | `useSimulationStore` |
| Viewport, drag positions, collapsed groups, panel open/closed | Component-local (2D map, 3D view) |
| Camera poses per 3D scope | `CameraMemory` in the 3D view |
| Saved layouts, snapshots | Their repositories |

## 4. Styling (Tailwind, ADR-013)
- Tailwind CSS v4 via `@tailwindcss/vite`; entry `src/styles/global.css`. `tokens.css` holds every value; `@theme inline` maps tokens to utilities and `--color-*: initial` disables the default palette, so only token colors exist (`bg-surface-0..3`, `text-fg`/`fg-2`/`fg-3`, `border-line`/`line-strong`/`control`, `bg-accent`, `text-ok-fg`/`warn-fg`/`crit-fg`, `edge-*`).
- One breakpoint: `max-md:` (≤ 760 px). Theme switches by `data-theme` on `<html>`; never use `dark:` variants.
- Reuse `Button`, `Chip`, `Segmented`/`Segment`, `Panel`, `Kicker` (`src/shared/ui/primitives.tsx`) or the class helpers in `classes.ts` (`buttonClass`, `fieldClass`, `kickerClass`, `cx`). Section pages use `PageShell`, `Card`, `Note`.
- State styling uses ARIA/data variants (`aria-pressed:`, `aria-selected:`, `data-[emphasis=dim]`), which double as test hooks. Do not test class names.
- Glyph artwork, status shapes, tags, and React Flow / 3D label overrides live in `@layer components` in `src/styles/components.css`.
- New colors go in `tokens.css` (both themes) and must pass `contrast.test.ts`.

## 5. Testing strategy

| Layer | Where | Notes |
|---|---|---|
| Domain, simulation, layout, scope, scene models | `*.test.ts` next to the code | Pure and deterministic; fixtures from `src/data/mock` |
| Integration (registry, map, events, URL sync, keyboard) | `*.test.tsx`, `src/test/` | `renderApp(path, topologyRepo?, layoutRepo?, snapshotRepo?)` + `resetUiStore()`; use `fireEvent.click` inside the React Flow canvas (user-event's `mousedown` has `view: null`, which d3 cannot handle in jsdom) |
| 3D scene | `GalaxyScene.test.tsx` | `@react-three/test-renderer` (no WebGL); jsdom app tests see the WebGL fallback |
| Contract | `src/contract/contract.test.ts` | ajv against `docs/schemas` and `docs/api/openapi.json` |
| Accessibility | `src/test/a11y.test.tsx`, `keyboard.test.tsx`, `src/styles/contrast.test.ts`; `npm run audit:a11y` in a real browser | jsdom cannot compute contrast; the token test and the browser audit cover it |
| Performance | `npm run bench`, `bench:browser`, `bench:3d` | Results go to `docs/BENCHMARKS.md`, appended, with machine and conditions |

Rules: never claim a check passed without running it; record benchmark conditions; keep fixtures deterministic.

## 6. Scaling

Targets (ADR-005): 250 visible nodes / 750 visible edges; 1,000 entities navigable. Measured results and conditions are in `docs/BENCHMARKS.md`.

Mechanisms in place:
- **2D:** ELK in a Web Worker (layout keyed on structure, so health changes never relayout), React Flow node/edge object reuse, single-class dimming, a >300-node guard with "group by provider (collapsed)", neighborhood exploration, and search/filters.
- **3D:** aggregation above 250 entities, on-demand rendering when nothing animates, instanced arrows and particles, one line object per edge kind, label level of detail, DPR cap 1.75.
- **Registry:** client-side filtering stays around 10 ms per keystroke at 1,000 entities. A backend would use the paginated `/registry` endpoint (`API_CONTRACT.md`).

Next steps if inventories grow: server-side registry search, incremental topology sync (change feed), virtualized registry rows, viewport culling in 2D (`onlyRenderVisibleElements`), and a GPU measurement of the 3D view.

## 7. Extension recipes

**Add a provider** (e.g. `oci`):
1. `PROVIDERS` in `src/domain/types.ts`.
2. `PROVIDER_LABELS` in `src/shared/mappings.ts` and `PROVIDER_GROUP_LABELS` in `graph/topologyGraph.ts`.
3. The `Provider` enum in `docs/schemas/topology.v1.schema.json` and `saved-layout.v1.schema.json` (contract tests fail until these match).
4. Mock data, if useful.

**Add a protocol:**
1. `PROTOCOLS` in `src/domain/types.ts`.
2. `PROTOCOL_LABELS` in `src/shared/mappings.ts`.
3. Map it to an edge kind in `edgeKind()`; edge kinds drive color and dash in 2D, 3D, and the legends.
4. If it is synchronous or data access, add it to the sets in `src/domain/propagation.ts` so failures propagate correctly.
5. Update the schema enum.

**Add a resource type:**
1. `RESOURCE_TYPES`, and `CONTAINMENT_ONLY_RESOURCE_TYPES` if it only contains other things.
2. `TYPE_LABELS` (and `RESOURCE_GROUP` in `domain/registry.ts`).
3. The 2D glyph (`TypeGlyph`) and 3D silhouette (`Shape` in `GalaxyScene.tsx`).
4. The schema enum.
5. If it is a messaging channel, add it to `CHANNEL_TYPES` in propagation and the exchange binding rule in validation, if applicable.

**Add a propagation rule:**
1. Add the ID to `PROPAGATION_RULE_IDS` and an entry to `PROPAGATION_RULES` (when, effect, rationale, transitive).
2. Implement it in `analyzeImpact` / `ruleForCaller`.
3. Add a test per rule in `propagation.test.ts`.

The Events page and inspector explain the new rule automatically.

**Connect a real backend:**
1. Implement `TopologyRepository` (and `SnapshotRepository`, `SavedLayoutRepository`) over HTTP per `API_CONTRACT.md`, validating responses at the boundary.
2. Choose it in `src/data/selectRepository.ts`.
3. Set `isMock: false` and a real `sourceLabel`, and populate `metrics.isSimulated: false` only for observed telemetry.

Nothing in the UI needs to change.

**Add a page:**
1. Add the route in `src/app/routes.tsx` and an entry in `NAV_ITEMS`; the page title is automatic.
2. Wrap content in `PageShell` (heading, data-source tag, loading state, shared inspector). It passes the current `TopologyIndex` (a snapshot when `asOf` is set). Read shared state via `useUiStore`; put derived data in a pure selector in `src/domain`.
3. Add an axe audit case in `src/test/a11y.test.tsx` and a page in `scripts/audit-a11y.mjs`.

**Add a history fixture:** add a variant in `src/data/mock/snapshots.ts`. Tests check validity and that no timestamp is later than `takenAt`.

## 8. Known limitations (current)
- No real integrations, authentication, or tenancy. All data is mock; all telemetry is simulated.
- Performance: 2D selection response and 3D frame rate need re-measurement on an idle machine or with a GPU (`docs/BENCHMARKS.md`).
- Grouped 2D mode at full detail fits at a small zoom; read it collapsed or through the Groups panel. Saved positions do not resize groups.
- 3D: dense 250-node overviews need zooming for member labels; explore deeper than grandchildren by entering further.
- History: captured snapshots last for the session; generated datasets have no history fixtures.
- Propagation is rule-based (no probabilities, retries, or circuit breakers); simulated traffic is metric drift, not request-level traffic.
- Preferences are per browser (localStorage); there is no user account to sync them.
- The Infrastructure tree renders every expanded row (no virtualization); at 1,000 entities use search/filters or collapse levels.
