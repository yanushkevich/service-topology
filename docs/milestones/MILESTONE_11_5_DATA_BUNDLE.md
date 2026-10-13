# Milestone 11.5 — Export and import all data as JSON or YAML (with backend B11)

**Status:** in progress (2026-10-13).

**Read first:** `docs/DATA_BUNDLE.md`; `docs/DECISIONS.md` ADR-032 (and ADR-031); `docs/CONVENTIONS.md`.

## Phases (each committed on its own; scope `m11.5`, backend `b11`)
1. **Bundle (frontend).** Schema, `bundleOf`, serialisation to JSON and YAML, parsing, and `validateBundle`; conformance fixtures shared with Go.
2. **Backend B11.** Bundle validation in Go on the fixtures; an atomic replace of topology and boards (MongoDB and memory); `POST /imports/bundle`; OpenAPI; contract check; integration test.
3. **Data plumbing.** Board stores can list. A bundle importer on the sandbox and HTTP repositories.
4. **Settings UI.** Export and import rows with counts, preview, issues, and confirmation.
5. **Close-out.** Accessibility (jsdom and real browser), screenshots, end to end against the backend, docs.

## Acceptance criteria
- Exporting the sandbox as JSON and as YAML, then importing either file, gives identical data (round-trip test). The files validate against the schema.
- The export contains every module, the boards stored in the sandbox, and the example board's definition.
- An invalid file shows its issues and cannot be imported. Codes are identical in TypeScript and Go on shared fixtures.
- With `?source=api`: importing a bundle replaces topology and boards in one transaction; a stale `If-Match` gets 412; an invalid bundle gets 422 and writes nothing; `make contract-check` passes.
- Generated datasets export but do not import, and say so.
- axe passes in jsdom and the real browser, both themes. `npm run check`, `make check`, `make test-integration`, and `make contract-check` pass.
