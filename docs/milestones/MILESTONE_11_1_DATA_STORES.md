# Milestone 11.1 — Data stores on both boards, and flows you can find

**Status:** implemented 2026-10-12 (closeout in `docs/IMPLEMENTATION_PLAN.md`).

**Read first:**
- `docs/BUSINESS_FLOWS.md` Revision 3, sections 14–16;
- `docs/DECISIONS.md` ADR-027 (and ADR-021, ADR-023, ADR-024);
- `docs/CONVENTIONS.md`.

## Phases (each committed on its own, scope `m11.1`)
1. **Linked dependencies.** `entityId` on transit stations; a pure resolver (`transit/links.ts`) for name, kind, health, and environment; topology health on the map, strip, tooltip, and card, with an inspector link; the `dependency-not-in-topology` rule; example links.
2. **Tables.** `tables` on the board; a route-consistency test; the database conversation in the strip, card, and tooltip; the `store-pattern-without-table` rule; example tables.
3. **Data stores on flows.**
   - A pure `dataStoresOf(index, service, environment)`.
   - Step chips with health, and the flow card's "Data stores" section.
   - Store names in outbox and inbox tooltips; the `store-pattern-without-store` rule.
4. **Findable flows.** "Used by" chips, the flow group first in the index, and flows listed on services without board data.
5. **Close-out.** Accessibility (jsdom and real browser, both themes), screenshots, docs, status.

## Acceptance criteria
- On Payment Service, `payments-pg` (primary and replica) resolves to `payments-db`. Simulating `payments-db` unavailable shows that health on the board (tested). Redis is flagged "not in the topology".
- Every table's writers and readers reach its station (tested on the example). Capture's strip shows "writes payment_outbox". OutboxRelay polls it, and the webhook's inbox is `processed_webhooks`.
- Each new rule has a test that triggers it and one that clears it.
- Checkout's steps show `orders-db`, `inventory-db`, `payments-db`, and `ledger-db` on the right steps. The settlement outbox names `payments-db`, and the ledger inbox names `ledger-db`.
- "Used by" chips toggle the flow. A service without board data lists its flows.
- `npm run check` passes (vitest with `--maxWorkers=3` under load); the real-browser audit passes.
