# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Service Topology & Registry Platform — Claude Code Instructions

## Current repository state
- Milestones 1–7 are implemented (2026-10-11): shell, canonical domain + validation (`apps/web/src/domain`), mock repository (`apps/web/src/data`), registry, shared inspector, React Flow 2D map with ELK layout in a Web Worker, grouped infrastructure mode, URL state, saved layouts, deterministic simulation with explainable failure propagation (`apps/web/src/simulation`, `apps/web/src/domain/propagation.ts`), snapshot history ("as of", compare), the lazy-loaded 3D galaxy (`apps/web/src/features/service-map/galaxy`; three/R3F/drei/gsap pinned), the Overview, Dependencies, Infrastructure, and Settings pages with local preferences (Milestone 6), and the Events catalog of event types on topics/queues with map highlighting (Milestone 7; the simulation/history page is `/simulation`). React 19 + strict TypeScript + Vite 8, React Router 8, Zustand 5, `@xyflow/react` 12, `elkjs` 0.12. Code map: `docs/ARCHITECTURE.md` → "Milestone 1/2 implementation notes"; map decisions: ADR-009; simulation/history decisions: ADR-010; 3D decisions: ADR-011; a11y/API/positioning: ADR-012; Tailwind: ADR-013; event types: ADR-014; how-to: `docs/DEVELOPER_GUIDE.md`; measurements: `docs/BENCHMARKS.md`; contract extensions and data-model decisions: ADR-008 (all confirmed; no open questions).
- **Monorepo layout (2026-10-11):** frontend in `apps/web/` (run npm scripts there, or from the root, which forwards `dev`, `build`, `test`, `check`); Go backend in `backend/`; shared contract and docs in `docs/`; shared fixtures in `fixtures/`. Vite allows reading `../../docs` and `../../fixtures` (`apps/web/vite.config.ts`).
- Frontend scripts (from `apps/web/package.json`, run in `apps/web/`): `npm run dev`, `npm run typecheck` (`tsc -b`), `npm run lint` (ESLint 10 + typescript-eslint), `npm test` (Vitest + Testing Library, jsdom), `npm run build`, `npm run preview`, `npm run check` (all of typecheck → lint → test → build), `npm run bench` (Node layout timings), and `npm run bench:browser -- --url <preview-url>` (headless-Chrome timings against `vite preview`), `npm run bench:3d -- --url <preview-url> [--gpu]` (3D timings; SwiftShader without `--gpu`), and `npm run audit:a11y -- --url <preview-url>` (real-browser accessibility audit). `?dataset=scale-250` / `?dataset=inventory-1000` load generated scale fixtures. Single test file: `npx vitest run apps/web/src/domain/validation.test.ts`. Integration tests render the app through `apps/web/src/test/renderApp.tsx` (memory router + injectable topology, saved-layout, and snapshot repositories) and reset the store with `resetUiStore()`. Inside the React Flow canvas use `fireEvent.click`, not user-event: user-event's `mousedown` has `view: null`, which d3-drag/d3-zoom cannot handle in jsdom.
- TypeScript is pinned to 6.0.x because typescript-eslint 8.71 supports `<6.1`; do not bump to TS 7 until it does.
- Accessibility is enforced: token contrast (`apps/web/src/styles/contrast.test.ts`), axe in jsdom (`apps/web/src/test/a11y.test.tsx`), keyboard journeys, and the API contract (`apps/web/src/contract/contract.test.ts`) all run in `npm test`. New colors go in `tokens.css` and must pass the contrast test; new pages need an a11y test case.
- Simulated/mock data must never be described as live (a test checks page text for the word). Simulation must not run in renderers or animation frames; it is stepped by `useSimulationTicker` only.
- 3D tests: pure layers (`scope`, `layout3d`, `sceneModel`) run in jsdom; the Three.js scene is tested with `@react-three/test-renderer` (no WebGL). jsdom has no WebGL, so app-level tests see the 3D fallback.
- Styling: Tailwind CSS v4 (ADR-013) over the tokens in `apps/web/src/styles/tokens.css` (dark/light via `data-theme` on `<html>`). The default palette is disabled, so only token utilities exist (`bg-surface-1`, `text-fg-2`, `border-line`, `text-warn-fg`, …; mapping in `apps/web/src/styles/global.css`). Use shared primitives from `apps/web/src/shared/ui/primitives.tsx` / `classes.ts`; put glyph artwork and third-party overrides in `apps/web/src/styles/components.css`. No CSS Modules. Use the `*-fg` text tokens for status/accent text; the raw light-theme status colors fail 4.5:1. Test hooks use data/ARIA attributes, not class names.
- Backend: Go 1.27 + ArcadeDB, specified in `docs/backend/` (start at `docs/backend/README.md`), code in `backend/` (ADR-015, ADR-016). All backend milestones B1–B6 are implemented (foundation, ArcadeDB persistence, REST API for contract v1, traversal/impact/event types, isolated simulation runs, security/hardening/frontend integration). The frontend uses the backend with `?source=api` (`apps/web/src/data/http/`). Operations: `docs/backend/RUNBOOK.md`; security: ADR-018. `make bench` measures API latency (results in `docs/BENCHMARKS.md`). `make contract-check` validates the running API against `docs/api/openapi.json`. Read `backend/CLAUDE.md` before backend work. Checks: `make -C backend check` (Go may not be on `PATH`: add `GO=/usr/local/go/bin/go`), or `npm run check:backend` from the root. Shared fixtures in `fixtures/` are generated by `apps/web` (`npm run fixtures:update`); the Go validator must match `validateTopology` on them. The backend implements `docs/api/openapi.json` and the rules in `apps/web/src/domain/validation.ts`; it must not define a parallel API or domain. `docs/backend/scaffold/` holds inactive files for `backend/`.
- `README.md` lists `/topology-*` skills in `.claude/skills/`, but that directory does not exist yet. Do not assume those skills are available.
- `docs/ui-frontend-mock/` is a design reference exported from a design tool, not production code. Replicate its values (colors, spacing, type, radii, layout from inline styles in `Main.dc.html`) in real components; do not copy its markup or runtime. To view it, serve the folder (`python3 -m http.server`) and open `Main.dc.html`.

## Start here
- Product requirements: `docs/PRODUCT_SPEC.md`
- Frontend UI generated mock: `docs/ui-frontend-mock/README.md`
- Architecture and domain boundaries: `docs/ARCHITECTURE.md`
- Current delivery order and gates: `docs/IMPLEMENTATION_PLAN.md`
- Navigation and source-of-truth rules: `docs/README_INDEX.md`
- Decision record: `docs/DECISIONS.md`
- Per-session procedure (orient → plan → implement → verify → close out): `docs/AGENT_WORKFLOW.md`

## Non-negotiable project constraints
- Explore the existing repository before planning or editing. Treat this package as project guidance, not proof that an application implementation already exists.
- Follow the canonical domain model; keep domain/business logic independent of React Flow, Three.js, and UI state.
- React Flow + ELK.js is the default 2D topology stack. The 2D operational view and accessible registry take priority; 3D is a later, secondary view. For all 3D work, follow `docs/3D_GALAXY_EXPERIENCE.md`: galaxy-like rotatable nodes, glowing data-backed paths, and reversible enter/exit navigation into real modeled scopes.
- Infrastructure containment hierarchy is distinct from communication relationships. Service definitions are logical; service instances belong to exactly one environment. Kafka topics and RabbitMQ queues/exchanges are first-class resources when represented.
- Implement only the requested milestone/phase. Do not silently broaden scope or start the next milestone.
- Never claim a command, test, benchmark, visual inspection, or acceptance criterion passed unless you ran it and observed the result. If tooling/scripts are absent, say so and propose the smallest useful check.
- Keep mock/simulated telemetry clearly distinguishable from observed/integrated data. Do not invent cloud integrations or backend endpoints.
- Preserve unrelated changes and existing user work. Avoid destructive commands and broad rewrites without explicit justification.

## Architecture in brief
- **Data flow:** Repository (mock now, adapters later) → canonical domain entities → selectors + shared state → per-view adapters (React Flow nodes/edges, 3D scene entities, infrastructure grouping, registry rows). React Flow nodes and Three.js objects are view models only; domain types must not extend them, and Three.js objects must never be stored in Zustand.
- **State ownership:** Zustand holds cross-view state only: selection (canonical entity type + ID), active view, environment, shared filters, visible layers, theme, and simulation controls. Viewport, drag, hover, refs, GSAP timelines, and per-frame animation stay local to components. Never update global state every frame.
- **Cross-view contract:** Registry, 2D, and 3D share one selection keyed by canonical ID. Switching views preserves selection, environment, and filters. If a filter hides the selected entity, handle it visibly and consistently.
- **Scale target (ADR-005):** 250 visible nodes / 750 visible edges, with 1,000 entities navigable through search, filters, grouping, and neighborhood exploration. Performance claims require recorded measurements.
- `docs/API_CONTRACT.md` is illustrative (OpenAPI 3.1 / JSON Schema direction). It does not describe a backend that exists.

## Working method
1. For multi-file or architectural work, inspect first and present a concise plan before implementation.
2. Read only the product/architecture sections and milestone/skill guidance relevant to the task; use skills for repeatable workflows.
3. Prefer small, reviewable changes. Reuse existing patterns and dependencies before introducing abstractions or packages.
4. Verify with the repository's actual scripts: focused tests first, then relevant typecheck/lint/build and UI checks where available.
5. Update documentation when behavior, contracts, decisions, or acceptance status changes.
6. Finish with changed files, exact commands and observed outcomes, unresolved risks, and next prerequisites. Stop at the requested scope.
7. **Commit after every completed milestone or phase** (standing instruction from the product owner). Commit only once its checks pass and status docs are updated. Use Conventional Commits with the milestone/phase as scope (e.g. `feat(m2): add React Flow topology with ELK layout`). Commit directly on `main` (no branches unless asked); do not push unless asked. Stage only that unit's files. Full procedure: `docs/AGENT_WORKFLOW.md` §6.

## Source-of-truth precedence
1. Explicit user direction for the current task.
2. Latest approved decisions in `docs/DECISIONS.md` and authoritative Revision 2 / later addenda in core product and architecture docs.
3. Current milestone acceptance criteria and `docs/IMPLEMENTATION_PLAN.md`.
4. Earlier phase prompts and archived Revision 1 material, which are historical references and do not override later decisions.

Revisions are added to the end of the core docs. In `ARCHITECTURE.md`, `PRODUCT_SPEC.md`, and `IMPLEMENTATION_PLAN.md`, check the "Revision 2" and "Revision 4" sections near the bottom before relying on earlier sections. Delivery follows the five milestones (`docs/milestones/`, in order). The 12 phases in `docs/phases/` are substeps only. `docs/archive/original-v1/` is historical and not an active instruction.

## Context management
- Do not read the full archive or consolidated reference by default. Search for the relevant section/file first.
- Use `/clear` between unrelated tasks and summarize key decisions before context becomes unwieldy.
- Use a fresh session for implementation after a large exploration/planning pass when practical.
