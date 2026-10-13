# Developer Guide

How to run, understand, test, scale, and extend the Service Topology & Registry Platform. Product intent is in `PRODUCT_SPEC.md`, decisions in `DECISIONS.md`, and per-milestone code maps in `ARCHITECTURE.md` ("Milestone N implementation notes").

## 1. Setup

Requirements: Node.js 22+ (developed on Node 26), npm. Dependencies are pinned exactly (`apps/web/.npmrc`: `save-exact`). The frontend lives in `apps/web/`; the Go backend in `backend/` (`docs/backend/`).

```sh
cd apps/web
npm install
npm run dev                # http://localhost:5173
npm run check              # typecheck → lint → test → build (run before every commit)
```

From the repository root, `npm run dev|build|test|check` forward to `apps/web`, and `npm run check:all` runs the frontend and backend checks.

**Run against the Go backend:** in `backend/`, `make dev-up && make seed && make run` (see `docs/backend/LOCAL_DEVELOPMENT.md`), then open `http://localhost:5173/map?source=api`. The HTTP repositories (`apps/web/src/data/http/`) replace the in-memory ones; simulation still runs in the browser (ADR-017). The `source` parameter stays in the URL across navigation and reloads.

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
        ├─ Events ── eventFlowsIn / resolveEventFlow ─► catalog; eventFlowReach ─► 2D/3D highlight
        └─ Simulation ── engine events, rules, snapshots, diff
Shared cross-view state (Zustand, IDs/options only) ◄─► URL (useUrlStateSync)
```

Rules that keep this working (enforced by tests where marked):
- `apps/web/src/domain` imports only itself (boundary test). It holds types, validation, index, registry selectors, traversal, propagation, snapshots.
- `apps/web/src/simulation` imports only the domain (boundary test). No timers or React; the store and ticker live in `apps/web/src/state`.
- Renderers get view models with canonical IDs. React Flow nodes and Three.js objects never enter domain data or the store. No React state updates in frame callbacks (guard test).
- Containment (`parentResourceId`) and communication (relationships) are never mixed: groups, rings, and spokes vs. paths with arrows.
- Mock/simulated data is labeled everywhere; the word "live" is never used (test).

## 3. State ownership

| State | Owner |
|---|---|
| Topology data | `TopologyDataProvider` (React context), fed by repository (in-memory mock or HTTP backend with `?source=api`) + simulation |
| Selection `{kind,id}`, environment, filters, view, layout mode, highlight mode, neighborhood, `asOf`, `galaxyScope`, `eventHighlight`, effective theme, motion pause | `useUiStore` (Zustand), mirrored to the URL except theme and pause |
| Preferences: theme (incl. system), motion override, default view, 3D labels/traffic, default simulation speed | `usePreferencesStore`, saved locally via `PreferencesRepository`; defaults only, never in URLs or canonical data |
| Simulation state and run controls | `useSimulationStore` |
| Viewport, drag positions, collapsed groups, panel open/closed | Component-local (2D map, 3D view) |
| Camera poses per 3D scope | `CameraMemory` in the 3D view |
| Saved layouts, snapshots | Their repositories |

## 4. Styling (Tailwind, ADR-013)
The full rules, the component catalog, and the review checklist are in `CONVENTIONS.md` (§3.3–§3.4); this section is the summary.
- Tailwind CSS v4 via `@tailwindcss/vite`; entry `apps/web/src/styles/global.css`. `tokens.css` holds every value; `@theme inline` maps tokens to utilities and `--color-*: initial` disables the default palette, so only token colors exist (`bg-surface-0..3`, `text-fg`/`fg-2`/`fg-3`, `border-line`/`line-strong`/`control`, `bg-accent`, `text-ok-fg`/`warn-fg`/`crit-fg`, `edge-*`).
- One breakpoint: `max-md:` (≤ 760 px). Theme switches by `data-theme` on `<html>`; never use `dark:` variants.
- Reuse `Button`, `Chip`, `Segmented`/`Segment`, `Panel`, `Kicker` (`apps/web/src/shared/ui/primitives.tsx`) or the class helpers in `classes.ts` (`buttonClass`, `fieldClass`, `kickerClass`, `cx`). Section pages use `PageShell`, `Card`, `Note`.
- State styling uses ARIA/data variants (`aria-pressed:`, `aria-selected:`, `data-[emphasis=dim]`), which double as test hooks. Do not test class names.
- Glyph artwork, status shapes, tags, and React Flow / 3D label overrides live in `@layer components` in `apps/web/src/styles/components.css`.
- New colors go in `tokens.css` (both themes) and must pass `contrast.test.ts`. Literal colours anywhere else in TypeScript fail `rawColors.test.ts`; the only exception is the 3D palette in `features/service-map/galaxy/palette.ts` (WebGL cannot read CSS variables).
- Forms use `shared/ui/form.tsx`; boards use the kit in `features/boards/`.

## 5. Testing strategy

| Layer | Where | Notes |
|---|---|---|
| Domain, simulation, layout, scope, scene models | `*.test.ts` next to the code | Pure and deterministic; fixtures from `apps/web/src/data/mock` |
| Integration (registry, map, events, URL sync, keyboard) | `*.test.tsx`, `apps/web/src/test/` | `renderApp(path, topologyRepo?, layoutRepo?, snapshotRepo?)` + `resetUiStore()`; use `fireEvent.click` inside the React Flow canvas (user-event's `mousedown` has `view: null`, which d3 cannot handle in jsdom) |
| 3D scene | `GalaxyScene.test.tsx` | `@react-three/test-renderer` (no WebGL); jsdom app tests see the WebGL fallback |
| Contract | `apps/web/src/contract/contract.test.ts` | ajv against `docs/schemas` and `docs/api/openapi.json` |
| Shared fixtures | `apps/web/src/contract/fixtures.test.ts` | Exports `fixtures/` for the Go backend and fails on drift; `npm run fixtures:update` after changing the mock or validation |
| Accessibility | `apps/web/src/test/a11y.test.tsx`, `keyboard.test.tsx`, `apps/web/src/styles/contrast.test.ts`; `npm run audit:a11y` in a real browser | jsdom cannot compute contrast; the token test and the browser audit cover it |
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
1. `PROVIDERS` in `apps/web/src/domain/types.ts`.
2. `PROVIDER_LABELS` in `apps/web/src/shared/mappings.ts` and `PROVIDER_GROUP_LABELS` in `graph/topologyGraph.ts`.
3. The `Provider` enum in `docs/schemas/topology.v1.schema.json` and `saved-layout.v1.schema.json` (contract tests fail until these match).
4. Mock data, if useful.

**Add a protocol:**
1. `PROTOCOLS` in `apps/web/src/domain/types.ts`.
2. `PROTOCOL_LABELS` in `apps/web/src/shared/mappings.ts`.
3. Map it to an edge kind in `edgeKind()`; edge kinds drive color and dash in 2D, 3D, and the legends.
4. If it is synchronous or data access, add it to the sets in `apps/web/src/domain/propagation.ts` so failures propagate correctly.
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

**Backend integration (done in B6):** HTTP implementations of `TopologyRepository`, `SnapshotRepository`, and `SavedLayoutRepository` live in `apps/web/src/data/http/` and are chosen by `selectRepository` (`?source=api` / `VITE_DATA_SOURCE=api`). Responses are validated at the boundary (`parseSnapshot`, `parseSavedLayout`, `validateTopology` in the provider). The label and `isMock` come from `GET /api/v1/meta`: data stays labelled mock unless the backend reports an observed source.

**Add a page:**
1. Add the route in `apps/web/src/app/routes.tsx` and an entry in `NAV_ITEMS`; the page title is automatic.
2. Wrap content in `PageShell` (heading, data-source tag, loading state, shared inspector). It passes the current `TopologyIndex` (a snapshot when `asOf` is set). Read shared state via `useUiStore`; put derived data in a pure selector in `apps/web/src/domain`.
3. Add an axe audit case in `apps/web/src/test/a11y.test.tsx` and a page in `apps/web/scripts/audit-a11y.mjs`.

**Add an event type:** add an `EventType` to the topology (mock: `eventTypes` in `apps/web/src/data/mock/topology.ts`) with its channel per environment and producer/consumer service definitions. The relationships must already exist (producer → channel, channel → consumer, or via a queue bound to an exchange); `validateTopology` reports any mismatch.

**Add a history fixture:** add a variant in `apps/web/src/data/mock/snapshots.ts`. Tests check validity and that no timestamp is later than `takenAt`.

## 7a. Editing (ADR-020)
- `apps/web/src/features/editing/`: `entityForms.ts` (pure form model: fields per kind with options from the topology, values ↔ entities, `applyChange`, `newIssues`), `EntityEditorProvider.tsx` (opens forms; availability), `EntityEditorDialog.tsx`, `DeleteEntityDialog.tsx`, `EditingControls.tsx` (New menu, inspector actions), `shared/ui/Modal.tsx` (focus trap, Escape, focus return).
- Writes go through `TopologyRepository.writer`: HTTP with `?source=api`, the local sandbox with the built-in mock data (ADR-031), and `undefined` for generated datasets. `TopologyDataProvider` exposes `useTopologyEditing()` with the stored `baseline` and `reload()`.
- Tests use `src/test/writableRepository.ts`, an in-memory writer that validates like the server. To check against the real backend: `npm run check:live -- --url <preview-url> [--write]` (`--write` changes data; use a disposable database).
- Adding a field to an entity: update `fieldsFor` and the schema/types together; the form round-trip test in `entityForms.test.ts` catches fields that do not survive values ↔ entity.

## 7b. Transit board (ADR-021)
- **Read model:** `apps/web/src/transit/` holds a per-service read model, separate from `src/domain`. `computeMapGeometry` is pure and runs once per data load. Selection, search, and finding focus only change attributes in `TransitMap`; `TransitBoardPage.test.tsx` checks that the `<path>` nodes are not rebuilt.
- **Adding a board:** implement `TransitRepository.getBoard` (`src/transit/repository.ts`). Phase 1 serves only Payment Service example data. Tests inject a repository through `renderApp`'s fifth argument.
- **Replay clock:** `features/transit-board/playback.ts` is a store local to the board, read with `usePlayback(selector)`. Each frame updates only its subscribers (train, progress, active step), never the map; it is not Zustand.
- **URL state:** page-local parameters (`line`, `mode`, `trace`, `t`, `window`) are kept by `useUrlStateSync` only on `/services/…` routes (`PAGE_PARAMS`).
- **Colours:** `--transit-*` tokens, tested in `contrast.test.ts`.
- **Tests:** query board panels within their landmark (`[aria-label="Lines"]` and so on). Role queries over the whole page walk every SVG element of the map and are slow in jsdom.

## 7b.1 Authoring boards and the sandbox (ADR-031)
- **Definition first.** A field added to a board definition goes into `transit/definition.ts` (type, `definitionOf`, and the rule if it has one), the schema `docs/schemas/transit-board-definition.v1.schema.json`, and the Go type in `backend/internal/domain/board.go`. A new rule also needs a case in `boardCases()` (`src/contract/fixtures.test.ts`); run `npm run fixtures:update`, then `make -C backend check`.
- **Stores.** Code reads and writes boards through `BoardStore` only; tests use `createSandbox(base, createSandboxStorage(null))` for an in-memory store.
- **Sandbox in the browser.** Its data lives under `service-topology.sandbox.v1`; Settings → "Reset sandbox" clears it. It resets itself when the built-in mock changes.
- **Against the backend:** create, edit, and delete a board on a disposable database (`MONGODB_DATABASE=…`, password only through `MONGODB_PASSWORD_FILE`), then drop it with `backend/scripts/mongosh.sh`.

## 7b.2 Data bundles (ADR-032)
- **A new data module** (a new top-level kind of data) must be added to:
  - `BUNDLE_MODULES` (`data/bundle/bundle.ts`);
  - the bundle schema (`docs/schemas/data-bundle.v1.schema.json`; the contract test compares the keys);
  - `bundleModules` in `backend/internal/domain/bundle.go`, and the MongoDB `ReplaceAll`.

  Then add a case to `bundleCases()` and run `npm run fixtures:update`.
- **Testing downloads in jsdom:** stub `URL.createObjectURL` and `HTMLAnchorElement.prototype.click` (see `DataBundleRows.test.tsx`). Upload files with `user.upload` on the "Data file" field.
- **Against the backend:** export from Settings with `?source=api`, edit the file, and import it on a disposable database. An import replaces everything, boards included.

## 7b.3 Quick search and UI conventions (ADR-033, Milestone 11.6)
- **Quick search.** `features/search/quickSearch.ts` builds the items (entities in the environment, business flows, event types, board endpoints, pages) and ranks matches; `QuickSearchDialog.tsx` is the combobox. To make a new kind of thing findable, add a `SearchTarget` kind, its items in `searchItems`, a heading in `SEARCH_GROUPS`, and where it opens in `locationOf`.
- **The header search does not filter.** Pages that filter (map, registry, infrastructure) use their own `FilterBar`; the quick search sets the shared filter only through its "Filter the registry" option.
- **Truncated text** gets its full text as a tooltip from `useTruncationTitles` (in `AppShell`). Use `truncate` as usual; do not add `title` by hand unless the tooltip should say more than the text.
- **The inspector** takes `hideWhenEmpty` on pages where selecting is rare.
- **3D labels** are decluttered by `LabelLayer` (`galaxy/labelLayer.ts`); its overlap rule is the pure `hiddenLabels`.
- **The real-browser audit** can open a dialog before auditing: a page entry's `then` runs in the page, and `after` is awaited.

## 7c. Business flows (ADR-022)
- **Domain:** flows are canonical (`BusinessFlow` in `src/domain/types.ts`). Change the validation rules in `src/domain/validation.ts` and `backend/internal/domain/validation.go` together. Add a case to `CASES` in `src/contract/fixtures.test.ts` and run `npm run fixtures:update`; the Go conformance test then enforces parity.
- **Layout (ADR-023):** the board draws one flow as swimlanes.
  - `computeSwimlanes` (`src/transit/flows/swimlane.ts`) is pure and routes every edge.
  - `features/business-flows/swimlaneAdapter.ts` turns it into React Flow elements once per flow.
  - Pass view state (selection, focus, search, replay) through `applyView`, never through positions.
  - A new node or edge style goes in `SwimlaneParts.tsx` with a data attribute for tests.
  - Observed data and transactions come from `TransitRepository` (`getFlowStats`, `getTransactions`, `getTransaction`); the example implementation is `src/transit/flows/exampleFlows.ts`.
- **Patterns (ADR-024):** add a pattern to `src/domain/patterns.ts`.
  - If flows can carry it, also add it to `FLOW_POLICY_TYPES`, the schema enumeration, and `backend/internal/domain/fields.go`.
  - Add a `--transit-policy-<id>` token in both themes; the contrast test reads the list from code.
  - Run `npm run fixtures:update`.
- **Steps ↔ lines:** `lineForStep` is the only rule. The service board lists flows through `flowsOnService`.
- **Data stores (ADR-027):**
  - Link a service-board dependency with `entityId` (a service definition or resource ID); never match by name.
  - Declare a database's tables on the board (`tables`), with writer and reader lines that reach the station. `tables.test.ts` checks this on the example.
  - Flow steps get their stores from `dataStoresOf` (topology relationships).
- **Endpoint contracts (ADR-029):**
  - Add a service's OpenAPI document as `src/contracts/examples/<service-definition-id>.openapi.json` (until backend import exists).
  - Endpoints match by "METHOD /path" exactly as the step's `entryPoint` or the line's `signature` says.
  - Render contracts with `ContractView` and `useEndpointContract`; never parse documents in components.
- **Process view (ADR-028):**
  - `lineProcess` and `flowProcess` (`src/transit/process.ts`) build the sequence; `ProcessDiagram` draws it.
  - To show a condition, a parallel fork, a repeat, or a transaction on a service-board line, declare it (`Branch.condition`, `Branch.parallel`, `Line.repeat`, `Line.transactions`); never infer it.
- **Editing:** `features/business-flows/FlowEditorDialog.tsx` is wired into `EntityEditorProvider` for the `business-flow` kind.
- **Import:** `make -C backend import-flows FILE=…` (examples in `fixtures/flows/`).

## 8. Known limitations (current)
- No real integrations, authentication, or tenancy. All data is mock; all telemetry is simulated.
- Sandbox edits stay in one browser. To move them to the backend, export a data bundle from Settings → Data source and import it with `?source=api` (ADR-032).
- Performance: 2D selection response and 3D frame rate need re-measurement on an idle machine or with a GPU (`docs/BENCHMARKS.md`).
- Grouped 2D mode at full detail fits at a small zoom; read it collapsed or through the Groups panel. Saved positions do not resize groups.
- 3D: dense 250-node overviews need zooming for member labels; explore deeper than grandchildren by entering further.
- History: captured snapshots last for the session; generated datasets have no history fixtures.
- Propagation is rule-based (no probabilities, retries, or circuit breakers); simulated traffic is metric drift, not request-level traffic.
- Preferences are per browser (localStorage); there is no user account to sync them.
- Generated datasets (`?dataset=…`) have no event types, so the Events catalog is empty there. Event types are not part of the snapshot diff.
- The Infrastructure tree renders every expanded row (no virtualization); at 1,000 entities use search/filters or collapse levels.
- The 3D view logs a `THREE.Clock` deprecation warning. It comes from React Three Fiber 9.8.1, the latest stable release (only the 10.0 canaries use `THREE.Timer`); it goes away with that upgrade.
