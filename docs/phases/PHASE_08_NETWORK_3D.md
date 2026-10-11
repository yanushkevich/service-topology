# Phase 08 — Functional 3D network

**Read first:** `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Global instructions
- Inspect the current repository and relevant code before changing anything.
- Implement only this phase; do not automatically proceed to the next phase.
- Preserve working features and shared contracts.
- If a major architecture change is necessary, explain its reason and downstream impact before making it.
- Run relevant type checks, lint, tests, and build. Report only commands actually run and their actual results.
- Update `docs/ARCHITECTURE.md` for material decisions and `docs/IMPLEMENTATION_PLAN.md` status when work is complete.
- At the end, report changed files, acceptance criteria, actual check results, known limitations, and next-phase prerequisites.

## Objective
Build the secondary 3D network as an explorable galaxy of service/resource nodes, glowing relationship paths, semantic clusters, and hierarchical dive-in navigation.

## Required design reference
Read and follow `docs/3D_GALAXY_EXPERIENCE.md`. Do not implement only a static orbital visualization; the user must be able to explore a node's modeled contents and navigate back out.

## Scope
Lazy-load R3F; implement deterministic spatial grouping, node silhouettes/halos, curved glowing paths, direction markers where known, orbit/rotate/zoom/pan, focus/reset/fit, selection and readable labels. Add an explicit **Explore inside** action, child-scope/local-neighborhood rendering, breadcrumbs, back-one-level, return-to-overview, and restoration of prior scope/camera context. Keep containment separate from communication. Synchronize shared filters, environment, selected entity, scope, registry, and inspector. Add reduced-motion behavior, pause, WebGL/context-loss fallback, level-of-detail safeguards, and correct resource cleanup. Animate traffic only when backed by explicit data; mock traffic must be labeled simulated. Do not fabricate children or links.

## Acceptance criteria
- Same canonical IDs and shared state as 2D; context persists across views.
- Galaxy composition, rotatable nodes, glowing paths, semantic grouping, and labels are usable rather than decorative.
- Enter/back/breadcrumb/overview navigation works for entities with children and leaf entities.
- The current scope reflects real model relationships; containment and communication are visually distinct.
- Graceful fallback, reduced motion, pause, and resource disposal are verified.
- Scene objects stay out of domain/global state; measured performance results are reported.

## Definition of done
The acceptance criteria pass, integration points work, previous functionality remains intact, and limitations are documented. Stop after reporting the result.


## Revision 2 global clarifications
- The recommended delivery-level sequence is in `docs/IMPLEMENTATION_PLAN.md` under “Revision 2 — Recommended Milestone Delivery Plan”; use the five milestone prompts in `docs/milestones/` for milestone execution.
- React Flow is required for 2D topology. ELK.js is the default layout engine behind an adapter; do not assume nodes avoid overlap without a layout computation and tests.
- Treat Infrastructure as a grouped layout mode over the same topology for the initial release.
- 2D is the primary operational view; 3D is secondary and must not delay the 2D acceptance criteria.
- Use the explicit data-model decisions in the Revision 2 addenda of `PRODUCT_SPEC.md` and `ARCHITECTURE.md`: service definitions vs per-environment instances, first-class topic/queue resources, explicit containment hierarchy, and communication separate from containment.
- Meet the documented scale target: 250 visible nodes / 750 visible edges; 1,000 total entities navigable through filtering/grouping rather than all rendered at full detail.
- Plan for versioned topology snapshots, URL deep links, saved layouts, and OpenAPI 3.1 / JSON Schema contracts as described in the core docs.
- Do not remove original requirements or docs to satisfy a new request; preserve them and document superseding decisions explicitly.
