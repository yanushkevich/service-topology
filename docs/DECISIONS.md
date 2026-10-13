# Architecture Decision Record (ADR) Index

This file records current approved direction and provides a place to log future changes. It is not a claim that all decisions have been implemented.

## ADR-001 — Canonical domain model independent of renderers
- **Status:** Accepted direction
- **Decision:** Domain entities, validation, traversal, filtering, and simulation logic must not depend on React Flow or Three.js types. Use adapters for renderer-specific models.
- **Reason:** Enables synchronized views and replacement of rendering technology without rewriting domain behavior.

## ADR-002 — React Flow and ELK.js for the primary 2D topology
- **Status:** Accepted direction
- **Decision:** Use React Flow for interactive 2D graph rendering and ELK.js as the default layout engine, behind an adapter boundary where practical.
- **Reason:** Keep interactive graph UI and layout strategy separable.

## ADR-003 — 2D first; 3D is secondary
- **Status:** Accepted direction
- **Decision:** Deliver a usable, accessible 2D operational view and registry before the optional immersive 3D view. 3D must not delay core 2D usability.

## ADR-004 — Separate service definitions, instances, resources, and relationships
- **Status:** Accepted direction
- **Decision:** A `ServiceDefinition` is a logical service; each `ServiceInstance` belongs to exactly one environment. Infrastructure resources use stable parent-resource IDs for containment. Communication relationships are separate. Kafka topics and RabbitMQ queues/exchanges are first-class resource entities when shown.

## ADR-005 — Explicit scale target and measured claims
- **Status:** Accepted direction
- **Decision:** Target 250 visible nodes / 750 visible edges; support navigation across 1,000 total entities with search, filters, grouping, and neighborhood exploration. Measure and document results; do not assume performance.

## ADR-006 — Future API contract, not an implied backend
- **Status:** Accepted direction
- **Decision:** OpenAPI 3.1 and JSON Schema are the intended contract standards. `docs/API_CONTRACT.md` contains illustrative endpoint shapes only; authentication, tenancy, pagination, error semantics, and retention must be decided before implementation/publication.

## New decision template

For a material decision, add an entry with:
- **ID / date:**
- **Status:** Proposed / Accepted / Superseded / Rejected
- **Context:** problem and constraints
- **Decision:** exact chosen approach
- **Alternatives:** realistic options considered
- **Consequences:** trade-offs and migration impact
- **Verification:** how implementation/compliance will be checked

Do not silently overwrite an accepted decision. Mark it superseded and record the replacement rationale.


## ADR-006 — 3D is an explorable galaxy with hierarchical scope navigation
- **Status:** Accepted as product direction; implementation remains part of Milestone 4.
- **Decision:** The secondary 3D view uses a galaxy-inspired visual grammar: rotatable service/resource nodes, semantic constellations, and glowing curved relationship paths. Users can enter a node to view actual modeled children or a clearly differentiated local dependency neighborhood, then return through breadcrumbs/back/overview.
- **Rationale:** The view should support spatial orientation and progressive disclosure, not merely present a decorative 3D graph.
- **Constraints:** The graph remains data-backed; containment is not communication; traffic animation must bind to explicit observed or labeled simulated data; leaf entities must not invent children. Stable canonical IDs and shared state remain renderer-independent. 2D remains primary and must be fully usable without WebGL.
- **Specification:** `docs/3D_GALAXY_EXPERIENCE.md`.

## ADR-007 — Initial toolchain and pinned versions (2026-10-11, Milestone 1)
- **Status:** Accepted
- **Context:** Phase 1 scaffold; the spec asks for mutually compatible pinned versions and React 19 where supported.
- **Decision:** React 19.3, Vite 8.3, React Router 8.4 (library/data-router mode, not framework mode), Zustand 5, `@xyflow/react` 12.12, `elkjs` 0.12, Vitest 5 + Testing Library, ESLint 10 + typescript-eslint 8.71. TypeScript is pinned to 6.0.3 rather than 7.x because typescript-eslint supports `<6.1`. Exact versions only (`save-exact`). Styling uses CSS variables + CSS Modules (no CSS-in-JS or utility framework). Three.js/R3F/Drei/GSAP are deferred to Milestone 4.
- **Alternatives:** TypeScript 7 without type-aware linting; Tailwind; React Router framework mode (adds SSR/build conventions not needed for a mock-first SPA).
- **Consequences:** Revisit the TS pin when typescript-eslint supports 7.x. The shell's 2D/3D switch plus Topology/Grouped-infrastructure mode follows Revision 2 §C (Infrastructure is a grouped 2D layout mode) and the UI mock; the Infrastructure nav route is a separate placeholder for the containment hierarchy.
- **Verification:** `npm run check`.

## ADR-008 — Milestone 1 domain implementation choices and open data-model questions (2026-10-11)
- **Status:** Accepted. All items confirmed by the product owner on 2026-10-11.
- **Context:** `ARCHITECTURE.md` Revision 2 §2 marks its interfaces as illustrative. Implementing them in `apps/web/src/domain/types.ts` required a few explicit extensions.
- **Decision (implemented):**
  - IDs are unique across *all* collections (environments, definitions, instances, resources, relationships), so a bare ID resolves to one entity. Selection is still `{ kind, id }`.
  - `ServiceInstance.environmentId` is a single required string; validation also rejects non-string values from untyped adapters.
  - `InfrastructureResource` gains optional `health`, `owner`, `team`, `metrics`, `updatedAt`, so data stores, topics, queues, and SaaS APIs can appear in the registry with health and labeled telemetry. Absent `health` renders as "Unknown".
  - Resource types add `datacenter` (on-prem containment), `cache`, `search-index`, and `exchange` (RabbitMQ). Containment-only types (`account`, `subscription`, `project`, `region`, `datacenter`, `cluster`, `namespace`) cannot be communication endpoints; validation enforces this.
  - Service categories are executable kinds only (`api`, `gateway`, `application`, `worker`, `scheduled-job`, `other`). Databases and brokers are resources, not service categories.
  - A resource without `environmentId` inherits the nearest ancestor's environment; with none it is environment-independent (e.g. SaaS) and appears in every environment's registry. **Confirmed by product owner 2026-10-11 (former open question 5).**
  - **Environments are isolated (confirmed 2026-10-11, former open question 1):** a communication relationship whose endpoints resolve, directly or through inheritance, to different environments is a validation **error**. Only environment-independent entities (no environment on themselves or any ancestor, e.g. a SaaS API) may be shared across environments.
  - **Environment conflicts (confirmed 2026-10-11):** a resource may restate the environment it inherits but not change it. A resource whose `environmentId` differs from its nearest ancestor's environment is a validation error.
  - **Environment order (confirmed 2026-10-11):** environments are displayed production → staging → development → other, by `EnvironmentRecord.kind` (name breaks ties), regardless of repository order (`sortEnvironments`).
  - **Replicas (confirmed 2026-10-11):** replicas are not modeled. An instance has one aggregate `health`; replica detail may appear only as descriptive metadata (e.g. `metadata.note`).
  - **RabbitMQ bindings (agent decision 2026-10-11, delegated by product owner):** an exchange → queue (or exchange → exchange) binding is a `CommunicationRelationship` with `protocol: 'rabbitmq'`, `pattern: 'asynchronous'`, and the binding key in `metadata.bindingKey`. No separate relationship type. Reasons: a binding is the path messages actually take, so dependency traversal, impact analysis, and traffic animation (Milestones 2–4) can follow producer → exchange → queue → consumer over one relationship type. A second type would force every traversal to merge two edge sets. Validation enforces the routing semantics: an exchange may only target a queue or another exchange. Producers may still publish to a queue directly (default exchange). Revisit if bindings need properties messages don't have (e.g. header-match arguments shown as configuration rather than traffic).
  - **Instance/host environment (confirmed 2026-10-11):** an instance whose hosting resource resolves (directly or by inheritance) to a different environment is a validation error. A host with no environment (e.g. a shared nonprod account) is allowed.
  - Validation errors: empty/duplicate ID, missing environment/definition/resource/parent/endpoint, parent cycle, self-relationship, invalid endpoint kind, invalid binding target, cross-environment relationship, environment conflict, instance/host environment mismatch. No warning-level rules exist today.
  - The inspector labels relationship direction by flow ("Outgoing: calls, publishes to" / "Incoming: called by, delivers to") instead of "upstream/downstream", because producer → topic → consumer makes "depends on" ambiguous.
- **Workloads (confirmed 2026-10-11):** the service instance *is* the workload. `ServiceInstance.resourceId` points to the most specific known host (namespace, cluster, VM host, or datacenter), and no `workload` resource is created per instance. Reasons: a per-instance workload resource would be a 1:1 duplicate (two IDs, two health values, and two nodes for the same thing in grouped views), and most inventories (service catalogs, APM) know the namespace but not the Deployment/StatefulSet. Keep the `workload` resource type for runtime units that are *not* modeled as a service instance (e.g. an unowned VM or sidecar found by infrastructure discovery). Revisit if a real adapter shows one workload hosting several service definitions, or several workloads (e.g. canary + stable) per instance. In that case add `ServiceInstance.workloadResourceIds` rather than changing `resourceId`.
- **Open questions:** none outstanding.
- **Alternatives:** Per-collection ID scopes (rejected: ambiguous lookups); a separate `MessagingResource` entity (rejected: Revision 2 §3 says topics/queues are `InfrastructureResource`s).
- **Verification:** `apps/web/src/domain/validation.test.ts`, `apps/web/src/domain/registry.test.ts`, `apps/web/src/domain/boundaries.test.ts`.

## ADR-009 — Milestone 2 map implementation choices (2026-10-11)
- **Status:** Accepted
- **Context:** Milestone 2 delivers the React Flow + ELK map, infrastructure grouping, URL state, and saved layouts (ADR-002, ADR-005, ARCHITECTURE Revision 2 §1–5).
- **Decision:**
  - **Layout:** `GraphLayoutService` with an ELK `layered` implementation (nested groups via `INCLUDE_CHILDREN`, fixed seed, inputs sorted by ID, `thoroughness: 3`, no `considerModelOrder`). In the browser ELK runs in a Web Worker; a code-split bundled build is the fallback without Worker support.
  - **Graph model:** a renderer-agnostic `TopologyGraph` sits between canonical data and React Flow. Map nodes are the environment's service instances plus communicating resources with at least one relationship. Environment-independent resources (SaaS) appear only when connected to the environment. Brokers without relationships appear only as groups.
  - **Infrastructure mode:** same nodes and edges as topology mode, grouped by a synthetic provider level, then explicit `parentResourceId` containment. Collapsing a group replaces its members with one node: worst health, member count, and merged edges (internal edges dropped).
  - **Highlighting:** Direct (1 hop, both directions), Upstream (transitive outgoing), Downstream (transitive incoming). Others are dimmed through one canvas class, not per-element data.
  - **Scale guard:** above 300 visible nodes the map asks the user to narrow the view (search, filters, neighborhood, or "group by provider (collapsed)"), with "render all anyway". 300 leaves headroom over the 250-node target.
  - **URL state:** `TopologyUrlState` v1 (docs/schemas/topology-url-state.v1.md). Discrete changes push history; search typing replaces it. Unknown IDs are shown as not found; an unknown environment falls back to the first one.
  - **Saved layouts:** `SavedLayout` v1 (docs/schemas/saved-layout.v1.schema.json) through `SavedLayoutRepository` (localStorage, in-memory fallback). Saved positions override automatic layout and are relative to the containing group in infrastructure mode. Viewport is not saved; applying a layout fits to view.
- **Alternatives:** dagre (rejected: ADR-002 picks ELK, and only one engine should ship); main-thread ELK (rejected: blocks interaction and adds 1.5 MB to the main bundle); per-node dim state (rejected: re-rendered every element on each selection).
- **Consequences:** grouped mode at full detail fits at a small zoom (wide nested layout); collapsing or neighborhood mode is the intended way to read it. Manual positions in grouped mode do not resize groups (nodes are kept inside their parent).
- **Verification:** `elkLayoutService.test.ts` (no overlaps, groups contain children, determinism, 250/750 fixture), `topologyGraph.test.ts`, `Topology2D.test.tsx`, `urlState.test.ts`, `useUrlStateSync.test.tsx`, `savedLayout.test.ts`, `schemaSync.test.ts`; docs/BENCHMARKS.md.

## ADR-010 — Simulation, failure propagation, and topology history (2026-10-11, Milestone 3)
- **Status:** Accepted
- **Context:** Milestone 3 requires deterministic simulation separate from renderers, explicit propagation rules, a versioned snapshot contract with an "as of"/compare workflow, and no mock data presented as live.
- **Decision:**
  - **Engine:** `apps/web/src/simulation/engine.ts` is pure (no React, timers, or renderer types; enforced by a boundary test). State = immutable baseline + active failures + seeded metric drift + simulated clock (10 s per tick). Every view renders the engine's derived `data`; recovery recomputes from the baseline, so it is exact.
  - **Runtime:** a Zustand store holds the engine state and run controls; one interval at the app shell (`useSimulationTicker`) steps it. The simulation starts paused, so the app shows recorded mock data until the user acts.
  - **Propagation** (`apps/web/src/domain/propagation.ts`): rules are data and are listed in the UI. Containment makes contained entities unavailable. Synchronous calls, data access, and scheduled jobs make callers degraded, transitively. A failed topic/queue/exchange degrades producers and consumers. A failed consumer only backs up its channel (terminal). Producers never affect consumers. Communication rules never escalate past degraded. Only simulated failures propagate; recorded baseline health does not.
  - **Relationship status:** a connection to a failed or impacted target becomes `degraded`; a connection from an unavailable source becomes `inactive` (no traffic).
  - **Events:** typed and attributed (rule, root, cause, relationship); generated from a diff of derived states, so every visible change has an event. Latency anomalies come from drift crossing 1.35× and clear below 1.2×. The log is capped at 500 events.
  - **History:** `TopologySnapshot` v1 (`docs/schemas/topology-snapshot.v1.schema.json`) behind `SnapshotRepository`. Fixtures are derived from the mock (before incident → replica lag → recorded outage). The simulation can be captured as a snapshot. `asOf` (URL `asof`) switches every view to a snapshot index; the simulation keeps running separately and is never modified. Compare uses `diffTopology`.
  - **Labeling:** no "live" wording anywhere (tested). The header shows "Simulated <clock>", events and telemetry carry Simulated tags, and the history banner names the snapshot source.
  - **Layout stability:** the 2D map relays out only when the graph structure changes; simulation ticks re-render only changed nodes.
- **Alternatives:** simulation inside the repository (rejected: mixes I/O with time-based state); storing snapshots of only health (rejected: Revision 2 wants topology + relationships + health + metrics); propagating baseline unhealthy states (rejected: would invent incidents).
- **Consequences:** history fixtures exist only for the hand-written mock (generated datasets start without history); captured snapshots last for the session (in-memory repository); real retention/event sourcing waits for a backend (PRODUCT_SPEC G.1).
- **Verification:** `propagation.test.ts`, `snapshot.test.ts`, `engine.test.ts`, `snapshots.test.ts`, `useSimulationTicker.test.tsx`, `EventsPage.test.tsx`, `describeEvent.test.ts`, `simulation/boundaries.test.ts`.

## ADR-011 — 3D galaxy implementation (2026-10-11, Milestone 4)
- **Status:** Accepted
- **Context:** Milestone 4 / `docs/3D_GALAXY_EXPERIENCE.md`: an explorable, data-backed 3D galaxy that stays secondary to 2D.
- **Decision:**
  - **Stack (pinned):** three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9 (OrbitControls, Line, Html labels), gsap 3.15.0 (finite camera transitions). Lazy-loaded chunk (~1.06 MB minified); the main bundle does not include Three.js.
  - **Layers:** `scope.ts` (what a scope shows) → `layout3d.ts` (deterministic positions) → `sceneModel.ts` (emphasis, labels, curves, arrows, traffic) → `GalaxyScene.tsx` (Three.js). Everything before the scene is pure and tested without WebGL.
  - **Scopes:** the overview groups the 2D map's visible entities into constellations by outermost container. Above 250 entities, constellations collapse to anchors with member counts. "Explore inside" shows modeled containment children (and one level of grandchildren), a logical service's instances, or, for leaves, the real communication partners with an explicit "no modeled children" note. Outside partners sit on side arcs (inbound left, outbound right).
  - **Containment vs communication:** containment = tilted rings, scope shells, and undirected dashed spokes; communication = dashed-by-kind curved paths with direction cones (two for bidirectional), glowing tubes only for the selection's paths.
  - **Shared state:** the explore path is `galaxyScope` (canonical IDs, URL `scope`); selection, filters, environment, highlight mode, and the neighborhood are shared with 2D. Camera poses live in the renderer (`CameraMemory`, per scope path), never in global state.
  - **Motion:** traffic particles are bound to relationship throughput and labeled simulated; off when paused (global `motionPaused`) or under reduced motion. Camera moves are finite GSAP tweens, killed when the user grabs the controls, and cut instantly under reduced motion. Rendering is on demand when nothing animates.
  - **Readability:** silhouette per type (sphere, hex prism, cylinder, diamond, capsule, wireframe for external); status = label badge + one/two rings (not color alone); label level-of-detail (anchors, selection, highlight, and problems always; others when the camera is near, toggled imperatively per frame).
  - **Fallbacks:** WebGL detection, context-loss handling with retry, and an error boundary. All offer the 2D map and registry.
- **Alternatives:** troika SDF text (rejected: runtime font fetch); per-edge fat lines (rejected: 750 objects); full-screen bloom (rejected by spec; muddies labels).
- **Consequences:** frame rate needs GPU measurement (BENCHMARKS.md); grouped 2D mode and 3D share data but not positions; deeper descendants than grandchildren are reached by entering further.
- **Verification:** `scope.test.ts`, `layout3d.test.ts`, `sceneModel.test.ts`, `runtime.test.ts`, `GalaxyScene.test.tsx` (canonical IDs, click/double-click, arrows, particles vs motion policy, containment toggle, disposal, camera fit/dive/restore), `App.test.tsx` (WebGL fallback and return to 2D), `apps/web/scripts/bench-3d.mjs`.

## ADR-012 — Accessibility hardening, API contract, and positioning (2026-10-11, Milestone 5)
- **Status:** Accepted
- **Context:** Milestone 5 requires WCAG 2.2 AA verification, an OpenAPI 3.1 / JSON Schema contract, and positioning without unsupported claims.
- **Decision:**
  - **Tokens deviate from the UI mock where it failed AA:** the light theme's status fills (`--color-ok/warn/crit`), edge colors (rendered at 62% opacity), and the dark `--color-text-3` were adjusted. A new `--color-control-border` gives form controls a 3:1 boundary. Pressed toggles get an accent underline (state ≥ 3:1). `apps/web/src/styles/contrast.test.ts` computes every required pair from `tokens.css`, so regressions fail the build.
  - **Accessible names contain visible labels** (WCAG 2.5.3): rail links read "Deps (Dependencies)"; the simulation chip's name starts with its visible text.
  - **2D edges are not tab stops:** connections are reached through the inspector's relationship lists ("Connection details"), which avoids 30+ invisible-focus stops.
  - **Target size (2.5.8):** in-canvas controls scale with the user's zoom. The full-size Groups panel (grouped mode) and the 3D entity list are the equivalent controls. The browser audit checks target size everywhere except zoomable canvas content.
  - **Verification layers:** axe-core in jsdom (names, roles, ARIA), a real-browser audit (`npm run audit:a11y`: axe incl. contrast and target size, a Tab pass checking visible focus, reduced motion) in both themes, keyboard-journey tests, and a static guard against React state updates in frame callbacks.
  - **API contract:** OpenAPI 3.1 (`docs/api/openapi.json`) referencing JSON Schema 2020-12 payload schemas (`docs/schemas`); RFC 9457 errors; cursor pagination; `x-repository` mapping to existing frontend interfaces; contract tests with ajv. Auth, tenancy, retention, and ownership remain open (`API_CONTRACT.md`).
  - **Positioning:** documented as an unvalidated hypothesis with a workflow comparison by publicly stated focus, explicit gaps, a validation plan, and kill criteria (`POSITIONING.md`).
- **Alternatives:** keep mock colors and document exceptions (rejected: fails AA for required indicators); make edges focusable with a custom focus style (rejected: tab-order burden); generate types from the schemas (deferred: hand-written types plus enum-equality tests are enough for now).
- **Consequences:** light theme reads slightly darker than the mock; the design source should be updated to match. Competitor cells marked "?" must be verified before external use.
- **Verification:** `apps/web/src/styles/contrast.test.ts`, `apps/web/src/test/a11y.test.tsx`, `apps/web/src/test/keyboard.test.tsx`, `apps/web/src/test/frameLoop.test.ts`, `apps/web/scripts/audit-a11y.mjs`, `apps/web/src/contract/contract.test.ts`.

## ADR-013 — Tailwind CSS replaces CSS Modules (2026-10-11, Milestone 6)
- **Status:** Accepted (product owner direction); supersedes the styling part of ADR-007 ("CSS variables + CSS Modules (no … utility framework)").
- **Context:** Product requirement (PRODUCT_SPEC Revision 5 §J): use Tailwind. ADR-007 had rejected a utility framework.
- **Decision:** Tailwind CSS v4 via `@tailwindcss/vite`. `tokens.css` stays the single source of values; Tailwind's theme maps them with `@theme inline` and the default palette is disabled (`--color-*: initial`), so utilities can only use tokens that pass `contrast.test.ts`. Full migration: CSS Modules are removed; repeated patterns become shared components (`apps/web/src/shared/ui`); glyph artwork and third-party overrides (React Flow, 3D labels) live in layered CSS in `apps/web/src/styles`.
- **Alternatives:** keep CSS Modules (rejected by product owner); adopt Tailwind only for new UI (rejected: two styling systems).
- **Consequences:** class-name-based test hooks are replaced by data attributes (e.g. `data-emphasis`); the design-token contract is unchanged.
- **Verification:** no `*.module.css` remains; contrast, axe (jsdom + browser), keyboard tests pass; screenshot review in both themes.
- **Verified (2026-10-11):** no `*.module.css` files; `npm run check` passes; `npm run audit:a11y` 21/21 page × theme runs with 0 violations, including the four new pages; screenshot review of map, registry, events, and the new pages in both themes (Milestone 6 closeout in `IMPLEMENTATION_PLAN.md`).


## ADR-014 — Event types as logical contracts on messaging channels (2026-10-11, Milestone 7)
- **Status:** Accepted (product owner direction: implement the mock's event catalog; "Events" navigation = catalog, simulation page moves to `/simulation`).
- **Context:** The UI mock has an Events section listing event types (`OrderPlaced` on `orders.events`, with producers, consumers, schema version, owner) and highlighting an event's flow on the map. The canonical model had channels and relationships but no notion of which messages they carry.
- **Decision:** Add `EventType` to `TopologyData` as an optional collection (additive within v1). It is logical like `ServiceDefinition`: `channelResourceIds` (topic/queue/exchange, at most one per environment), `producerServiceIds` and `consumerServiceIds` (service definitions), `schemaVersion`, owner/team, metadata. Per environment, a pure resolver (`resolveEventFlow`) maps it to instances and the existing relationships: producer → channel, channel → consumer, or exchange → bound queue → consumer. Inconsistencies are validation errors. The map highlight is shared state `eventHighlight` (URL `ev`); the catalog's selected event is the route (`/events/:id`).
- **Alternatives:** per-environment event types (rejected: duplicates one contract per environment, unlike definitions); event metadata on relationships (rejected: one relationship carries many event types, and the catalog needs owner/schema per event); producers/consumers as instances (rejected: same duplication).
- **Verified (2026-10-11):** rule tests in `eventFlow.test.ts`; mock validates with zero issues; contract tests pass; catalog/highlight integration tests; `npm run audit:a11y` 25/25 runs with 0 violations (Milestone 7 closeout in `IMPLEMENTATION_PLAN.md`).
- **Consequences:** event types annotate but never create communication; propagation is unchanged. The former "Events & Traffic" route `/events` now opens the catalog; simulation and history live at `/simulation`.

## ADR-015 — Monorepo with a Go + ArcadeDB backend specification (2026-10-11)
- **Status:** Accepted (product owner direction: one monorepo; backend docs in `docs/backend/`). Specification only; no backend code yet. The database choice (ArcadeDB) is superseded by ADR-019 (MongoDB); the rest stands.
- **Context:** The product owner supplied a Go backend specification pack (v4, ArcadeDB). It predated frontend Milestones 1–7 and proposed its own REST shapes and domain fields that conflict with the implemented, tested contract (`docs/api/openapi.json`, `docs/schemas/`) and ADR-008/ADR-014.
- **Decision:** Keep the pack in `docs/backend/`, reviewed so the backend implements the existing contract and canonical domain instead of defining parallel ones. One OpenAPI document serves both sides. ArcadeDB is the only database (`docs/backend/DATABASE_DECISIONS.md` ADR-DB-001), with one `COMMUNICATES` edge per canonical relationship. Go code will live in `backend/`; the frontend stays at the root for now. Seeds and parity tests use shared JSON fixtures exported from the frontend mock. Backend milestones are B1–B6, committed with scopes `b1`…`b6`.
- **Alternatives:** adopt the pack's API as-is (rejected: two contracts, breaking the frontend repositories); move the frontend into `apps/web` now (deferred: not requested, and it touches every path).
- **Consequences:** contract changes update `openapi.json`, the TypeScript types, and the Go DTOs together. Backend-only decisions are `ADR-DB-*`; anything that changes product behavior or the contract needs a root ADR. The review changes are listed in `docs/backend/README.md`.

## ADR-016 — Monorepo layout: `apps/web` and `backend` (2026-10-11)
- **Status:** Accepted (product owner direction); supersedes ADR-015's "frontend stays at the root".
- **Decision:** The frontend moves to `apps/web/` (unchanged code; `git mv`). The Go backend lives in `backend/`. Shared contract and docs stay in `docs/`, shared fixtures in `fixtures/`. A root `package.json` forwards `dev`, `build`, `test`, `check` to `apps/web` and adds `check:backend` / `check:all`. No npm workspaces: `apps/web` keeps its own lockfile and `node_modules`, so the move needed no dependency changes. Vite's `server.fs.allow` admits `../../docs` and `../../fixtures` for the contract tests.
- **Consequences:** paths in docs are `apps/web/src/…`; npm commands run in `apps/web/` (or via the root). Archived Revision 1 docs keep their original paths.

## ADR-017 — Server-side simulation runs are isolated, deterministic, and bounded (2026-10-11, Milestone B5)
- **Status:** Accepted by the agent under the product owner's instruction to complete B1–B6 without stopping ("proceed … until it's fully completed"). It resolves the open decision "Server-side simulation" in `docs/API_CONTRACT.md`. Review it; it is designed to be easy to change.
- **Context:** The simulation engine runs in the browser (ADR-010). The backend plan (B5) asks for bounded simulation runs, event and telemetry persistence, and provenance that is never relabelled, and the backend docs require deciding isolation before implementing.
- **Decision:** `POST /simulations` runs a Go port of `engine.ts` (identical results on shared fixtures) on a **read-only copy** of the canonical topology: one request = seed + up to 100 actions (inject, recover, recoverAll, step, reset), ≤ 500 ticks, ≤ 5 watched entities. The run, its events, and per-tick metric samples of watched entities are stored with `provenance: simulated` (never anything else) and are pruned by retention (`SIMULATION_RETENTION`, default 7 days; `SIMULATION_MAX_RUNS`, default 200). A run may capture its final state as a `simulation` snapshot. Runs never change the canonical topology, other users' state, or the browser simulation.
- **Alternatives:** shared global server simulation (rejected: one user's what-if would change everyone's view); per-user long-lived sessions with incremental actions (deferred: needs identity, which B6 decides); client-only (kept: the UI still simulates locally; the server adds reproducible, shareable runs).
- **Consequences:** a run is reproducible from its stored request (seed + actions). Telemetry exists only for simulation runs; observed telemetry ingestion remains an open decision. Snapshots themselves are not pruned.

## ADR-018 — API authentication: optional hashed bearer tokens, loopback by default (2026-10-11, Milestone B6)
- **Status:** Accepted by the agent under the product owner's instruction to complete B1–B6 without stopping. It narrows, but does not close, the open decision "Authentication and authorization" in `docs/API_CONTRACT.md`: OIDC/SSO, tenancy, and per-user ownership remain open.
- **Decision:**
  - `AUTH_MODE=none` (default) or `token`. Token mode: `Authorization: Bearer` on `/api/`, tokens stored only as SHA-256 digests in `AUTH_TOKENS_FILE` (`make token`), roles `reader` (GET) and `editor` (all). 401 with `WWW-Authenticate`, 403 for read-only tokens on writes. `/healthz` and `/readyz` are open.
  - Secure defaults: the API listens on `127.0.0.1:8080`; it refuses to start unauthenticated on a non-loopback address unless `ALLOW_UNAUTHENTICATED=true` (only behind an authenticating proxy). Metrics listen separately and only on loopback.
  - Browsers never hold tokens (no secrets in the bundle): the UI calls `/api` same-origin through the Vite proxy locally; deployments put an authenticating proxy/SSO in front.
  - Also: per-client token-bucket rate limiting (`RATE_LIMIT_RPS`/`BURST`, 429 + `Retry-After`; proxy headers only with `TRUST_PROXY_HEADERS=true`), exact-origin CORS allowlist without credentials, security headers (`nosniff`, CSP `default-src 'none'`, `no-referrer`, `no-store`).
- **Alternatives:** OIDC now (deferred: needs an identity provider and tenancy decisions); API keys in the browser (rejected: secrets in bundles); no auth with documentation only (rejected: easy to expose by accident).
- **Consequences:** CLI/CI clients use tokens; browser access relies on the network boundary until SSO is chosen. Tests cover all paths (`internal/adapters/httpapi/security_test.go`, `internal/config/config_test.go`).

## ADR-019 — MongoDB replaces ArcadeDB as the backend database (2026-10-11)
- **Status:** Accepted (product owner direction: "update the database to MongoDB", "replace" rather than keeping both). Supersedes the database part of ADR-015 and `docs/backend/DATABASE_DECISIONS.md` ADR-DB-001/002/003; details in ADR-DB-004.
- **Context:** B1–B6 shipped on ArcadeDB. The application reaches storage only through `backend/internal/ports`, the domain logic is in Go, and dependency traversal already ran in memory by default (ADR-DB-003 amendment), so the graph engine was not doing load-bearing work.
- **Decision:** MongoDB 8.0 (official Go driver v2) is the only database. One collection per canonical entity kind, with `_id` = the stable ID and the canonical JSON as the document; history, layouts, and simulation runs are documents with their validated value under `payload`. Imports, simulation runs, and retention are multi-document transactions, so MongoDB runs as a replica set (one node locally). Validators and the unique `_id` index enforce what the database can; `validateTopology` stays the authority. Optional database traversal uses `$graphLookup`. The API contract, frontend, fixtures, and parity tests are unchanged.
- **Alternatives:** keep both behind configuration (rejected by the product owner: double persistence code and tests); MongoDB without transactions (rejected: imports and runs must be all-or-nothing).
- **Consequences:** native graph queries are gone (traversal is in memory, `$graphLookup` as fallback; measured in `docs/BENCHMARKS.md`). Local development needs a replica set (handled by `backend/docker-compose.yml`). MongoDB Community is licensed under SSPL: fine for internal use; offering the product as a hosted service needs a licensing review. Existing ArcadeDB data is not migrated: the seed fixtures recreate the local state, and the old Docker volume is left in place for the owner to delete.

## ADR-020 — Editing the canonical topology through the API: one entity at a time, validated, revision-guarded (2026-10-12, Milestones B7/M8)
- **Status:** Accepted (product owner direction: "buttons in the UI to create or update all resources", with delete; editing only when connected to the backend).
- **Context:** Contract v1 was read-only for inventory (only snapshots, layouts, and simulation runs were writable). The product owner asked to create, update, and delete every entity kind from the UI.
- **Decision:**
  - `POST /entities/{kind}`, `PUT /entities/{kind}/{id}`, `DELETE /entities/{kind}/{id}` for `environment`, `service-definition`, `service-instance`, `resource`, `relationship`, and `event-type`. The body is the canonical entity (`topology.v1.schema.json`).
  - Every write builds the resulting topology and validates it in full with the client's rules (`validateTopology`, ported in Go) plus the schema's enums and required fields (new code `invalid-field`); any issue is 422 with `errors[]`. So a write can never store an invalid topology, and a **delete is refused while anything references the entity**; the issues name each blocker. IDs are new across all collections on create (409) and cannot change on replace.
  - **Optimistic concurrency:** `GET /topology` returns the topology revision as `ETag`; writes accept `If-Match` and answer 412 when another write happened in between. The adapter re-checks the revision inside the write transaction. Each write returns the new `ETag`.
  - **Server-set fields:** `updatedAt` is the write time. Telemetry (`metrics`) cannot be written: new entities have none, replacements keep the stored values (which stay `isSimulated: true` for mock data). Written entities are stored with backend provenance `sourceType: manual`; the topology as a whole keeps its source (`fixture` locally), so the data is still labelled mock inventory.
  - Writes need the editor role when `AUTH_MODE=token` (ADR-018).
  - **Frontend:** editing is offered only when the data comes from the backend (`?source=api`); with built-in mock data the buttons are disabled with a hint. Editing is also disabled while viewing history ("as of"). Saving reloads the topology, which restarts the browser simulation from it.
- **Alternatives:** bulk `PUT /topology` (rejected: coarse, conflicts on every edit); JSON Patch (rejected: harder to validate and to build forms for); in-memory editing in mock mode (rejected by the product owner); cascading deletes (rejected: silent loss of instances and relationships).
- **Consequences:** contract v1 gains three operations, an `ETag` header, and an `If-Match` parameter (additive). Writes are serialized by the revision: concurrent editors get 412 and reload. Every write re-reads the full topology for the next request (revision cache miss, about 80–100 ms at 1,000 entities). Audit trail and per-user ownership remain open (ADR-018).

## ADR-021 — Transit board: a per-service read model beside the canonical topology (2026-10-12, Milestone 9)
- **Status:** Accepted for Phase 1 (product owner direction: add the Payment Service Transit Board screen to the design, then "lets start implementing"; spec `docs/TRANSIT_BOARD.md`). Implemented in Milestone 9 (2026-10-12) with the proposals below as defaults. Implementation details are in the Milestone 9 closeout. Points still marked "open" are the product owner's to change.
- **Amended by ADR-022 (2026-10-12):** the board's top level becomes the business flow. This per-service board stays unchanged as the drill-down of a flow step.
- **Context:** The canonical model describes services and the topology between them. The transit board describes what happens inside one service: entry points, internal modules, clients, policies, and traces. Its data sources (API specs, OpenTelemetry, resilience config, code scan) are not integrated, and the backend has no trace store.
- **Decision (proposed):**
  - **Read model.**
    - The board's data is a separate, per-service read model (`TransitBoard`, `TraceSummary`, `TraceStep`), keyed to the canonical service. It does not extend the canonical domain or the topology contract v1.
    - Layout (track graph, bundling, projection) is computed client-side by pure functions; the backend returns routes, never geometry.
  - **Milestone 9 scope.**
    - Milestone 9 delivers only spec Phase 1: the board in the real frontend stack, on the prototype's example data behind a `TransitRepository` interface, clearly labelled as example data.
    - The backend endpoints (`GET /services/{id}/transit`, `GET /traces/{traceId}/steps`) are added to the contract when phases 2–4 start.
    - Trace replay was added on example traces (product owner, 2026-10-12: "implement everything whats outstanding"), behind the same repository (`getTraces`, `getTrace`). The real `/steps` endpoint still waits for spec Phase 4's backend work.
  - **Theming (decided by the product owner, 2026-10-12: "not only dark only, that switch remains the same for all functionality").** The board follows the app's light/dark switch and tokens (ADR-013), like every other page, instead of the spec's dark-only raw palette. Its control-room look is the dark theme's rendering, with an equivalent light rendering.
  - **Entry point.** `/services/:serviceId/transit` in the selected environment, linked from the inspector of a service instance. (Open: also from the 3D galaxy "enter node", spec open question 5.)
- **Alternatives:**
  - Model stations and policies as canonical resources and relationships. Rejected: it mixes observed per-request internals into the inventory, and it inflates the 1,000-entity scale target.
  - Render the map in 3D with Three.js. Rejected by the spec: plain SVG with a projection keeps labels upright and costs no WebGL.
- **Consequences:**
  - A second, independent data path. Mock-versus-observed labelling must be maintained for it too.
  - The spec's open questions (tracing backend, internal spans, alias-table ownership, sampling, galaxy link) block phases 2–5, not Phase 1.

## ADR-022 — Business flows: the transit board's top level, as canonical entities (2026-10-12, Milestones 10/B8)
- **Status:** Accepted. Product owner direction: "this transit board should be considered like a business flow, showing different steps in business process execution, preserving its current model, like policies, retries". Answers to the proposal:
  1. a flow level on top, with today's board as the drill-down;
  2. flows both authored and imported;
  3. business-transaction replay in the first release.

  Spec: `docs/BUSINESS_FLOWS.md`. Amends ADR-021 and supersedes "out of scope: cross-service business flows" in `docs/TRANSIT_BOARD.md`.
- **Context:** The per-service board shows how one service executes. Users need the business process across services: its steps, decisions, outcomes, and the protections on every hand-off. The example topology already contains a complete checkout (order → inventory → payment → ledger → shipping → notification) as relationships and event types.
- **Decision:**
  - **Two levels.**
    - The flow board (`/flows/:flowId`): lines are business flows, stations are business steps owned by services (service zones as bands), branches are decision outcomes with shares, termini are outcomes, and dashed undo tracks are compensation.
    - Opening a step shows the existing per-service board, unchanged.
    - The layout pipeline is reused; only column placement changes (step rank instead of station kind).
  - **Canonical, environment-independent entity `business-flow`.** It holds steps, transitions, outcomes, a target, and its source. It is validated by `validateTopology` (TypeScript and Go), resolved per environment like event types (ADR-014).
    - Every transition must be backed by a modeled relationship (`call`) or an event type's producer → consumer flow (`event`). Flows never invent communication.
    - Topology contract v1 gains an optional `businessFlows` array (additive), and `business-flow` becomes a writable kind of the entity API (ADR-020).
  - **Policies are kept and extended** on transitions: today's call policies, plus asynchronous ones (redelivery, dead-letter, idempotent consumer, outbox) and process ones (step deadline, compensation, manual intervention), with the same `exercised` / `idle` / `missing` / `unknown` states. Flow-level findings: retry amplification, missing compensation, event transitions without a dead-letter queue, step deadlines above the target.
  - **Sources.**
    - Authored in the app (the editing UI, backend only).
    - Imported from workflow definitions: native JSON or YAML first, then BPMN 2.0, then orchestrator adapters. Imported flows are read-only in the app (re-import overwrites them), with "duplicate as authored". The mapping from tasks to services is explicit, never guessed.
  - **Observed data and replay.** Traces are joined into business transactions by business key, plus span links and the step mapping. Transactions replay across steps on compressed business time, with retries, redeliveries, dead-letter parking, and compensation. Uncorrelated gaps are shown, never bridged. Until real sources exist, observed flow data is labelled example data.
- **Alternatives:**
  - Replace the per-service board with flows. Rejected: it loses the inside of each service.
  - Put business-step labels on the per-service board. Rejected: it cannot show a process that crosses services.
  - Keep flows as a non-canonical read model like the transit board. Rejected: flows are authored, edited, validated against the topology, and imported, which is canonical-data behaviour (like event types).
  - Infer flows from traces alone. Rejected: traces carry no business-step semantics, and inferred flows would be invented.
- **Consequences:**
  - A new entity kind across the schema, the TypeScript and Go validators, the fixtures, MongoDB (a `businessFlows` collection), the entity API, the editing UI, and parity tests.
  - An importer in the backend: both `POST /imports/business-flows` and `make import-flows`, with a new dependency on `go.yaml.in/yaml/v3`.
- **Implemented (2026-10-12):** Milestones 10 and B8. Details decided while building it (local and orchestrated calls, the reply rule, `startStepId`, the import endpoint and its codes) are in the implementation notes of `docs/BUSINESS_FLOWS.md`.
  - The business-key attribute and flow ownership remain open questions (`BUSINESS_FLOWS.md` section 8).

## ADR-023 — Flow board as swimlanes on React Flow; flows visible on the service board (2026-10-12, Milestone 11)
- **Status:** Accepted (product owner, 2026-10-12: "1 — yes"). Spec: `docs/BUSINESS_FLOWS.md` Revision 2, sections 9–10. Amends ADR-022 (the flow board's rendering only; the model is unchanged).
- **Context:** The flow board reused the transit board's tilted multi-line map. That map earns its place when many lines share stations, inside one service. A flow is one process with branches. The review found:
  - wasted width;
  - captions colliding with labels;
  - long cross-lane runs to far-away termini;
  - faded stations from other flows with no explanation.

  Navigation was also one-way: a step opened its service board, but the board did not know which flows used it.
- **Decision:**
  - **Swimlane view.** Flows are drawn one at a time as swimlanes:
    - lanes are services, columns are step rank, and outcomes get the last lane;
    - edges are orthogonal, routed in a pure layout (`transit/flows/swimlane.ts`);
    - rendered with React Flow 12 (already used, ADR-009): pan, zoom, fit, and focusable steps;
    - nodes are not draggable;
    - selection and replay never move anything.
  - **Two-way navigation.** The service board lists the flows that use the service, highlights the lines a selected flow enters (URL `flow`), and the line card links each using flow step back to the flow board. One matching rule (`lineForStep`) serves this and retry amplification.
- **Alternatives:**
  - Keep the tilted map and fix the label collisions. Rejected: it does not fix the wasted width or the cross-lane runs, and the metaphor still doesn't fit a single process.
  - React Flow with ELK layout. Rejected: ELK's layered algorithm assigns columns but cannot pin nodes to lanes.
  - Hand-written SVG swimlanes. Rejected: they would duplicate the pan, zoom, fit, and focus handling that React Flow already provides.
  - Drawing flow topology on the service board. Rejected: it mixes the process level with the component level.
- **Consequences:**
  - The flow board's SVG map, the multi-flow index highlighting, and the train overlay are replaced.
  - The service board gains a flow selection that is local to the page.
  - Tests that read SVG paths move to node and edge data attributes.

## ADR-024 — One pattern catalog for both boards, extended with inbox and polling patterns (2026-10-12, Milestone 11)
- **Status:** Accepted (product owner, 2026-10-12: "not all patterns": messaging reliability, without retry topics and parking lots, ordering, or consumer lag; "maybe polling"). Spec: `docs/BUSINESS_FLOWS.md` Revision 2, section 11.
- **Context:** Two vocabularies had grown apart:
  - the service board's `PolicyType` (seven values) plus free-text pattern tags;
  - the flows' `FlowPolicyType` (twelve values).

  Labels and descriptions were repeated in several components.
- **Decision:**
  - **One catalog.** A pure catalog (`domain/patterns.ts`) is the only source of pattern IDs, labels, categories, where each applies, descriptions, and related findings. The two policy types become subsets of it, and free-text tags become catalog IDs.
  - **Three additions.** `inbox`, `polling-publisher`, and `async-request-reply` are added as additive values of the flow-policy enumeration. That touches the JSON Schema, the TypeScript and Go enumerations, and the fixtures.
  - **Three findings.** They check the additions: an outbox without a relay, at-least-once delivery without deduplication, and polling without a deadline.
- **Alternatives:**
  - A broad catalog (sagas, resilience extras, event sourcing, …). Not selected by the product owner. It can be added later through the same catalog.
  - Free-text patterns everywhere. Rejected: they cannot drive findings or pick-lists.
- **Consequences:** contract v1 changes additively (three enumeration values). Imports and the entity API accept them, and both validators check them against the schema.

## ADR-025 — Flows in impact analysis and simulation (2026-10-12, Milestone 12 with B9; proposed)
- **Status:** Proposed. Approved for specification only (product owner: "3 — yes"; "spec all, build M11 only"). Spec: `docs/BUSINESS_FLOWS.md` Revision 2, section 12.
- **Decision (proposed):**
  - A pure `flowImpact` maps the existing explained propagation result onto flows: affected steps, the first affected step on the typical path, and the likely outcome (compensated, failed or cancelled, or delayed).
  - It is shown, labelled *simulated*, in four places: the inspector, the simulation page, a flow board banner, and the catalog.
  - The backend impact response gains an optional `flows` array, ported to Go with shared conformance fixtures.
- **Alternatives:** compute flow impact only in the browser. Rejected: API clients of `/topology/impact` would miss it, and parity is the rule (ADR-016).

## ADR-026 — 3D drill-down from a flow into its services (2026-10-12, Milestone 13; proposed)
- **Status:** Proposed. Approved for specification only (product owner: "4 — yes"). Spec: `docs/BUSINESS_FLOWS.md` Revision 2, section 13. Follows `docs/3D_GALAXY_EXPERIENCE.md` and ADR-011.
- **Decision (proposed):**
  - An optional, lazy-loaded 3D view: the swimlane plane above the service boards' planes, light shafts from steps to their lines, replay particles, and camera fly-down with Escape to climb back.
  - Built with React Three Fiber and drei (`CameraControls`, `Text`, `Line`, `Instances`, `Bvh`), plus two new pinned dependencies: `@react-three/postprocessing` (selective Bloom) and `maath` (easing).
  - The 2D views and lists stay primary and accessible.
- **Alternatives:** a 3D flow board in place of the swimlane. Rejected: 3D adds nothing for one process. Its value is showing the drill-down between levels.
