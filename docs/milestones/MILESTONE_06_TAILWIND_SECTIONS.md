# Milestone 6 — Tailwind migration and complete section pages

**Read first:** `docs/PRODUCT_SPEC.md` (Revision 5 addendum §J–L), `docs/ARCHITECTURE.md`, `docs/DEVELOPER_GUIDE.md`, `docs/IMPLEMENTATION_PLAN.md`.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Preserve existing data and working functionality; do not delete prior requirements or documents.
- Run checks and report only results actually observed.
- Update the milestone/phase status and architecture decision log when complete.
- Commit each completed step and the milestone with Conventional Commits (scope `m6`), staging only its files; see `docs/AGENT_WORKFLOW.md` §6.
- Report changed files, checks, known limitations, and next prerequisites. Stop after this milestone.

## Deliver
- Tailwind CSS v4 with the design tokens as theme (default palette disabled); all CSS Modules migrated; shared UI primitives for repeated patterns.
- Overview, Dependencies, Infrastructure, and Settings pages per PRODUCT_SPEC §K.
- Local preferences (theme incl. system, motion override, 2D/3D defaults, simulation speed) behind an interface.

## Acceptance criteria
- No `*.module.css` files remain; Tailwind utilities (plus layered component CSS for glyphs and third-party overrides) style the app.
- Only token colors are available as utilities; `apps/web/src/styles/contrast.test.ts` passes.
- Both themes render without visual regression (screenshot review of map, registry, events, 3D, and the new pages).
- Each new page meets its §K requirements, uses canonical data and shared state, honors history mode, and has empty states.
- Dependencies' impact preview uses the propagation rules and never changes simulation state.
- Infrastructure hierarchy comes only from `parentResourceId` and is keyboard-operable as a tree.
- Settings persist locally; the motion override disables animations app-wide; nothing in Settings becomes canonical state.
- `npm run check` passes; axe audits (jsdom and real browser, both themes) pass for all pages, including the new ones.
