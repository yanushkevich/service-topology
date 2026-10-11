# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Service Topology & Registry Platform — Claude Code Instructions

## Current repository state
- This repository is **documentation only**: no `package.json`, `src/`, build scripts, tests, or git history exist yet. There are no build/lint/test commands to run until Milestone 1 scaffolds the app.
- When the app is scaffolded, the planned toolchain is React + strict TypeScript + Vite, Zustand for shared state, React Flow + ELK.js for 2D, React Three Fiber for 3D (`docs/IMPLEMENTATION_PLAN.md` Phase 1, `docs/ARCHITECTURE.md` §2). Discover actual scripts from `package.json` before invoking anything, then record them in this file.
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
