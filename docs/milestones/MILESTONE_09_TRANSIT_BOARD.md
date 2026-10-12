# Milestone 9 — Transit board (spec Phase 1)

**Status:** planned, not started.

**Read first:**
- `docs/TRANSIT_BOARD.md`, especially its final section, "Reconciliation with this repository";
- `docs/PRODUCT_SPEC.md` Revision 8 §O;
- `docs/DECISIONS.md` ADR-021 (resolve its open points with the product owner first);
- `docs/ARCHITECTURE.md` Revision 8;
- the prototype in `docs/design-references/payment-transit-board/` (serve it; do not copy its markup or runtime).

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Preserve existing data and working functionality; do not delete prior requirements or documents.
- Run checks and report only results actually observed.
- Update the milestone status and decision log when complete (ADR-021 → Accepted).
- Commit each completed step and the milestone with Conventional Commits (scope `m9`); see `docs/AGENT_WORKFLOW.md` §6.
- Report changed files, checks, known limitations, and next prerequisites. Stop after this milestone.

## Deliver
- **Read model.** Transit read-model types (`TransitBoard`, `Station`, `PolicyStop`, `Line`, `Branch`, `Finding`, `TraceSummary`, `TraceStep`) in their own module, separate from the canonical domain.
- **Data.** A `TransitRepository` interface, and a mock implementation built from the prototype's Payment Service example data, converted to those types and labelled as example data.
- **Layout.** Pure functions for the track graph, the bundling offsets (global line order, 7-unit spacing, mitred corners), and the projection (t = 1.02 rad, D = 2000, F fitted to the container), with unit tests.
- **Components.** `EndpointIndex`, `TransitMap` (a static layer plus an overlay layer), `StepStrip`, and `DetailCard`, on the route `/services/:serviceId/transit`, linked from the inspector of a service instance.
- **Typical mode:**
  - the selection rules, including the shared-station chooser;
  - search by name, transport, and station;
  - provenance styles;
  - the policy states, with "missing" kept distinct from "unknown";
  - findings that highlight their step;
  - the budget bar.
- **States and layout.** Every panel state in the spec's states table, and the responsive breakpoints (below 760px: top-down 2D map and an index select; the page never scrolls horizontally).
- **Keyboard and URL.** The keyboard shortcuts, and the URL state (`line`, `mode`, `q`, `trace`, `t`).

## Out of scope
- Spec phases 2–5:
  - spec, config, and trace ingestion;
  - the backend endpoints;
  - the alias table;
  - real findings rules;
  - grouped trunks;
  - code scan.
- Trace replay, unless the product owner adds it (ADR-021 open point).

## Acceptance criteria
- The layout functions are pure and deterministic, with tests for:
  - junction insertion;
  - bundling order and offsets across shared edges;
  - the projection;
  - the shared-station detection that turns a station into a capsule.
- Selection and search change only styles: no path is rebuilt, which a test checks.
- Every state in the spec's states table renders, with a test per state. "Unknown" policies never render as "missing".
- The index and the strip expose all information without the map:
  - the map is `role="img"` with a summary label;
  - colour is never the only signal;
  - every keyboard shortcut works;
  - reduced motion is respected.
- New colours are tokens that pass `contrast.test.ts` in both themes (or a dark-only decision is recorded in ADR-021).
- The page has axe cases (jsdom; real browser in both themes).
- Example data is labelled as such, never as live.
- `npm run check` passes. Layout timings at the spec's target (60 lines, 80 stations) are measured and recorded in `docs/BENCHMARKS.md`.
