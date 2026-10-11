# Milestone 7 — Event catalog

**Read first:** `docs/PRODUCT_SPEC.md` (Revision 6 addendum §M), `docs/DECISIONS.md` ADR-014, `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`, the "Events" section of `docs/ui-frontend-mock/Main.dc.html`.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Preserve existing data and working functionality; do not delete prior requirements or documents.
- Run checks and report only results actually observed.
- Update the milestone status and decision log when complete.
- Commit each completed step and the milestone with Conventional Commits (scope `m7`); see `docs/AGENT_WORKFLOW.md` §6.
- Report changed files, checks, known limitations, and next prerequisites. Stop after this milestone.

## Deliver
- Canonical `EventType` (logical; channel per environment; producer/consumer service definitions), validation rules, index, and a pure flow resolver.
- Mock event types consistent with the mock relationships.
- Contract: `eventTypes` in `topology.v1.schema.json` and OpenAPI; `ev` in URL state v1.
- Events page (catalog list + detail) at `/events` and `/events/:eventTypeId`; the simulation page moves to `/simulation` ("Simulation").
- Event highlight in 2D and 3D with a clear chip; inspector lists events carried by a channel.

## Acceptance criteria
- Every M.1 validation rule has a test; the mock inventory validates with zero issues.
- Flows are resolved from existing relationships only (no inferred edges); a producer/consumer without an instance in the environment is shown as not deployed, not as an error.
- The catalog list filters by event and channel name; detail shows producers → channel → consumers with health; selecting any of them sets the shared selection.
- Highlight in 2D/3D emphasizes exactly the resolved flow; selection takes precedence; the chip clears it; `ev` round-trips through the URL.
- History mode: the catalog and highlight use the viewed snapshot.
- Contract tests pass with event types in the schema and OpenAPI examples.
- `npm run check` passes; axe audits (jsdom and real browser, both themes) pass for Events and Simulation.
