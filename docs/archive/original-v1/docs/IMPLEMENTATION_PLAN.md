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
