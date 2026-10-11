# Phase 02 — Domain model, mock data, and repository

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
Domain model, mock data, and repository

## Scope
Define canonical typed services, connections, providers, environments, health, protocols, and metrics. Add validation, repository interface/mock implementation, selectors, and 15+ connected services across AWS/Azure/GCP/on-prem.

## Acceptance criteria
Acceptance: unique IDs, valid references, domain has no renderer imports, simulated data labeled, tests cover integrity/selectors.

## Definition of done
The acceptance criteria pass, integration points work, previous functionality remains intact, and limitations are documented. Stop after reporting the result.
