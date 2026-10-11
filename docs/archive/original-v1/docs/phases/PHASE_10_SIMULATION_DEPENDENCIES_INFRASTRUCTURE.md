# Phase 10 — Simulation, dependency analysis, and infrastructure view

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
Simulation, dependency analysis, and infrastructure view

## Scope
Add simulated traffic/latency and health transitions, deterministic failure/recovery, upstream/downstream analysis, infrastructure grouping, and appropriate events/traffic presentation.

## Acceptance criteria
Acceptance: simulation is renderer-independent, updates all views consistently, transitions are tested, simulated data clearly labeled.

## Definition of done
The acceptance criteria pass, integration points work, previous functionality remains intact, and limitations are documented. Stop after reporting the result.
