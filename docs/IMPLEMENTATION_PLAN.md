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
5. Report changed files, acceptance criteria, known limitations, and next-phase prerequisites.
6. Stop.

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
| 0 | Not started | — | — | |
| 1 | Not started | — | — | |
| 2 | Not started | — | — | |
| 3 | Not started | — | — | |
| 4 | Not started | — | — | |
| 5 | Not started | — | — | |
| 6 | Not started | — | — | |
| 7 | Not started | — | — | |
| 8 | Not started | — | — | |
| 9 | Not started | — | — | |
| 10 | Not started | — | — | |
| 11 | Not started | — | — | |


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

## Status tracking
Track both milestones and original phases. A milestone is not complete until its acceptance criteria are checked against the actual implementation. Do not claim performance or accessibility criteria pass without measurement or test evidence.
