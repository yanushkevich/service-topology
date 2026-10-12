# Service Topology & Registry Platform — Agent-Ready Documentation

This package is the product/architecture guide and staged implementation plan for a mock-first Service Topology and Registry Platform. It is documentation, not a completed application or proof that a backend exists.

## Development setup
All seven milestones are implemented: application shell, canonical domain model with validation, a mock multi-cloud repository, the service registry, the shared inspector, the 2D map (React Flow + ELK) with grouped infrastructure mode, shareable URLs, and saved layouts, a deterministic simulation with explainable failure propagation and snapshot history (Simulation page), and a secondary 3D galaxy view (React Three Fiber) with "Explore inside" navigation, plus Overview, Dependencies, Infrastructure, and Settings pages (Milestone 6), and an Events catalog of event types with producer/consumer flows highlighted on the map (Milestone 7). Built with React 19 + strict TypeScript + Vite, Tailwind CSS v4, React Router, Zustand, React Flow + ELK.js (2D), and Three.js + React Three Fiber (3D). All data is mock and all telemetry is simulated. Requires Node.js 22+.

Monorepo layout: the frontend is in `apps/web/`, the Go backend in `backend/`, shared contract and docs in `docs/`, shared fixtures in `fixtures/`.

```sh
cd apps/web && npm install && cd ../..
npm run dev        # start the frontend dev server (forwards to apps/web)
npm run check      # frontend: typecheck + lint + tests + production build
npm run check:backend   # backend: gofmt, go vet, go test (needs Go, see docs/backend/LOCAL_DEVELOPMENT.md)
```

Individual frontend scripts (run in `apps/web/`): `typecheck`, `lint`, `test`, `test:watch`, `build`, `preview`, `bench`, `bench:browser`, `bench:3d` (see `docs/BENCHMARKS.md`), and `audit:a11y`. Start with `docs/DEVELOPER_GUIDE.md`; the backend contract is `docs/API_CONTRACT.md`. Append `?dataset=scale-250` or `?dataset=inventory-1000` to a URL to load generated scale fixtures. Dependency versions are pinned exactly (`.npmrc` sets `save-exact`).

## Start here
1. `CLAUDE.md` — concise project-wide instructions for Claude Code.
3. `docs/ui-frontend-mock/README.md` - document, frontend mock generated 
by desgin to match/follow implementation
3. `docs/README_INDEX.md` — document authority, navigation, and what to read for a task.
4. `docs/PRODUCT_SPEC.md` — product goals, UX requirements, and scope.
5. `docs/ARCHITECTURE.md` — domain model, boundaries, state, adapters, and history/deep-link direction.
6. `docs/IMPLEMENTATION_PLAN.md` — authoritative five-milestone delivery plan (see its labeled section).
7. `docs/AGENT_WORKFLOW.md` — plan, implement, verify, and close out a scoped change.
8. `docs/DECISIONS.md` — current architectural decisions and ADR template.

## Delivery prompts
Execute one milestone at a time, in order:
- `docs/milestones/MILESTONE_01_DOMAIN_REGISTRY.md`
- `docs/milestones/MILESTONE_02_MAP_INSPECTOR.md`
- `docs/milestones/MILESTONE_03_SIMULATION_HISTORY.md`
- `docs/milestones/MILESTONE_04_NETWORK_3D.md`
- `docs/milestones/MILESTONE_05_POLISH_HARDENING.md`
- `docs/milestones/MILESTONE_06_TAILWIND_SECTIONS.md` (Revision 5)
- `docs/milestones/MILESTONE_07_EVENT_CATALOG.md` (Revision 6)

Backend (Go + MongoDB, ADR-019): `docs/backend/README.md`. Milestones B1–B6 are implemented in `backend/`; open the app with `?source=api` to use it (`docs/backend/LOCAL_DEVELOPMENT.md`).

Older phase prompts remain in `docs/phases/` for task-level traceability, but they do not replace the five-milestone delivery gates. Revision 1 files are preserved under `docs/archive/original-v1/` as historical material.

## Claude Code skills
- `/topology-domain` — domain and architecture boundaries.
- `/topology-milestone` — execute a single milestone with explicit acceptance checks.
- `/topology-ui` — React Flow/ELK topology UI implementation and accessibility/performance checks.
- `/topology-verify` — evidence-based verification and closeout.
- `/topology-docs` — maintain source-of-truth documentation without duplication or accidental contract changes.

Skills live in `.claude/skills/` and load on demand; do not copy their detailed procedures into the root `CLAUDE.md`.

## Key product constraints
- React + TypeScript; React Flow for 2D and ELK.js as default layout engine.
- The canonical domain model must remain independent of rendering libraries.
- 2D operational topology and registry are primary; 3D is a secondary milestone.
- Infrastructure hierarchy is distinct from communication edges.
- Service definitions are logical; service instances belong to exactly one environment.
- Kafka topics and RabbitMQ queues/exchanges are first-class resources when represented.
- Scale target: 250 visible nodes / 750 visible edges; 1,000 entities navigable through search/filter/grouping/neighborhood exploration. Benchmark claims require recorded evidence.
- The future API contract is illustrative and does not imply a backend implementation.

## Recommended first session
Start Claude Code at the application repository root, not necessarily this documentation folder. Ask it to inspect the real repository and `git status`, read the index and Milestone 1 prompt, produce a short plan, implement only Milestone 1, run available checks, and report evidence. If this package is copied into an existing code repository, keep the root `CLAUDE.md` concise and adapt its commands to actual project scripts.

## Revision history
- Revision 1: original product and phase prompts.
- Revision 2: explicit domain choices, five milestones, scale/accessibility criteria, history/deep-link/API direction.
- Revision 3: Claude Code-oriented context management, skills, source-of-truth hierarchy, verification workflow, and ADR index.


## Revision 4 — 3D Galaxy Experience

The active 3D design is specified in `docs/3D_GALAXY_EXPERIENCE.md`. Read it before implementing Milestone 4 or Phase 08. It defines the galaxy visual language, rotatable nodes, glowing relationship paths, hierarchical enter/exit navigation, breadcrumbs, data integrity, accessibility, motion, and performance acceptance criteria. Revision 1 archive files are retained as historical material and are not active instructions.
