# Milestone 11.3 — Endpoint contracts from OpenAPI

**Status:** in progress (2026-10-12).

**Read first:** `docs/BUSINESS_FLOWS.md` Revision 5, section 19; `docs/DECISIONS.md` ADR-029; `docs/CONVENTIONS.md`.

## Phases (each committed on its own, scope `m11.3`)
1. **Parser and examples.**
   - `src/contracts/openapi.ts`: operations, parameters, request and response schema trees, `$ref`, `allOf`, `oneOf`, cycles, examples.
   - Example documents for Order Service and Payment Service.
   - `getOpenApi` on the transit repository.
   - Unit tests, including that every HTTP entry point in the example flows and lines resolves.
2. **Contract view.** `ContractView` (parameters, body, responses, examples) in the flow step detail; a note for non-HTTP endpoints.
3. **Process arrows.** Disclosure on messages into HTTP endpoints in both process views, and on the flow's start note.
4. **Close-out.** Accessibility (jsdom and real browser, both themes), screenshots, docs.

## Acceptance criteria
- `POST /v1/orders` shows its `Idempotency-Key` header, `CreateOrderRequest` (items as an array of objects with required `sku` and `quantity`), and the responses `201 Order`, `400`/`409` Problem, with examples (tested).
- `$ref` cycles terminate; `allOf` merges required fields; `oneOf` lists its variants (the webhook's event types) (tested).
- Place order, Request refund, and Await settlement show contracts in the step detail. Authorize payment says it is gRPC with no OpenAPI contract.
- The process arrows into those endpoints open the same contract (tested); the webhook line's first arrow does too.
- axe passes in jsdom and in the real browser, both themes. `npm run check` passes.
