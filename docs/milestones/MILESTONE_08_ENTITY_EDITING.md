# Milestone 8 — Editing the topology (with backend Milestone B7)

**Read first:** `docs/PRODUCT_SPEC.md` (Revision 7 addendum §N), `docs/DECISIONS.md` ADR-020, `docs/API_CONTRACT.md` ("Entity writes"), `docs/backend/API_SPEC.md`.

## Global execution contract
- Inspect the current repository before changing code; implement only this milestone.
- Commit the backend (scope `b7`) and the frontend (scope `m8`) separately; see `docs/AGENT_WORKFLOW.md` §6.
- Run checks and report only results actually observed.

## Deliver
- Backend (B7): `POST /entities/{kind}`, `PUT`/`DELETE /entities/{kind}/{id}` with whole-topology validation, revision `ETag`/`If-Match`, server-set fields; OpenAPI and contract check.
- Frontend (M8): `TopologyWriter` on the HTTP repository; reload after writes; **New** menu, inspector **Edit**/**Delete**, Events page actions; side-sheet forms per kind; delete confirmation with blockers; stale-data recovery.

## Acceptance criteria
- Every kind can be created, edited, and deleted against the backend (live browser check).
- Invalid changes are reported before sending (same rules as the server) and by the server (422 mapped to fields or listed).
- Referenced entities cannot be deleted; the blockers are listed in plain words.
- A stale edit (412) is reported with a way to reload; nothing is overwritten.
- Built-in mock data and history mode are read-only, with an explanation.
- Edits start from stored, not simulated, values; telemetry stays labelled simulated.
- `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass; axe audits for the menu, form (with errors), and delete dialog pass.
