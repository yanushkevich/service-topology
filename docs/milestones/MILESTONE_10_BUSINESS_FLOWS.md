# Milestone 10 — Business flows (with backend Milestone B8)

**Status:** planned, not started.

**Read first:**
- `docs/BUSINESS_FLOWS.md`;
- `docs/DECISIONS.md` ADR-022 (and ADR-014, ADR-020, ADR-021);
- `docs/PRODUCT_SPEC.md` Revision 9 §P;
- `docs/ARCHITECTURE.md` Revision 9;
- `docs/TRANSIT_BOARD.md`.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Run checks and report only results actually observed.
- Commit each completed phase with Conventional Commits: scope `m10` for the frontend, `b8` for the backend (`docs/AGENT_WORKFLOW.md` §6).
- Update the status docs when done. Stop after this milestone.

## Phases (each one is committed on its own)
1. **Model and validation (frontend).**
   - `BusinessFlow` types, validation rules, the per-environment resolver, the index, and the JSON Schema and OpenAPI additions (optional `businessFlows`).
   - Example **Checkout** and **Refund** flows over the example topology. Any backing relationship or event-type producer or consumer that is missing is added explicitly.
   - Regenerated shared fixtures.
2. **Backend B8, part 1.**
   - Go types and validation parity.
   - A `businessFlows` collection; flows in `GET /topology` and in snapshots; `business-flow` as a writable entity kind (imported flows refused).
   - Integration and contract checks.
3. **Flows catalog and flow board.**
   - The **Flows** navigation entry, the catalog, and `/flows/:flowId`.
   - The layout's placement strategy: step rank for columns, service bands for rows. Decisions, outcomes, undo tracks, and interchanges.
   - The flow card: target, budget bar, outcomes, findings, source.
   - Drill-down to the transit board and back. Inspector links from services and event types.
4. **Typical mode with observed data (example).**
   - Per-step stats, outcome shares, policy states on transitions, completion rate and time, and the window selector.
   - Flow-level findings: retry amplification, missing compensation, no dead-letter queue, deadline above target.
5. **Business-transaction replay.**
   - Example transactions derived from the example traces' business keys.
   - Samples (slowest, failed, compensated, with retries, typical) and entry by business key.
   - Compressed waits, retries, redeliveries, dead-letter parking, compensation along the undo track, and uncorrelated gaps.
   - Drill-down into a step's own trace. Keyboard, reduced motion, and URL state.
6. **Authoring.**
   - A "Flow" entry in the New menu and a flow form: steps, transitions with pick-lists, conditions, policies, and outcomes.
   - Edit and delete through the entity API with whole-topology validation.
   - Imported flows are read-only, with "Duplicate as authored flow".
7. **Backend B8, part 2: import.**
   - Importer port and adapters for the native JSON/YAML file and BPMN 2.0, exposed as `POST /imports/business-flows` and `make import-flows`.
   - Idempotent re-import; unmapped tasks are rejected with their names.
8. **Close-out.**
   - Real-browser audit pages, screenshots in both themes at the three widths, benchmarks at 50 flows × 40 steps, and the docs and status updates.

## Acceptance criteria
- Every validation rule is tested in TypeScript and Go, with identical codes on the shared fixtures. The example flows validate with zero issues in every environment where their services run.
- No transition exists without a backing relationship or event type; a test removes one and expects the error.
- The flow board reuses the transit layout pipeline, and selection and replay do not rebuild paths (tested).
- Drill-down opens the right service board, line, and trace, and returns.
- Replay joins steps by business key. Uncorrelated gaps are shown, never bridged. Compensation runs on the undo track.
- Authored flows can be created, edited, and deleted against the backend. Imported flows cannot be edited. A re-import is a no-op.
- The real-browser axe audit passes for the catalog, the board, replay, and the flow form in both themes. Keyboard access and reduced motion work.
- Example observed data is labelled as example data.
- `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass.
- Layout timings at 50 flows × 40 steps are recorded in `docs/BENCHMARKS.md`.

## Open questions (not blocking)
`docs/BUSINESS_FLOWS.md` section 8: the business-key attribute in real traces, flow ownership, and the first orchestrator adapter after BPMN.
