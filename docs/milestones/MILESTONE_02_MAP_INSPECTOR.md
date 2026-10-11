# Milestone 2 — 2D map, inspector, and grouped infrastructure mode

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
- React Flow 2D graph using ELK.js behind a layout service interface.
- Node/edge adapters from canonical domain data.
- Search/focus, filters, pan/zoom, selection, connection inspection, dependency highlighting, and a functional inspector.
- Infrastructure mode as grouping/layout of the same topology, not a separate graph implementation.
- Versioned URL-state codec and saved-layout schema; implement persistence behind interfaces.

## Acceptance criteria
- Initial layout has no overlapping node bounding boxes in required fixtures.
- Layout is deterministic for identical inputs/configuration.
- Selection and filters synchronize between registry, graph, and inspector.
- URL state supports active view, environment, selected entity, and supported filters; browser back/forward restores state.
- Saved layouts contain serializable canonical IDs/positions/options, not renderer objects.
- Benchmark 250 visible nodes / 750 edges; document machine/browser and results.
- A 1,000-entity inventory remains navigable via search, filtering, grouping, and neighborhood exploration.
- Include tests for layout fixtures, filters, selection, and URL codec.

## Definition of done
The listed acceptance criteria have been verified against the implementation, integration points work, regressions introduced by this milestone are fixed, and limitations are documented.
