# Milestone 11.4 — Authoring transit boards and flows, with a local sandbox (with backend B10)

**Status:** implemented 2026-10-13 (closeout in `docs/IMPLEMENTATION_PLAN.md`).

**Read first:** `docs/TRANSIT_BOARD.md` Revision 2; `docs/DECISIONS.md` ADR-031 (and ADR-020, ADR-021, ADR-027); `docs/CONVENTIONS.md`.

## Phases (each committed on its own; scope `m11.4`, backend `b10`)
1. **Board definitions (frontend).**
   - Type, JSON Schema, and `validateBoardDefinition`.
   - Example board ↔ definition, and `boardFromDefinition`, which merges observed data.
   - Conformance fixtures.
2. **Backend B10.**
   - Go types and validation parity on the fixtures.
   - The `transitBoards` collection (MongoDB and memory), the application service, the API, OpenAPI, and the contract test.
   - Integration tests.
3. **Data plumbing.**
   - Board stores: HTTP and sandbox.
   - A composed transit repository.
   - A sandbox topology repository with writer.
   - Repository selection, and the sandbox label with reset.
4. **Board editor.** A dialog with sections and a live preview, plus create, edit, and delete entry points. Flows are editable in the sandbox.
5. **Close-out.** Accessibility (jsdom and real browser), screenshots, end-to-end against the backend, docs.

## Acceptance criteria
- Each board rule has a TypeScript and a Go test with identical codes on shared fixtures.
- With `?source=api`, a board can be created for Order Service, edited, and deleted. The read back matches. Stale writes get 412; invalid ones get 422 with codes. `make contract-check` passes.
- With mock data, flows, entities, and boards can be created, edited, and deleted in the sandbox. The edits survive a reload. Reset restores the built-in data. Everything is labelled as the local sandbox.
- A new board's lines are "not observed". The edited example board keeps its example stats on unchanged line IDs.
- The editor's preview updates while editing; errors focus their field; axe passes in jsdom and the real browser, both themes.
- `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass.
