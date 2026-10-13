# Milestone 12 — Flows in impact analysis and simulation (with backend B9)

**Status:** specified, not started (2026-10-12). Do not start without the product owner's go-ahead.

**Read first:**
- `docs/BUSINESS_FLOWS.md` Revision 2, section 12;
- `docs/DECISIONS.md` ADR-025 (and ADR-010, ADR-017, ADR-022);
- `docs/CONVENTIONS.md` §4.5 (parity).

## Phases
1. **`flowImpact` in TypeScript.** A pure function in `domain/`, with conformance fixtures: affected steps with their cause chains, the first affected step on the typical path, and the likely outcome.
2. **Backend B9.** A Go port with parity on the fixtures; the impact response gains the optional `flows` (OpenAPI, contract test).
3. **Surfaces.** The inspector's "Business flows affected", the simulation page's list, the flow board banner with affected steps marked in the swimlane, and a catalog column. Everything is labelled *simulated*.
4. **Close-out.** Accessibility, screenshots, docs.

## Acceptance criteria
- TypeScript and Go give identical `flows` on the shared fixtures.
- The example scenario (the card processor unavailable) marks Checkout's Authorize payment and Refund's Refund payment as affected, with Cancelled and Rejected as the likely outcomes.
- Every surface labels the result as simulated, and nothing is called live (tested).
- `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass.
