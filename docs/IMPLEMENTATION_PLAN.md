# Implementation Plan — Service Topology and Registry Platform

**Execution:** One phase at a time. Never automatically start the next phase.  
**Before every phase:** Read the product spec, architecture, implementation plan, current phase prompt, and relevant repository code.

## Agent operating contract
At phase start: inspect the repository, verify prior deliverables, identify conflicts, and outline the implementation approach before major changes.

At phase end:
1. Run available type checking, linting, tests, and build.
2. Fix regressions introduced by the phase.
3. Report commands actually run and their actual results.
4. Update architecture decisions and phase status where needed.
5. Commit the phase or milestone (Conventional Commits, scope `phase-NN` / `mN`; see `AGENT_WORKFLOW.md` §6).
6. Report changed files, commit, acceptance criteria, known limitations, and next-phase prerequisites.
7. Stop.

## Phase overview
| Phase | Name | Deliverable |
|---|---|---|
| 0 | Product blueprint and implementation contract | Confirm complete scope and execution rules |
| 1 | Foundation + design system + application shell | Running product shell, theme, navigation, view placeholders |
| 2 | Domain model, mock data, repository | Canonical typed model and 15+ connected sample services |
| 3 | Shared state and contracts | Shared selection, filters, environment, view state |
| 4 | Visualization workspace | Toolbar, view host, filters, legend, placeholders |
| 5 | Shared visual language | Centralized category/provider/health/protocol mappings |
| 6 | Functional 2D topology | React Flow graph using canonical data |
| 7 | Registry and inspector | Searchable registry and synchronized details |
| 8 | Functional 3D network | Interactive R3F scene using same domain/state contracts |
| 9 | Animation and visual polish | Reveal, focus, signals, reduced motion, cleanup |
| 10 | Simulation, dependencies, infrastructure | Simulated traffic/health, dependency analysis, grouping |
| 11 | Hardening and delivery | Verified workflows, quality checks, setup and extension docs |

## Phase 0 — Product blueprint
**Work:** Read the three core docs, identify ambiguities and assumptions, verify phase coverage, and inspect existing repository if present.  
**Out of scope:** Feature implementation unless explicitly requested.  
**Acceptance:** Agent can summarize product, users, workflows, renderer boundaries, non-goals, and phase sequence; unresolved decisions are reported instead of invented.

## Phase 1 — Foundation + design system + application shell
**Work:** Configure React, strict TypeScript, Vite, routing, scripts, compatible pinned dependencies; build header, navigation, workspace, inspector region, CSS-variable themes, dark/light toggle, 2D/3D/Infrastructure placeholders, responsive behavior, state patterns, and setup instructions.  
**Out of scope:** Functional React Flow graph, full R3F scene, advanced shaders/animation, real integrations.  
**Acceptance:** App starts/builds; navigation/theme/view placeholders work; layout reserves canvas and inspector; shell is renderer-agnostic; unfinished controls are clearly labeled.

## Phase 2 — Domain model, mock data, repository
**Work:** Typed services/connections/providers/environments/health/protocols/metrics; validation; repository interface and mock implementation; 15+ connected services spanning AWS/Azure/GCP/on-prem, multiple environments and protocols; selectors.  
**Acceptance:** Unique IDs, valid references, no renderer imports in domain, simulated data labeled, repository/selectors tested.

## Phase 3 — Shared state and contracts
**Work:** Typed selected entity, active view, environment, filters, visible layers, theme/preferences, relevant simulation controls; Zustand stores/selectors; document cross-view contracts.  
**Acceptance:** Selection uses canonical type+ID; view switching preserves applicable state; state actions are testable; no Three.js objects or frame-frequency updates in global state.

## Phase 4 — Visualization workspace
**Work:** Toolbar, view switcher, filters, legend, layer controls, overlays, view host, placeholders, loading/empty/error/no-results states, stable view interfaces.  
**Acceptance:** Placeholder switching works; controls use shared state; workspace does not depend on renderer internals.

## Phase 5 — Shared visual language
**Work:** Central mappings for category/provider/health/protocol/status; selected/hovered/dimmed/hidden states; labels, icons, legend, accessible descriptions, dark/light support.  
**Acceptance:** Every value has a mapping/fallback; status not color-only; contrast is adequate; both renderers can consume the configuration.

## Phase 6 — Functional 2D topology
**Work:** React Flow custom nodes/edges and adapters; pan/zoom/drag/select/fit; search/focus; filters; connection selection; dependency highlighting/neighborhood; minimap/labels/grouping where practical.  
**Acceptance:** Data derives from canonical records; node/edge selection updates shared state; search and filters work; core behavior tested.

## Phase 7 — Registry and inspector
**Work:** Searchable/filterable/sortable table; provider/environment/health/owner/dependency counts/update time; service and connection inspector; registry-to-map focus.  
**Acceptance:** Canonical IDs are shared; selection synchronizes; inspector derives from canonical data; empty/no-results states work.

## Phase 8 — Functional 3D network
**Work:** Lazy-load R3F; deterministic spatial grouping; nodes and curved connections; orbit/zoom/pan/hover/selection/labels/camera focus; shared filters and selection; WebGL fallback and quality safeguards.  
**Out of scope:** Advanced shaders and cinematic animation.  
**Acceptance:** Same canonical entities and IDs; selection/filter synchronization; context preserved across views; graceful fallback; renderer objects stay out of domain/global state.

## Phase 9 — Animation and visual polish
**Work:** GSAP for finite reveal/focus; `useFrame`/shaders for continuous signals; restrained glow/transitions; pause/reduced-motion; cleanup.  
**Acceptance:** No competing animation owners; no frame-frequency React state; reduced motion works; cleanup is correct; scene remains responsive.

## Phase 10 — Simulation, dependencies, infrastructure
**Work:** Simulated traffic/latency, health transitions, deterministic failure/recovery, upstream/downstream analysis, infrastructure grouping, events/traffic presentation as appropriate.  
**Acceptance:** Simulation separate from renderers; updates consistent across views; tests cover transitions; simulated data clearly labeled.

## Phase 11 — Hardening and delivery
**Work:** Run type/lint/tests/build; verify workflows, accessibility, performance, WebGL fallback, cleanup; document setup, architecture, data model, provider/protocol extension; list limitations.  
**Acceptance:** Checks pass or failures are explicitly reported; core workflows are covered by tests or manual checklist; docs match actual implementation; no critical regression is hidden.

## Phase status
Update only from actual repository state and checks.

| Phase | Status | Commit/PR | Checks | Notes |
|---|---|---|---|---|
| 0 | Not done as a separate deliverable | — | — | The product blueprint is covered by PRODUCT_SPEC/ARCHITECTURE/DECISIONS; no separate Phase 0 document was produced. |
| 1 | Done (2026-10-11) | `feat(m1): …` (see git log) | typecheck, lint, test (7/7), build pass | Shell, tokens, routing, 2D/3D placeholders + Topology/Grouped-infrastructure mode switch, inspector region. Visual check via headless Chrome screenshots (dark/light, 1440 and 700 px). |
| 2 | Done (2026-10-11) | `feat(m1): …` (see git log) | domain/repository tests pass | Types, validation, index, repository interface + mock (14 definitions, 21 instances, 41 resources, 39 relationships across AWS/Azure/GCP/on-prem/SaaS and 3 environments). |
| 3 | Done (2026-10-11) | `feat(m1)`, `feat(m2): add versioned URL state…` | store, URL codec/sync tests pass | Selection, filters, environment, view, layout mode, highlight mode, neighborhood, theme; URL sync. Simulation controls belong to Milestone 3. |
| 4 | Done (2026-10-11) | `feat(phase-06): …` | map integration tests pass | Toolbar, view/mode switch, map filters, legend, controls, empty/no-match/too-many/hidden-selection/loading/error states. |
| 5 | Done (2026-10-11) | `feat(phase-06): …` | — | Central mappings incl. edge kinds (color + dash), status shapes, glyphs, light/dark tokens. Contrast of new edge colors not separately measured. |
| 6 | Done (2026-10-11) | `feat(phase-06): …` | layout/graph/map tests pass | React Flow + ELK (worker), selection, highlight, neighborhood, grouping/collapse, minimap. |
| 7 | Done (2026-10-11) | `feat(m1)`, `feat(phase-06)` | registry + map tests pass | Inspector "Show on map" / "Explore neighborhood"; off-screen selections are brought into view. |
| 8 | Done (2026-10-11) | `feat(phase-08): …`, `feat(m4): …` | galaxy tests pass | Lazy R3F galaxy, scopes, breadcrumbs, fallbacks. |
| 9 | Done, scoped (2026-10-11) | `feat(m4): …`, `fix(phase-11): …` | motion policy, camera, frame-loop guard, reduced-motion audit pass | GSAP camera transitions, data-bound particles, pause, reduced motion; Milestone 5 verified rather than added motion. |
| 10 | Done (2026-10-11) | `feat(phase-10): …`, `feat(m3): …` | engine/propagation/snapshot/events tests pass | Simulation, propagation, history; infrastructure grouping was delivered in Milestone 2. |
| 11 | Done (2026-10-11) | `fix(phase-11): …`, `docs(m5): …` | check, a11y audits, contract tests pass | Hardening, accessibility, API contract, developer docs. |


---

# Revision 2 — Recommended Milestone Delivery Plan

**Use this five-milestone plan as the delivery-level sequence.** The original phase-by-phase plan above is retained unchanged for traceability and can be used as implementation substeps. Where the old plan conflicts with this milestone order, this section takes precedence.

## Milestone 1 — Domain, mock data, registry, and shell
**Includes original phases:** 0, 1, 2, and the registry foundations of 7.

**Deliver:** Running application shell, design tokens, normalized domain model, mock repository with 15+ connected services/resources, searchable registry, environment/provider/health filters, and a basic inspector for registry selection.

**Acceptance criteria:**
- App starts, type-checks, and builds.
- React Flow and ELK.js are selected/pinned as intended dependencies, but the full topology need not yet be implemented.
- Data distinguishes logical service definitions, per-environment service instances, infrastructure resources, and communication relationships.
- Kafka topics and RabbitMQ queues/exchanges can be first-class resources.
- Infrastructure containment is explicit and validated.
- Registry search/filter/selection use canonical IDs.
- WCAG contrast and keyboard/focus foundations are present.
- Mock telemetry is labeled as simulated.

## Milestone 2 — 2D map, inspector, and grouped infrastructure mode
**Includes original phases:** 3, 4, 5, and 6, plus full inspector integration from 7.

**Deliver:** Functional React Flow topology, ELK layout, service/connection inspector, search/focus, filters, dependency highlighting, and Infrastructure mode as a grouped layout of the same 2D topology.

**Acceptance criteria:**
- No overlapping node boxes in required initial-layout fixtures.
- At least 250 nodes / 750 edges can be benchmarked as the supported visible-graph target.
- 1,000-entity inventory remains navigable using filters, grouping, search, and neighborhood exploration.
- Selection/filter/environment state synchronizes between registry, 2D graph, and inspector.
- URL deep links encode supported active view, environment, selected entity, and filters.
- Saved layouts persist serializable positions/grouping behind a repository interface.
- Accessibility, loading/empty/error states, and automated tests cover core workflows.
- Infrastructure mode reuses the same graph model and interactions; no separate renderer.

## Milestone 3 — Simulation, dependency analysis, and topology history
**Includes original phase:** 10, with necessary supporting contracts.

**Deliver:** Mock traffic/latency changes, health transitions, deterministic failure/recovery, dependency propagation rules, and snapshot/history foundations.

**Acceptance criteria:**
- Simulation is independent of React/React Flow/Three.js rendering.
- Failure propagation rules are explicit, explainable, and testable.
- A simulated event is reflected consistently in registry, inspector, graph, and event list.
- Snapshots are versioned and can represent topology/health at a point in time.
- A simple “as of” or snapshot comparison workflow works with fixtures, or any deferred UI is explicitly documented and scheduled.
- All simulated data remains visibly labeled.

## Milestone 4 — Secondary 3D network view
**Includes original phases:** 8 and the functional prerequisites from 3–5.

**Deliver:** Lazy-loaded, rotatable galaxy-like React Three Fiber view with luminous service/resource nodes, glowing curved relationship paths, deterministic semantic constellations, camera focus, and an explicit hierarchical “Explore inside” flow with breadcrumbs/back/overview. Follow `docs/3D_GALAXY_EXPERIENCE.md` as the detailed design contract. Preserve selection/filter/environment/scope parity and provide reduced motion, pause, cleanup, and WebGL fallback.

**Acceptance criteria:**
- Same canonical entity IDs and shared state as the 2D map.
- Users can switch to 3D and back without losing applicable selection, filters, or environment.
- 3D remains optional and does not block 2D usage if WebGL is unavailable.
- Readability and interaction parity are reviewed against the 2D view.
- Nodes are rotatable; glowing paths show endpoints/direction where known; selection/focus is accessible.
- Users can enter a node into its real modeled child scope or neighborhood and return using breadcrumbs/back/overview.
- Containment and communication are distinct; leaf entities do not get fabricated interiors.
- Reduced motion, pause, context-loss fallback, and resource disposal are verified.
- Performance is benchmarked against the documented target; visual effects are not prioritized over clarity.

## Milestone 5 — Polish, hardening, and differentiation validation
**Includes original phases:** 9 and 11, plus deferred product-level requirements.

**Deliver:** Motion polish, reduced-motion/pause behavior, accessibility and performance review, API contract documents, final test coverage, and extension documentation.

**Acceptance criteria:**
- WCAG 2.2 AA text contrast: 4.5:1 normal text, 3:1 large text; applicable non-text indicators meet 3:1.
- Keyboard navigation, visible focus, accessible names, and reduced-motion behavior are verified.
- Type check, lint, tests, and production build pass or failures are explicitly documented.
- `docs/API_CONTRACT.md` defines OpenAPI 3.1 and JSON Schema boundaries and example payloads.
- Product differentiation is described as a hypothesis and validated through competitor/workflow comparison rather than unsupported claims.
- Setup, architecture, scale targets, and known limitations are documented.

## Milestone 6 — Tailwind migration and complete section pages (Revision 5)
**Deliver:** Tailwind CSS v4 over the existing tokens with all CSS Modules migrated; Overview, Dependencies, Infrastructure, and Settings pages; local preferences. Acceptance criteria: `docs/milestones/MILESTONE_06_TAILWIND_SECTIONS.md`.

## Milestone 7 — Event catalog (Revision 6)
**Deliver:** canonical event types carried on Kafka topics / RabbitMQ channels, an Events catalog page matching the UI mock, and event-flow highlighting in 2D and 3D. The simulation page moves to `/simulation`. Acceptance criteria: `docs/milestones/MILESTONE_07_EVENT_CATALOG.md`.

## Status tracking
Track both milestones and original phases. A milestone is not complete until its acceptance criteria are checked against the actual implementation. Do not claim performance or accessibility criteria pass without measurement or test evidence.

| Milestone | Status | Notes |
|---|---|---|
| 1 | Implemented, pending review (2026-10-11) | All acceptance criteria checked; see the Milestone 1 closeout below. Data-model decisions resolved 2026-10-11 (ADR-008). |
| 2 | Implemented (2026-10-11) | See the Milestone 2 closeout below. |
| 3 | Implemented (2026-10-11) | See the Milestone 3 closeout below. |
| 4 | Implemented (2026-10-11) | See the Milestone 4 closeout below. |
| 5 | Implemented (2026-10-11) | See the Milestone 5 closeout below. |
| 6 | Implemented (2026-10-11) | See the Milestone 6 closeout below. |
| 7 | Implemented (2026-10-11) | See the Milestone 7 closeout below. |
| B1 (backend) | Implemented (2026-10-11) | Go foundation in `backend/`; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B2 (backend) | Implemented (2026-10-11) | ArcadeDB adapter, schema, idempotent seed, integration tests; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B3 (backend) | Implemented (2026-10-11) | REST API for contract v1, registry parity, contract check; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B4 (backend) | Implemented (2026-10-11) | Bounded traversal, impact, event types, revision cache, benchmarks; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B5 (backend) | Implemented (2026-10-11) | Isolated simulation runs (ADR-017), events/telemetry with provenance, snapshot diff, retention; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B6 (backend) | Not started | Security, hardening, frontend integration (`docs/backend/IMPLEMENTATION_PLAN.md`). |

### Milestone 1 closeout (2026-10-11)
Evidence: `npm run check` (typecheck, lint, 50 tests, build) passes. Visual check via headless Chrome at 1440×900 (dark/light) and 700×900.

| Criterion | Result | Evidence |
|---|---|---|
| App starts, type-checks, builds | Pass | `npm run check`; preview server screenshots |
| React Flow and ELK.js pinned | Pass | `apps/web/package.json` (`@xyflow/react` 12.12.0, `elkjs` 0.12.0); not used yet |
| Definitions / instances / resources / relationships distinct | Pass | `apps/web/src/domain/types.ts`; registry and inspector tests |
| Kafka topics and RabbitMQ queues/exchanges first-class | Pass | `validation.test.ts` (producer → resource → consumer relationships) |
| Containment explicit and validated (no missing parents, no cycles) | Pass | `validation.test.ts` (missing-parent, parent-cycle, self-parent) |
| Unique IDs and valid references | Pass | `validation.test.ts`; mock validates with 0 issues |
| One environment per instance; definitions span environments | Pass | `validation.test.ts` |
| Registry search/filter/selection use canonical IDs | Pass | `RegistryPage.test.tsx` |
| WCAG contrast and keyboard/focus foundations | Partial | Token contrast ratios computed (text ≥ 4.5:1 both themes after adding `--color-*-text`); native buttons/inputs, visible focus, skip link, `aria-sort`/`aria-pressed`. No automated axe audit or screen-reader pass yet. |
| Mock telemetry labeled simulated | Pass | Registry "Mock inventory · simulated telemetry" tag; inspector "Simulated" tag + caption; repository test asserts `isSimulated` on all fixture metrics |
| Unresolved data-model questions documented | Pass | `DECISIONS.md` ADR-008; all resolved by the product owner on 2026-10-11 |

### Milestone 2 closeout (2026-10-11)
Evidence: `npm run check` passes (see the closeout commit for counts); `npm run bench` and `npm run bench:browser` recorded in `docs/BENCHMARKS.md`; visual check in headless Chrome (topology dark/light, selection + upstream highlight, grouped mode, 1,000-entity guard and provider collapse, filter panel, layouts menu, deep link).

| Criterion | Result | Evidence |
|---|---|---|
| No overlapping node boxes in initial-layout fixtures | Pass | `elkLayoutService.test.ts`: 6 mock fixtures (topology/grouped/collapsed, 3 environments) + 250/750 fixture in both modes; groups contain children, sibling groups do not overlap |
| Deterministic layout for identical input | Pass | Same result across repeated runs and shuffled input order |
| Selection/filters/environment synchronize between registry, graph, inspector | Pass | `Topology2D.test.tsx`, `RegistryPage.test.tsx` (shared store; FilterBar used by both) |
| URL state: view, environment, selection, filters; back/forward | Pass | `urlState.test.ts`, `useUrlStateSync.test.tsx` |
| Saved layouts contain serializable IDs/positions/options only | Pass | `savedLayout.test.ts` (rejects extra keys/non-numbers), JSON Schema + `schemaSync.test.ts` |
| Benchmark 250 nodes / 750 edges, environment documented | Pass (recorded) | `docs/BENCHMARKS.md`; the < 100 ms selection goal is inconclusive under machine load (73–83 ms isolated, 190–210 ms full script) |
| 1,000-entity inventory navigable | Pass | Guard + provider grouping + search/neighborhood: `topologyGraph.test.ts`, `Topology2D.test.tsx`, browser benchmark |
| Tests for layout fixtures, filters, selection, URL codec | Pass | Files above |
| Infrastructure mode reuses the same graph model and renderer | Pass | `topologyGraph.test.ts` ("same nodes and edges as topology mode") |
| Accessibility, loading/empty/error states | Partial | Keyboard-focusable nodes/edges with aria-labels, visible focus, status shapes + dash patterns, empty/no-match/too-many/error states tested. No automated axe audit; edge-color contrast not separately measured. |

Known limitations: grouped mode at full detail fits at a small zoom; saved positions do not resize groups; selection/zoom timings need re-measurement on an idle machine; 3D remains a placeholder (Milestone 4).

### Milestone 3 closeout (2026-10-11)
Evidence: `npm run check` passes (counts in the closeout commit); visual check in headless Chrome (Events page after an injected failure and steps, map with downstream highlight of the failure, registry in history mode with banner).

| Criterion | Result | Evidence |
|---|---|---|
| Simulation independent of React/React Flow/Three.js | Pass | `apps/web/src/simulation/boundaries.test.ts` (imports only the domain) |
| Deterministic results for the same fixture and actions | Pass | `engine.test.ts` (seeded; equal state for equal action sequences; drift and anomaly events reproducible) |
| Propagation rules explicit, explainable, testable | Pass | `PROPAGATION_RULES` shown in the UI with non-propagation notes; `propagation.test.ts` covers each rule; events and inspector name rule, cause, and root |
| A simulated event appears consistently in registry, inspector, graph, event list | Pass | `EventsPage.test.tsx` ("reflects one injected failure consistently…") |
| Snapshots versioned with timestamp; represent topology/relationships/health | Pass | `snapshot.test.ts`, JSON Schema, fixtures validated |
| "As of" / compare workflow with fixtures | Pass | `EventsPage.test.tsx` (view as of, back/forward, compare, capture, missing snapshot) |
| Browsing history does not mutate current state | Pass | Same test asserts the simulation state object is unchanged |
| Simulated data labeled; nothing described as live | Pass | Labeling tests on /events, /map, /registry; Simulated tags on events, telemetry, snapshots |

Known limitations: captured snapshots last for the session only; generated datasets have no history fixtures; propagation is rule-based (no probabilities, retries, or circuit breakers); simulated traffic is metric drift, not request-level traffic.

### Milestone 4 closeout (2026-10-11)
Evidence: `npm run check` passes (counts in the closeout commit); headless Chrome with SwiftShader WebGL screenshots (overview, container scope, leaf scope in light theme, back navigation); `npm run bench:3d` recorded in `docs/BENCHMARKS.md`.

| Criterion | Result | Evidence |
|---|---|---|
| 2D primary and fully usable without WebGL | Pass | `App.test.tsx` (jsdom has no WebGL: fallback, return to 2D with selection kept); 3D is a lazy chunk |
| Reads as an explorable software galaxy | Pass (visual) | Constellations with orbit rings, silhouettes, glowing paths; screenshots |
| Rotate, zoom, pan, select, focus, discoverable "Explore inside" | Pass | OrbitControls + zoom/fit buttons; Focus and Explore inside in the selection bar and entity list; `GalaxyScene.test.tsx` |
| Dive-in shows actual children or relationships; containment ≠ communication; no fabricated interiors | Pass | `scope.test.ts` (container, broker, logical service, leaf note), spokes/rings vs paths |
| Breadcrumb/back/overview restore scope and camera | Pass | `GalaxyScene.test.tsx` (camera restored), `CameraMemory` tests, browser check of Back |
| Switching views preserves environment, filters, selection, scope | Pass | Shared store + URL `scope`; `urlState.test.ts`, `App.test.tsx` |
| Paths show endpoints/direction; animation bound to data and not the only signal | Pass | Arrows (two for bidirectional), status markers, throughput-bound particles labeled simulated; `sceneModel.test.ts` |
| Labels readable at tested zoom; keyboard/registry alternatives | Pass (default fit, mock data) | Label LOD, entity list, inspector; dense 250-node scopes rely on zooming in |
| 3D benchmark at the visible-graph target, hardware documented | Partial | Recorded on SwiftShader only; GPU numbers still needed |
| No Three.js objects in domain or global state; canonical IDs | Pass | Store holds IDs only; meshes carry canonical IDs (`userData.entityId`) |
| Reduced motion, pause, WebGL fallback/context loss, disposal tested | Pass | `sceneModel.test.ts` (policy), `GalaxyScene.test.tsx` (particles, disposal), `runtime.test.ts` (context loss), fallback test |
| Effects not prioritized over readability | Pass | No bloom; glow only on the selection's paths |

Known limitations: frame rate not yet measured on a GPU; dense 250-node overviews need zooming for member labels; 3D selection-response timing not captured by the harness.

### Milestone 5 closeout (2026-10-11)
Evidence: `npm run check` passes (counts in the closeout commit); `npm run audit:a11y` against the production build: 14/14 page × theme combinations with 0 axe violations (incl. color contrast and target size outside zoomable canvases), visible focus on every Tab stop checked, reduced motion on.

| Criterion | Result | Evidence |
|---|---|---|
| Text contrast ≥ 4.5:1, large ≥ 3:1, non-text indicators ≥ 3:1 | Pass | `contrast.test.ts` (both themes, from tokens), real-browser axe color-contrast |
| Keyboard access, visible focus, accessible names, reduced motion verified | Pass | `keyboard.test.tsx`, jsdom + browser axe, Tab pass in `audit-a11y.mjs`, reduced-motion check, motion policy tests |
| Typecheck, lint, tests, build | Pass | `npm run check` |
| Animation resources cleaned up; no frame-frequency React state | Pass | `GalaxyScene.test.tsx` (disposal), `frameLoop.test.ts` (guard) |
| Performance measured, limitations documented honestly | Pass | `BENCHMARKS.md` (incl. variance and SwiftShader caveats), `DEVELOPER_GUIDE.md` §8 (Known limitations) |
| `API_CONTRACT.md` defines OpenAPI 3.1 + JSON Schema with examples | Pass | `docs/api/openapi.json`, `docs/schemas/*`, `contract.test.ts` |
| Differentiation as a hypothesis, no superiority claims | Pass | `POSITIONING.md` (unvalidated; "?" cells to verify; validation plan) |
| Setup, architecture, testing, scaling, extension docs | Pass | `DEVELOPER_GUIDE.md`, `README.md` |
| Focused animation and visual polish | Partial | Motion was verified and hardened (reduced motion, pause, cleanup, opacity-transition removal for performance); no new animation was added in this milestone |

Remaining risks: no GPU measurement of 3D; 2D selection timing inconclusive on a loaded machine; positioning unvalidated with users; placeholder pages (Overview, Dependencies, Infrastructure, Settings).

### Milestone 6 closeout (2026-10-11)
Evidence: `npm run check` passes (typecheck, lint, 327 tests passed / 1 skipped, build). `npm run audit:a11y` against the production build: 21/21 page × theme runs with 0 axe violations (incl. color contrast), visible focus on every Tab stop checked, reduced motion on. Screenshots reviewed at 1440×1000 in both themes (map, registry, events after the migration; Overview, Dependencies, Infrastructure, Settings) and Infrastructure at 390×844.

| Criterion | Result | Evidence |
|---|---|---|
| No `*.module.css`; Tailwind utilities plus layered component CSS | Pass | `find src -name '*.module.css'` → 0; `apps/web/src/styles/global.css`, `components.css` |
| Only token colors as utilities; contrast test passes | Pass | `--color-*: initial` + `@theme inline`; `contrast.test.ts` |
| Both themes without visual regression | Pass (screenshot review) | Before/after captures of map, registry, events; new pages in both themes. 3D checked in the browser audit run, not pixel-compared |
| New pages meet §K, use canonical data and shared state, honor history, have empty states | Pass | `sectionPages.test.tsx` (14 tests, incl. history mode on Overview and Dependencies); empty states in each page; domain selectors tested in `pages.test.ts` |
| Impact preview uses propagation rules and never changes simulation state | Pass | `analyzeImpact` read-only; `sectionPages.test.tsx` asserts no failures injected |
| Infrastructure from `parentResourceId` only; keyboard tree | Pass | `containmentForest` (`pages.test.ts`); `role="tree"` with roving tabindex, arrows/Home/End/Enter (`sectionPages.test.tsx`) |
| Settings persist locally; motion override app-wide; nothing canonical | Pass | `preferencesStore.test.ts`; `data-motion="reduce"` test; CSS rule in `global.css`; renderers use `isMotionReduced()`; preferences not in URL state |
| `npm run check`; axe in jsdom and browser, both themes, all pages | Pass | See evidence above; `a11y.test.tsx` section-page cases |

Known limitations: the Infrastructure tree is not virtualized and was not measured at 1,000 entities; preferences are per browser only; 3D visual comparison was not pixel-based.

### Milestone 7 closeout (2026-10-11)
Evidence: `npm run check` passes (typecheck, lint, 353 tests passed / 1 skipped, build). `npm run audit:a11y` against the production build: 25/25 runs with 0 axe violations (incl. color contrast), visible focus on every Tab stop checked, reduced motion on; new runs: Simulation, Events catalog, and the map with an event highlight, in both themes. Screenshots reviewed: catalog at 1440×900 (dark, light) and 2000×900 (horizontal flow), 390×844 (staging), 2D and 3D event highlight.

| Criterion | Result | Evidence |
|---|---|---|
| Every M.1 validation rule tested; mock validates with zero issues | Pass | `eventFlow.test.ts` (missing/invalid channel, two channels per environment, unknown service, missing producer/consumer relationship incl. direction, global ID uniqueness); `validation.test.ts` mock integrity |
| Flows from existing relationships only; not-deployed shown, not an error | Pass | `resolveEventFlow` tests (staging: Notification Service not deployed; exchange → queue → consumer) |
| Catalog filters by event and channel; detail with health; selection shared | Pass | `EventsPage.test.tsx` |
| Highlight emphasizes exactly the flow in 2D/3D; selection precedence; chip clears; `ev` round-trips | Pass | `EventsPage.test.tsx` (2D emphasis, chip, deep link), `urlState.test.ts`; 3D via `buildScene` `eventReach` and screenshot review (not covered by a 3D unit test) |
| History mode | Pass | `EventsPage.test.tsx` (`asof=fixture-0600`) |
| Contract includes event types | Pass | `topology.v1.schema.json` `EventType`; `contract.test.ts` validates the mock and snapshots with event types |
| Check and axe (jsdom + browser, both themes) for Events and Simulation | Pass | See evidence above |

Known limitations: generated datasets have no event types; the snapshot diff ignores event types; there is no 3D unit test for event emphasis (verified by screenshot only); the shell test that runs two ELK layouts got a 15 s timeout after timing out at 5 s under full-suite load.

