# Phase 04 — Visualization workspace

**Read first:** `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/IMPLEMENTATION_PLAN.md`.

## Global instructions
- Inspect the current repository and relevant code before changing anything.
- Implement only this phase; do not automatically proceed to the next phase.
- Preserve working features and shared contracts.
- If a major architecture change is necessary, explain its reason and downstream impact before making it.
- Run relevant type checks, lint, tests, and build. Report only commands actually run and their actual results.
- Update `docs/ARCHITECTURE.md` for material decisions and `docs/IMPLEMENTATION_PLAN.md` status when work is complete.
- Commit the completed phase with a Conventional Commits message (scope `phase-04`), staging only its files; see `docs/AGENT_WORKFLOW.md` §6.
- At the end, report changed files, acceptance criteria, actual check results, known limitations, and next-phase prerequisites.

## Objective
Visualization workspace

## Scope
Build toolbar, view switcher, shared filters, legend, layer controls, overlays, view host, placeholders, loading/empty/error/no-results states, and stable view interfaces.

## Acceptance criteria
Acceptance: switching works, controls use shared state, workspace remains independent of renderer internals.

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
