# Phase 03 — Shared state and interaction contracts

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
Shared state and interaction contracts

## Scope
Define shared selected entity (type+ID), active view, environment, filters, layers, theme/preferences, and relevant simulation controls. Implement Zustand stores/selectors and document cross-view ownership.

## Acceptance criteria
Acceptance: testable actions, applicable state persists across views, no Three.js objects or frame-frequency values in global state.

## Definition of done
The acceptance criteria pass, integration points work, previous functionality remains intact, and limitations are documented. Stop after reporting the result.
