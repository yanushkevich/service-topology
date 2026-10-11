# Milestone 5 — Polish, hardening, API contract, and differentiation

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
- Report changed files, tests and benchmarks, known limitations, and next milestone prerequisites.
- Stop after this milestone; do not automatically start the next.

## Deliver
- Focused animation and visual polish, with pause and reduced-motion behavior.
- Accessibility, performance, and error-state review.
- `docs/API_CONTRACT.md` defining OpenAPI 3.1 and JSON Schema strategy and illustrative payload/endpoint contracts.
- Setup, architecture, testing, scaling, and extension documentation.
- A concise competitor/workflow comparison and validated differentiation hypothesis.

## Acceptance criteria
- Normal text contrast ≥ 4.5:1; large text ≥ 3:1; applicable non-text indicators ≥ 3:1.
- Keyboard access, visible focus, accessible names, and reduced-motion behavior are verified.
- Type checking, lint, tests, and production build pass or failures are explicitly reported.
- Animation resources are cleaned up and no frame-frequency React state updates are used.
- Performance measurements and known limitations are documented honestly.
- Positioning does not claim superiority over Backstage, Datadog Service Map, Dynatrace, or Kiali without evidence.

## Definition of done
The listed acceptance criteria have been verified against the implementation, integration points work, regressions introduced by this milestone are fixed, and limitations are documented.
