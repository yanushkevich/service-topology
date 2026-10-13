# Documentation Index and Authority Map

Use this file to navigate the project without loading every document into context.

## Read by task

| Task | Read first | Then, as needed |
|---|---|---|
| Understand the product | `PRODUCT_SPEC.md` | `DECISIONS.md`, relevant milestone |
| Change domain types or relationships | `ARCHITECTURE.md` | `API_CONTRACT.md`, domain-model skill |
| Start or continue implementation | `IMPLEMENTATION_PLAN.md` | One milestone prompt only |
| Implement the 2D topology | `ARCHITECTURE.md` | Milestone 2, React Flow skill |
| Add simulation or history | `PRODUCT_SPEC.md`, `ARCHITECTURE.md` | Milestone 3 |
| Add 3D galaxy view | `3D_GALAXY_EXPERIENCE.md`, `PRODUCT_SPEC.md`, `ARCHITECTURE.md` | Milestone 4; do not block 2D delivery |
| Prepare release or report status | Relevant milestone | `AGENT_WORKFLOW.md`, Milestone 5 |
| Change future backend/API assumptions | `API_CONTRACT.md` | `DECISIONS.md` |
| Styling (Tailwind) or the section pages | `PRODUCT_SPEC.md` Revision 5 | Milestone 6, ADR-013 |
| Event catalog, event types, event highlight | `PRODUCT_SPEC.md` Revision 6 | Milestone 7, ADR-014 |
| Business flows (flow board, steps, transaction replay, import) | `BUSINESS_FLOWS.md` | `PRODUCT_SPEC.md` Revision 9, Milestone 10, ADR-022, `TRANSIT_BOARD.md` |
| Transit board (per-service routes, policies, trace replay) | `TRANSIT_BOARD.md` | `PRODUCT_SPEC.md` Revision 8, Milestone 9, ADR-021, `design-references/payment-transit-board/` |
| Run all services locally | `GETTING_STARTED.md` | `backend/LOCAL_DEVELOPMENT.md`, `backend/RUNBOOK.md` |
| Go backend (MongoDB), monorepo layout | `backend/README.md` | `backend/IMPLEMENTATION_PLAN.md` (B1–B6, database migration), ADR-015, ADR-019 |
| Write or review code (components, Tailwind, hooks, Go packages, endpoints) | `CONVENTIONS.md` | `DEVELOPER_GUIDE.md` |
| Set up, test, scale, or extend the app | `DEVELOPER_GUIDE.md` | `ARCHITECTURE.md` milestone notes, `BENCHMARKS.md` |
| Backend/API work | `API_CONTRACT.md` | `api/openapi.json`, `schemas/` |
| Positioning or competitor questions | `POSITIONING.md` | `PRODUCT_SPEC.md` §I |
| Understand legacy wording | `archive/original-v1/` | Treat as historical only |

## Authority and conflict handling
- `PRODUCT_SPEC.md` and `ARCHITECTURE.md` define the current product and architecture intent. Where earlier text conflicts with explicitly marked later addenda, the later addendum is authoritative until reconciled into a clean edit.
- `IMPLEMENTATION_PLAN.md`'s explicitly labeled authoritative five-milestone plan controls delivery sequencing; older phase content is retained for traceability.
- A milestone prompt scopes one implementation unit. Do not execute all milestone prompts in one pass.
- `API_CONTRACT.md` is a future-facing proposal, not evidence of a running backend or finalized public API.
- `docs/archive/original-v1/` is immutable preservation material, not an active instruction source.
- If two current documents conflict and precedence does not resolve it, stop and report the conflict. Propose a decision instead of silently reconciling it.

## Context-efficient reading
Do not ingest every file at session start. Search by concept, read the smallest relevant section, then expand only when required. Prefer a milestone prompt plus the relevant architecture sections over the full documentation corpus.


## 3D experience authority

`3D_GALAXY_EXPERIENCE.md` is the detailed authority for the galaxy-inspired 3D view, including node/edge visual grammar, camera controls, hierarchical enter/exit navigation, breadcrumbs, data integrity, motion, performance, and acceptance tests. Milestone 4 and Phase 08 must conform to it. If a short older description elsewhere is less specific, use this specification unless a later explicit decision changes it.
