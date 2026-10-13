# Milestone 11.2 — Process view (sequence diagram) and visible endpoints

**Status:** in progress (2026-10-12).

**Read first:** `docs/BUSINESS_FLOWS.md` Revision 4, sections 17–18; `docs/DECISIONS.md` ADR-028; `docs/CONVENTIONS.md`.

## Phases (each committed on its own, scope `m11.2`)
1. **Process model and builders.**
   - `transit/process.ts`, with the declared example fields: A5's condition, J2's `parallel`, OutboxRelay's `repeat`, and the transactions of Capture and the webhook.
   - Unit tests for each fragment kind on both boards.
2. **Renderer and the switches.**
   - `ProcessDiagram` (ordered list on a subgrid, lifelines, fragments).
   - Stops ↔ Process on the service board; Stages ↔ Process on the flow board; the `strip` page parameter.
3. **Endpoints.** The "Endpoints" heading in the index, and the selected line's endpoint label on the map.
4. **Close-out.** Accessibility (jsdom and real browser, both themes), screenshots, docs.

## Acceptance criteria
- A2 Capture's process has a `loop` (retry ×3) around the card call, and a `transaction` with the `payments` and `payment_outbox` writes. A5 has an `opt` "cache miss · 6%". OutboxRelay is inside a `loop` "every 200 ms". J2 has a `par`. Checkout has an `alt` at Authorize payment (approved / declined), an `opt` for the settlement timeout and for the void (unconditional exits always run), a `loop` for redelivery, and a `compensation` into Void authorization (tested).
- The view reads as an ordered list (axe passes in jsdom and the real browser, in both themes), and the switch is kept in the URL.
- The selected line's endpoint shows on the map; the index says "Endpoints".
- `npm run check` passes.
