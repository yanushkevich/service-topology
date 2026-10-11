# Phase Prompt Template

Use this template for each implementation iteration. Keep the product spec and architecture as the persistent source of truth.

## Read first
- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/phases/PHASE_[NN]_[NAME].md`
- Relevant existing code and tests

## Current phase
**Phase:** [number and name]  
**Objective:** [one-sentence outcome]

### Scope
- [Specific deliverable]
- [Specific deliverable]

### Out of scope
- [Later-phase feature]
- [Later-phase feature]

### Architectural constraints
- Preserve canonical domain types and renderer boundaries.
- Keep business logic out of rendering components.
- Do not silently break existing behavior or shared contracts.
- Explain material architectural changes and their downstream impact before making them.

### Acceptance criteria
- [Observable, testable criterion]
- [Relevant tests/checks pass]

### Required workflow
1. Inspect repository and current code.
2. Outline the plan and identify conflicts before major changes.
3. Implement only this phase.
4. Run type checking, lint, tests, and build where available.
5. Fix regressions introduced by this phase.
6. Update architecture and status docs where needed.
7. Report changed files, actual checks/results, known limitations, and next-phase prerequisites.
8. Stop; do not automatically begin the next phase.

### Definition of done
Acceptance criteria pass, integration points work, previous functionality remains intact, and limitations are documented.
