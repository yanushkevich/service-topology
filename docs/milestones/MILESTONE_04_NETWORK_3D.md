# Milestone 4 — Secondary 3D network view

**Read first:** `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/API_CONTRACT.md` when relevant.

## Claude Code operating guidance
- Consult `docs/README_INDEX.md` and `docs/AGENT_WORKFLOW.md`; load only the relevant docs and this milestone.
- Use `/topology-milestone` to structure execution and `/topology-verify` for evidence-based closeout. For domain changes, also use `/topology-domain`; for graph UI, use `/topology-ui`.
- `docs/archive/original-v1/` is historical and must not override current accepted decisions.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Preserve existing data and working functionality; do not delete prior requirements or documents.
- If an architectural decision conflicts with the documented contract, explain the impact before changing it.
- Run checks and report only results actually observed.
- Update the milestone/phase status and architecture decision log when complete.
- Commit the completed milestone with a Conventional Commits message (scope `m4`), staging only its files; see `docs/AGENT_WORKFLOW.md` §6.
- Report changed files, tests and benchmarks, known limitations, and next milestone prerequisites.
- Stop after this milestone; do not automatically start the next.

## Required design reference
Read `docs/3D_GALAXY_EXPERIENCE.md` in full before implementation. It is the authoritative design and interaction contract for this milestone.

## Deliver
- Lazy-loaded React Three Fiber galaxy scene: rotatable service/resource “worlds,” semantic constellations, and curved glowing relationship paths.
- Orbit/rotate, pan, zoom, fit/reset, node focus, readable labels, selection/highlight, and an explicit **Explore inside** action.
- Hierarchical dive-in into the selected entity's modeled child scope or local neighborhood, with breadcrumbs, back-one-level, and return-to-overview controls. Restore the prior scope/camera context.
- Shared selection, filters, environment, and scope synchronized with the 2D view, registry, and inspector.
- Data-bound direction/traffic animation only where a relationship and traffic field support it; mock activity must be labeled simulated.
- Deterministic spatial grouping, containment boundaries, level-of-detail behavior, WebGL/context-loss fallback, reduced-motion behavior, pause, and resource cleanup.

## Acceptance criteria
- 2D remains the primary operational view and fully usable without WebGL.
- The scene reads as an explorable software galaxy, not a decorative screensaver or geographic globe.
- Nodes can be rotated around, zoomed, panned, selected, focused, and entered through a discoverable control.
- Dive-in displays actual modeled children or relationships, distinguishes containment from communication, and never fabricates an interior for a leaf entity.
- Breadcrumb/back/overview navigation restores the prior scope and applicable camera context.
- Switching views preserves applicable environment, filters, selected entity, and scope.
- Glowing paths have readable endpoints and direction where known; animation maps to explicit observed/simulated data and is not the only status signal.
- Labels and dependency paths are readable at tested zoom levels; keyboard/registry alternatives are available.
- 3D supports the documented default visible-graph benchmark; document measured results and test hardware/browser.
- No Three.js objects are stored in the domain model or canonical global state; renderers use stable canonical IDs.
- Reduced motion, pause, WebGL fallback/context loss, and disposal are tested.
- Do not prioritize bloom/particles over graph readability, interaction parity, and performance.

## Definition of done
The listed acceptance criteria have been verified against the implementation, integration points work, regressions introduced by this milestone are fixed, and limitations are documented.
