# Milestone 11 — Flow swimlanes, flows on the service board, and the pattern catalog

**Status:** implemented 2026-10-12 (closeout in `docs/IMPLEMENTATION_PLAN.md`).

**Read first:**
- `docs/BUSINESS_FLOWS.md` Revision 2, sections 9–11;
- `docs/DECISIONS.md` ADR-023 and ADR-024 (and ADR-021, ADR-022);
- `docs/PRODUCT_SPEC.md` Revision 10 §Q;
- `docs/CONVENTIONS.md`.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its acceptance criteria. Milestones 12 and 13 are specified, not started.
- Run checks and report only results actually observed.
- Commit each completed phase with Conventional Commits, scope `m11` (`docs/AGENT_WORKFLOW.md` §6). The backend enumeration change goes in the same commit as the schema and fixtures, because the Go parity test checks them together.
- Update the status docs when done. Stop after this milestone.

## Phases (each one is committed on its own)
1. **Pattern catalog.**
   - `domain/patterns.ts`.
   - The two policy types become subsets of it, and the service board's tags become catalog IDs.
   - Labels and descriptions come from the catalog in tooltips, legends, cards, and the flow form.
   - `inbox`, `polling-publisher`, and `async-request-reply` are added to the schema, TypeScript, Go (`fields.go`), and the fixtures.
   - The three findings are added.
   - The examples use them where the topology already has them: Checkout's settlement-to-ledger hand-off is relayed by the outbox poller, and its consumer is an inbox.
2. **Swimlane layout.** `transit/flows/swimlane.ts`: lanes, columns, stacking, orthogonal routing with a separate track per edge, return tracks, label and policy positions. Unit tests cover determinism, no overlapping vertical tracks in a channel, back edges, and the timing at 40 steps.
3. **Swimlane renderer.**
   - React Flow nodes for steps, outcomes, and lanes; one routed-edge type.
   - The flow board switches to it. Search, findings focus, step selection, the "also in" markers, and replay (current-step ring, traversed edges, divergence) all work on data attributes only.
   - The tilted multi-flow map code is removed from the flow board.
4. **Flows on the service board.**
   - `lineForStep` is shared with retry amplification.
   - The index gains a "Business flows" group, a `flow` page parameter, and line highlighting.
   - The line card gains "Used by business flows", with links back. Steps without a matching line are listed as such.
5. **Close-out.**
   - Accessibility in jsdom and the real browser, screenshots in both themes at 1440, 1000, and 390 px, and layout timings.
   - Docs and status updates.

## Acceptance criteria
- Every pattern label shown on either board comes from the catalog (tested). The three new values pass the TypeScript and Go validators and the contract test. Fixtures are regenerated, and both suites pass on them.
- Each new finding has a test that triggers it and a test that clears it.
- The swimlane draws one flow, with every step in its service's lane and outcomes in the last lane. Vertical tracks in a channel never overlap (tested). Selection, search, and replay change no node position or edge path (tested).
- Steps shared with other flows show "also in …" and link to that flow.
- Replay marks the current step, the traversed transitions, and the divergence. Keyboard access and reduced motion work as before.
- The service board lists the flows that use it. Selecting one highlights exactly the lines its steps enter (tested on Payment Service: Checkout → Authorize, Capture, Void, and the processor webhook). The line card links back, and the round trip keeps the environment and window.
- axe passes in jsdom and in the real browser for the flow board, replay, and the service board with a flow selected, in both themes. No page scrolls horizontally at 390 px.
- `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass.
