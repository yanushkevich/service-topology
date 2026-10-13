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

## Milestone 8 — Editing the topology (Revision 7)
**Deliver:** create, edit, and delete every entity kind from the UI against the backend (backend part: Milestone B7). Acceptance criteria: `docs/milestones/MILESTONE_08_ENTITY_EDITING.md`. Decision: ADR-020.

## Milestone 9 — Transit board (Revision 8)
**Deliver:** the per-service transit board (spec Phase 1): line index, perspective SVG transit map, stop strip, and line card, with selection, search, typical-route mode, every panel state, and the responsive breakpoints, on example data behind a `TransitRepository`. Trace replay is spec Phase 4 and out of scope unless the product owner adds it (open in ADR-021); real data sources and backend endpoints are later phases. Spec: `docs/TRANSIT_BOARD.md`. Acceptance criteria: `docs/milestones/MILESTONE_09_TRANSIT_BOARD.md`. Decision: ADR-021 (proposed).

## Milestone 10 — Business flows (Revision 9)
**Deliver:** canonical business flows (model, validation, resolver, contract), example Checkout and Refund flows, the Flows catalog and flow board (two levels with drill-down to the transit board), typical mode with outcome shares and flow findings, business-transaction replay by business key, and authoring in the editing UI. Backend part: Milestone B8 (persistence, entity API, importer for native and BPMN 2.0 flow definitions). Spec: `docs/BUSINESS_FLOWS.md`. Acceptance criteria: `docs/milestones/MILESTONE_10_BUSINESS_FLOWS.md`. Decision: ADR-022.

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
| 8 | Implemented (2026-10-12) | Editing UI (ADR-020); see the Milestone 8 closeout below. |
| 10 | Implemented (2026-10-12) | Business flows (ADR-022): model, board, typical mode, transaction replay, and authoring, on example observed data; see the Milestone 10 closeout. |
| 11 | Implemented (2026-10-12) | Flow swimlanes, flows on the service board, pattern catalog (ADR-023, ADR-024); see the Milestone 11 closeout. |
| 11.1 | Implemented (2026-10-12) | Data stores on both boards (linked dependencies, tables, store chips) and findable flows (ADR-027); `docs/milestones/MILESTONE_11_1_DATA_STORES.md`. |
| 11.2 | In progress (2026-10-12) | Process view (sequence diagram with alt/opt/loop/par/transaction/compensation) for lines and flows, and visible endpoints (ADR-028); `docs/milestones/MILESTONE_11_2_PROCESS_VIEW.md`. |
| 12 | Specified (2026-10-12) | Flows in impact analysis and simulation, with backend B9 (ADR-025, proposed). Not started. |
| 13 | Specified (2026-10-12) | 3D drill-down from a flow into its services (ADR-026, proposed). Not started. |
| 9 | Implemented (2026-10-12) | Transit board on example data (ADR-021): spec Phase 1 plus the Phase 4 replay UI, hover tooltips, windows, and per-step stats; see the Milestone 9 closeout and follow-up below. Real data sources (phases 2, 3, and 5) are not started. |
| B1 (backend) | Implemented (2026-10-11) | Go foundation in `backend/`; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B2 (backend) | Implemented (2026-10-11) | ArcadeDB adapter, schema, idempotent seed, integration tests; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. The database was replaced by MongoDB afterwards (ADR-019). |
| B3 (backend) | Implemented (2026-10-11) | REST API for contract v1, registry parity, contract check; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B4 (backend) | Implemented (2026-10-11) | Bounded traversal, impact, event types, revision cache, benchmarks; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B5 (backend) | Implemented (2026-10-11) | Isolated simulation runs (ADR-017), events/telemetry with provenance, snapshot diff, retention; closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B8 (backend) | Implemented (2026-10-12) | Business flows: persistence, entity API, validation parity, and the importer (native, BPMN 2.0); closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B7 (backend) | Implemented (2026-10-12) | Entity create/replace/delete with whole-topology validation and revision `ETag`/`If-Match` (ADR-020); closeout in `docs/backend/IMPLEMENTATION_PLAN.md`. |
| B6 (backend) | Implemented (2026-10-11) | Auth (ADR-018), rate limits, CORS, metrics, backup/restore runbook, frontend HTTP integration (`?source=api`); closeout and open production decisions in `docs/backend/IMPLEMENTATION_PLAN.md`. |

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

### Milestone 8 closeout (2026-10-12)
Evidence: frontend typecheck, lint, and build pass; `npx vitest run` 41 files / 385 tests passed (1 skipped), including 10 editing integration tests, 9 form-model tests, 3 HTTP writer tests, and 2 new axe audits (menu, form with errors, delete dialog). Before the change, the frontend was validated against the running backend in headless Chrome (`scripts/check-live-api.mjs`: map 27 nodes, registry 29 rows labelled "Backend API · mock inventory · simulated telemetry", inspector, event catalog, 8 API requests, none failed). After it, `node scripts/check-live-api.mjs --write` against the Go API on a disposable MongoDB database: 25/25 checks, including create → edit → delete of an environment through the UI verified through the API (201, 200, 204) and the disabled delete of a referenced resource. Screenshots reviewed at 1440×900 in both themes: New menu, form with field errors, delete dialog with blockers, read-only note with mock data.

| Criterion | Result | Evidence |
|---|---|---|
| Create, edit, delete every kind against the backend | Pass | `editing.test.tsx` (environment, connection, service definition, instance, event type, resource, connection delete); live `--write` check; backend tests per kind |
| Invalid changes caught before sending and from the server | Pass | local whole-topology check (`newIssues`), field errors from `invalid-field`, 422 issue list (`editing.test.tsx`, `httpRepositories.test.ts`) |
| Referenced entities cannot be deleted; blockers in plain words | Pass | `editing.test.tsx`, live check, screenshot |
| Stale edits refused with reload | Pass | `editing.test.tsx` (412 → Reload data → save) |
| Read-only for mock data and history | Pass | `editing.test.tsx` |
| Stored, not simulated, values; telemetry stays simulated | Pass | `editing.test.tsx` (instance edit), `entityForms.test.ts` |
| Accessibility | Pass | axe (jsdom) for menu, form with errors, delete dialog; keyboard test includes the New button; focus trap and return in `Modal` |

Known limitations: the real-browser axe audit (`npm run audit:a11y`) runs on mock data, where editing is read-only, so the dialogs are audited in jsdom only (no color-contrast rule there; the new text uses existing contrast-tested tokens). Metadata is edited as JSON. Multi-selects are checkbox lists (fine at the mock's size; long at 1,000 entities). There is no undo; snapshots keep earlier states.

### Milestone 9 closeout (2026-10-12)
Evidence:
- `npm run check` passes: typecheck, lint, 432 tests in 45 files (431 passed, 1 skipped), and the build. New tests:
  - 15 layout and 6 model tests (`src/transit/*.test.ts`), plus a scale test;
  - 14 board integration tests (`TransitBoardPage.test.tsx`);
  - 2 jsdom axe cases;
  - 8 contrast cases for the new tokens;
  - a URL-state case.
- The real-browser audit (`npm run audit:a11y`) passes all 29 runs, including the two board pages in both themes: 0 axe violations and visible focus throughout. It first found the search box without a focus ring and an "observed" tag at 4.44:1 in the light theme; both are fixed.
- Screenshots were reviewed in headless Chrome:
  - 1440×1000: dark (no selection, A2) and light (A1);
  - 1000×1300: dark (A5, with the index drawer and the alternative branch);
  - 390×1800: light (W1, flat map, index select).

  No size scrolls the page horizontally.
- Timings: `npm run bench`, recorded in `docs/BENCHMARKS.md`.

| Criterion | Result | Evidence |
|---|---|---|
| Layout functions pure and deterministic, tested (junctions, bundling order and offsets, projection, capsules) | Pass | `src/transit/layout.test.ts` |
| Selection and search change only styles; no path is rebuilt | Pass | `TransitBoardPage.test.tsx` checks that the same `<path>` nodes keep the same `d` across selection and search |
| Every state in the spec's states table renders; unknown is never shown as missing | Pass | Integration tests: loading, empty, no selection, no traces, partial data, error with retry, unknown service |
| Index and strip carry the information; map is `role="img"`; colour never alone; keyboard; reduced motion | Pass | Index list with Up/Down, Enter, and Esc; strip as ordered lists with text for every stop; words for provenance, severity, and policy state. There is no animation in Phase 1, so reduced motion has nothing to stop; the audit's reduced-motion check passes. |
| Both themes; new colours are contrast-tested tokens | Pass | `--transit-*` tokens; `contrast.test.ts` (lines and policies ≥ 3:1 on the map, badge text ≥ 4.5:1, stations ≥ 3:1) |
| Axe cases (jsdom and real browser, both themes) | Pass | `a11y.test.tsx`; `npm run audit:a11y` |
| Example data labelled, never live | Pass | Header tag "Example data · last 7 days"; tested |
| Layout timings at 60 lines / 80 stations recorded | Pass | About 5 ms median (perspective); in-browser frame times at that size were not measured, because only the 11-line example board can be opened in the app |

Decisions made during implementation (ADR-021):
- Policy rendering uses a separate `state` field (`exercised`, `idle`, `missing`, `unknown`) in place of the spec's `type: 'missing'`, so an absent policy keeps its type. An `idempotency` type was added.
- The budget bar counts each client's timeout × the retry policy's `maxAttempts`, on sequential branches only. Clients whose config is unknown are counted and named, never treated as zero.
- The resolutions proposed in `TRANSIT_BOARD.md` were applied: unselected lines dim to 22%; at 761–1179px the index is a collapsible drawer and the card goes full width below; the card shows p50/p95.
- The board's `line`, `mode`, `trace`, and `t` URL parameters are kept by the URL-state sync only on `/services/…` routes.

Known limitations:
- Trace replay (spec Phase 4) is shown as disabled.
- There are no hover tooltips beyond the native SVG titles, and no window selector (1h, 24h, 7d).
- The station rows of the map are placed automatically, without label collision avoidance; a few labels in the dense far rows can touch.
- Per-step p99, call share, and retry rates are not in the example data, so the strip shows the prototype's stats.
- Only Payment Service has a board; every other service shows "No endpoints yet".

### Milestone 9 follow-up (2026-10-12): everything outstanding on example data
Product owner direction: "implement everything whats outstanding". Delivered:
- **Trace replay (the spec's Phase 4 UI) on example traces.** `src/transit/mock/paymentServiceTraces.ts` ports the prototype's trace generator, plus an off-map span (W1), lost context (E1), and a fan-out (J2).
  - Sample requests: slowest, most recent error, one with retries, and typical. A pasted trace ID opens that trace, switching to its line.
  - Playback: a train on the map; about 6 s per trace at 1×, with 0.25×, 1×, and 4×.
  - Retries bounce between the dependency and the retry diamond. A fallback or a cache miss takes the branch. An error turns the train red.
  - The strip is a timeline: a slider to scrub and one button per step. It flags off-map spans, shows lost context as a dashed gap, and stacks parallel steps.
  - Divergence from the typical route is shown in the strip and the card, and the card lists the active step's attributes.
  - Keys: T, Space, Left, Right, `[`, `]`. Reduced motion steps instead of gliding. URL: `mode`, `trace`, and `t` (written only while paused).
- **Hover tooltips** for stations (name, kind, provenance, the selected line's p50 and p99) and for policy stops (summary and config source).
- **Window selector** (1h, 24h, 7d; default 24h, as in the spec), with the URL parameter `window`. The example scales its 7-day trace counts by the window; J2 has no traces in the last hour.
- **Per-step stats** in typical mode: p99, share, error rate, and retry rate. They are tinted by `STEP_THRESHOLDS` (errors > 1%; a dependency is slow when its p99 is above its share of the deadline) and always named in words.
- **Label collision avoidance:** each label takes its hinted side, then the other side, then the right. A label that fits nowhere is hidden until its line is selected.

Evidence:
- `npm run check` passes: typecheck, lint, 459 tests in 47 files (458 passed, 1 skipped), and the build.
- New tests:
  - `src/transit/trace.test.ts`: the generator, helpers, divergence, samples, and the windowed repository;
  - `TraceReplay.test.tsx`: 15 integration tests covering replay, keys, scrubbing, URL time, divergence, off-map, gap, fan-out, paste, the disabled state, windows, step stats, tooltips, and hidden labels;
  - label-overlap tests in both projections;
  - a jsdom axe case for trace replay.
- `npm run audit:a11y`: all 31 runs pass, including trace replay in both themes. The audit first found contrast failures on future steps and status words, and Back/Next labels that did not match their visible text; all are fixed.
- Screenshots reviewed: A5 replay at the divergence step (dark), J2 at the fork with two trains (light), the policy tooltip (dark), the overview, and A1 replay at 390px (light). No page scrolls horizontally.

Decisions:
- Playback keeps a step cursor beside the clock time, because several steps can start at the same moment. Each step stays on screen for at least 380 ms ÷ speed.
- The playback clock is a store local to the board (`playback.ts`), so only the marker, the progress, and the active step re-render each frame; the map does not.
- Divergence reports the first departure from the route, then a failure, then the first retry or fallback.
- `TraceStep` gains `attempt`, `offMap`, `contextLost`, `parallel`, and `attributes`; `TraceSummary` gains `lineId` and `retries`.

Still not started: spec phases 2, 3, and 5 (ingesting specs, scheduler and resilience config, and OpenTelemetry traces; the `/transit` and `/steps` endpoints; the alias table; real findings rules; grouped trunks; code scan). They depend on the open questions in `docs/TRANSIT_BOARD.md` (tracing backend, internal spans, alias ownership, sampling).

### Milestone 10 closeout (2026-10-12)
Commits (one per phase):
1. `1c80576`: model and validation.
2. `02a07a5`: B8 storage and entity API.
3. `d248ea1`: phases 3–5, the flow board, typical mode, and replay.
4. `2eb9eb0`: authoring.
5. `4568879`: B8 import.
6. The close-out commit: schema, benchmarks, and docs.

Evidence:
- **Frontend:**
  - Typecheck, lint, and build pass.
  - `npx vitest run --maxWorkers=2` passes: 52 files, 516 passed, 1 skipped.
  - With the default number of workers and the Docker VM busy (other containers running, load average about 11), different map and editing tests hit the 5 s timeout on each run. Every failing file passes when run alone.
  - New tests:
    - 12 domain tests;
    - 17 layout tests;
    - 16 model and example-data tests;
    - 4 form tests;
    - 17 board and replay integration tests;
    - 6 authoring integration tests;
    - 1 schema test;
    - 4 jsdom axe cases.
- **Real-browser audit** (`npm run audit:a11y`): the flows catalog, the flow board with a step selected, and transaction replay pass in both themes, along with every earlier page.
- **Backend:**
  - `make check` passes, including validation conformance with 8 new flow cases (codes, entity IDs, and order identical to TypeScript), flow-format tests, and API tests for writes and imports.
  - `make test-integration` passes, including flows round-tripping through MongoDB, flow writes, and imports.
  - `make contract-check` passes 80/80, including flow writes and imports.
  - `make vulncheck` reports no reachable vulnerabilities.
- **Screenshots** reviewed:
  - catalog, dark and light;
  - Checkout board, dark at 1440px and light at 1000px and 390px;
  - a selected step, light;
  - replay of the settlement timeout, dark.

  No page scrolls horizontally.
- **Benchmarks:** `npm run bench` at 50 flows × 40 steps, recorded in `docs/BENCHMARKS.md`.

| Criterion | Result | Evidence |
|---|---|---|
| Every rule tested in TypeScript and Go with identical codes; example flows validate in every environment | Pass | `businessFlow.test.ts`; `fixtures/conformance/validation/*flow*`; Go conformance test |
| No transition without backing; removing one is an error | Pass | `businessFlow.test.ts` (relationship and event consumer removed); API 422 `flow-transition-unbacked` |
| Flow board reuses the layout pipeline; selection and replay do not rebuild paths | Pass | `FlowBoardPage.test.tsx` (same path nodes); shared `bundledPolyline`, `fitProjection`, `placeLabels` |
| Drill-down opens the right service board, line, and trace | Pass | Step link → `/services/payment-service/transit?line=A1`; replay link → `mode=trace&trace=…` |
| Replay joins by business key; gaps shown, not bridged; compensation on the undo track | Pass | `FlowBoardPage.test.tsx`, `flowModel.test.ts` |
| Authored flows created, edited, and deleted against the backend; imported flows not editable; re-import is a no-op | Pass | `FlowEditor.test.tsx`; Go API and integration tests; contract check |
| Real-browser axe for catalog, board, and replay in both themes; flow form in jsdom; keyboard and reduced motion | Pass | `npm run audit:a11y`; `a11y.test.tsx`; replay keyboard tests; reduced-motion stepping shared with the transit board |
| Example observed data labelled | Pass | Header "Example data · …"; no "live" (tested) |
| `npm run check`, `make check`, `make test-integration`, `make contract-check` | Pass, with the load caveat above | As listed |
| Layout timings at 50 × 40 recorded | Pass | `docs/BENCHMARKS.md` |

Known limitations:
- **Example data:** observed flow data and transactions are examples until trace ingestion exists (spec phases 2–3). The business-key attribute in real traces is an open question.
- **Real-browser audit:** the flow form is audited in jsdom only, because the mock data is read-only in the browser.
- **Visual editor:** there is none; flows are edited in a structured form.
- **BPMN:** collaboration pools merge into one flow; sub-processes count as a single step.
- **Import writes:** an import writes flows one at a time after validating them together. A concurrent write can stop it part-way (412); running it again completes it.
- **Catalog warnings:** the catalog's warning counts leave out retry amplification, which needs the transit boards and is counted on the board.

### Milestone 11 closeout (2026-10-12)
Flow swimlanes, business flows on the service board, and one pattern catalog (ADR-023, ADR-024; `docs/BUSINESS_FLOWS.md` Revision 2 and its implementation notes). Milestones 12 and 13 are specified, not started.

**Commits:**
- `d3a15b2` specs;
- `92f0b4d` pattern catalog;
- `de0b935` swimlane layout;
- `2e023c1` swimlane board;
- `855036b` flows on the service board;
- the close-out commit.

**Checks run:**
- **Frontend (`apps/web`):** `npx tsc -b`, `npx eslint .`, and `npx vitest run --maxWorkers=3`: 61 files, 932 passed, 1 skipped, after the close-out. `npm run build` passes.
  - One earlier full run had a single failure, in `TraceReplay.test.tsx` ("runs parallel spans side by side"). It passed alone (32/32 in its directory) and in the next full run, so it is load-sensitive, not reproducible. It is untouched by this milestone.
- **Real-browser audit:** `npm run audit:a11y` against `vite preview`, 20 pages × 2 themes, all pass. It includes the new pages: the swimlane, and the service board with a flow selected.
- **Backend:**
  - `make -C backend check` passes;
  - `make test-integration` passes (MongoDB);
  - `make contract-check`: 80/80.
- **Screenshots** reviewed:
  - flow board in light and dark at 1440, 1000, and 390 px;
  - replay (dark);
  - Refund (dark);
  - the service board with Checkout selected (dark), and with a line's "Used by" (light).

  No page scrolls horizontally at 390 px (checked in Chrome).
- **Benchmarks:** `npm run bench`, recorded in `docs/BENCHMARKS.md`.

| Criterion | Result | Evidence |
|---|---|---|
| Every pattern label on either board comes from the catalog; the three new values pass both validators and the contract; fixtures regenerated | Pass | `patterns.test.ts`; integration text "(Idempotent consumer, missing)", "(Polling publisher, …)"; Go `make check` (schema parity); contract test; contract check 80/80 |
| Each new finding has a test that triggers it and one that clears it | Pass | `messagingFindings.test.ts` |
| One flow per board; steps in their service's lane; outcomes last; no shared vertical tracks; selection, search, and replay move nothing | Pass | `swimlane.test.ts` (lanes, tracks, no edge through a node); `FlowBoardPage.test.tsx` (positions and paths unchanged after selection); `swimlaneAdapter.test.ts` |
| Shared steps say "also in" and link | Pass | `swimlaneAdapter.test.ts` (the example flows share no step, so this is shown with a test flow) |
| Replay marks the current step, the traversed transitions, and the divergence; keyboard and reduced motion | Pass | `FlowBoardPage.test.tsx` (`data-train`, `traversed`); Enter selects a step; the follow is instant with reduced motion |
| Service board lists flows; selecting Checkout on Payment Service lights exactly A1, A2, A4, W1; card links back; the round trip keeps the environment and window | Pass | `FlowsOnService.test.tsx` |
| axe in jsdom and the real browser, both themes; no horizontal scroll at 390 px | Pass | `a11y.test.tsx`; `npm run audit:a11y`; the overflow check |
| `npm run check`, `make check`, `make test-integration`, `make contract-check` | Pass | As listed (the frontend checks were run as separate commands, the vitest step with `--maxWorkers=3` because of the VM load) |

**Fixed during close-out:**
- The real-browser audit found two problems.
  - Faint labels on dimmed edges (1.95:1). They are no longer drawn.
  - A wide stop strip that scrolled without being focusable. All four board strips now use `StripScroller`, a focusable, labelled region.
- A selected step is brought into view.

**Known limitations:**
- **Visual zoom limit.** Below a 72% zoom the swimlane pans instead of fitting. Very long flows (40 steps) need the minimap or the strip.
- **Untested display path.** The example flows share no step, so "also in" appears only with more flows (unit-tested).
- **Placeholders for the new patterns.** Async request-reply has no example in the topology yet. Inbox and polling-publisher stats are example placeholders.
- **Unmeasured render cost.** React Flow render times in the browser were not measured.

### Milestone 11.1 closeout (2026-10-12)
Data stores on both boards, and flows you can find (ADR-027; `docs/BUSINESS_FLOWS.md` Revision 3).

**Commits:**
- `632c86a` spec;
- `662d1c6` linked dependencies;
- `7525870` tables;
- `7cf6304` data stores on flows;
- `12922c9` findable flows;
- the close-out commit.

**Checks run:**
- **Frontend (`apps/web`):** `npx tsc -b`, `npx eslint .`, and `npx vitest run --maxWorkers=3`: 66 files, 963 passed, 1 skipped. `npm run build` passes.
  - During phase 2, one run of a combined subset timed out once in the 2D map accessibility case (ELK in jsdom). It passed alone (24/24) and in every later full run.
- **Real-browser audit:** `npm run audit:a11y`, 22 pages × 2 themes, all pass on two runs. New pages: Capture's data and dependencies, and a service with no board data.
  - The first run found one real failure: the step count in a pressed "Used by" chip was 3.82:1 in light mode. It now inherits the chip's text colour.
- **Screenshots** reviewed:
  - Capture with Checkout selected (light);
  - the webhook (dark);
  - the Checkout swimlane (dark);
  - Order Service without board data (dark);
  - the flow board at 390 px.

  No horizontal page scroll; no console errors.
- **Backend:** not changed (the transit read model is frontend-only).

| Criterion | Result | Evidence |
|---|---|---|
| `payments-pg` resolves to `payments-db`; simulated unavailability shows on the board; Redis flagged | Pass | `links.test.ts`; `DependencyLinks.test.tsx` (card, link, strip "down", Findings) |
| Every table's writers and readers reach its station; Capture writes `payment_outbox`; OutboxRelay polls it; the webhook's inbox is `processed_webhooks` | Pass | `tables.test.ts`; `DependencyLinks.test.tsx` |
| Each new rule triggers and clears | Pass | `links.test.ts` (dependency-not-in-topology); `tables.test.ts` (store-pattern-without-table); `messagingFindings.test.ts` (store-pattern-without-store) |
| Checkout's steps show `orders-db`, `inventory-db`, `payments-db`, `ledger-db`; outbox names `payments-db`; inbox names `ledger-db` | Pass | `dataStores.test.ts`; `FlowDataStores.test.tsx` |
| "Used by" chips toggle the flow; a service without board data lists its flows | Pass | `FlowsOnService.test.tsx` |
| Checks and real-browser audit | Pass | As listed |

**Known limitations:**
- **Stores per service.** Stores belong to services in the topology, so a step shows its service's stores, and the UI says so. Per-operation data access needs `db.*` span attributes from real traces.
- **Example tables.** Tables are example data, and only Payment Service has a board.
- **The strip's stop text gets tall.** A database stop that a line writes several tables at wraps to several lines.
