# Architecture — Service Topology and Registry Platform

**Status:** Initial architecture contract. Change deliberately and document material decisions.

## 1. Goals
- One canonical domain model, multiple renderers.
- Domain logic independent of React Flow and Three.js.
- Rendering components focused on presentation and interaction.
- Shared application state without high-frequency render state in Zustand.
- Replaceable mock repositories and future integration adapters.
- Stable cross-view selection and filters.

## 2. High-level architecture
```text
Application Shell
├── Header / Navigation / Router
└── Service Map Workspace
    ├── Toolbar / Filters / Legend
    ├── View Host
    │   ├── 2D Topology (React Flow)
    │   ├── 3D Network (React Three Fiber)
    │   └── Infrastructure View
    └── Service / Connection Inspector
Features: Registry, Dependencies, Events (catalog), Simulation, Infrastructure
Application services: repositories, selectors, dependency traversal, simulation
Shared application state: Zustand
Domain: services, connections, environments, providers, health, protocols, telemetry
```

## 3. Suggested source layout
```text
src/
  app/                 # App, router, providers
  layouts/             # Shell, header, navigation
  domain/               # Canonical types, validation, selectors
  data/
    repositories/       # Repository interface and mock implementation
    mock/               # Services and connections
  state/                # Shared Zustand stores
  features/
    service-map/
      workspace/
      views/            # Topology2D, Network3D, InfrastructureView
      adapters/         # Domain -> React Flow / 3D view models
    service-registry/
    inspector/
    dependencies/
    events/
    infrastructure/
  shared/               # UI primitives, theme, utilities
  three/                # Scene components, materials, shaders, animation
  styles/
docs/
  PRODUCT_SPEC.md
  ARCHITECTURE.md
  IMPLEMENTATION_PLAN.md
  PHASE_PROMPT_TEMPLATE.md
  phases/
```
Adjust this tree when justified; avoid empty abstractions created only to match a diagram.

## 4. Conceptual domain model
Treat this as a starting contract and adapt it deliberately.

```ts
type ServiceId = string;
type ConnectionId = string;
type Environment = "development" | "staging" | "production";
type HealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
type Provider = "aws" | "azure" | "gcp" | "on-prem" | "saas" | "internal" | "unknown";
type ServiceCategory =
  | "api" | "application" | "database" | "message-broker" | "worker"
  | "container" | "cloud-resource" | "external" | "infrastructure" | "other";
type Protocol =
  | "http" | "https" | "graphql" | "grpc" | "websocket" | "kafka"
  | "rabbitmq" | "tcp" | "tls" | "postgresql" | "mysql" | "mongodb"
  | "redis" | "scheduled-job" | "other";

interface Metrics {
  latencyMs?: number;
  throughputPerSecond?: number;
  errorRatePercent?: number;
  isSimulated: boolean;
  observedAt?: string;
}

interface Service {
  id: ServiceId;
  name: string;
  description?: string;
  category: ServiceCategory;
  provider: Provider;
  environment: Environment;
  health: HealthStatus;
  owner?: string;
  team?: string;
  version?: string;
  endpoint?: string;
  resourceId?: string;
  region?: string;
  cluster?: string;
  namespace?: string;
  groupId?: string;
  protocols: Protocol[];
  metrics?: Metrics;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

type CommunicationPattern =
  | "synchronous" | "asynchronous" | "streaming" | "scheduled" | "database" | "unknown";
type ConnectionStatus = "active" | "degraded" | "inactive" | "unknown";

interface Connection {
  id: ConnectionId;
  sourceId: ServiceId;
  targetId: ServiceId;
  protocol: Protocol;
  pattern: CommunicationPattern;
  direction: "unidirectional" | "bidirectional";
  status: ConnectionStatus;
  authenticationType?: string;
  topicOrQueue?: string;
  endpoint?: string;
  metrics?: Metrics;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}
```
Validate unique IDs and connection references. Avoid scattering string literals; use shared types and mappings.

## 5. Data flow and adapters
```text
Repository / Mock Data
        ↓
Canonical Domain Entities
        ↓
Selectors + Shared State
   ├── React Flow adapter → 2D nodes/edges
   ├── 3D layout adapter   → scene entities/connections
   ├── Infrastructure selectors → grouped view
   └── Registry selectors → table rows
```
React Flow nodes/edges are view models, not canonical records. Three.js objects are renderer details. Do not make domain types extend React Flow types or store Three.js objects in Zustand. External schemas should be mapped into canonical entities at integration boundaries.

## 6. State ownership
### Shared Zustand state
Selected entity (canonical type + ID), active view, environment, shared filters, visible layers/labels, theme/preferences, and simulation controls where cross-feature coordination is needed.

### Local component/renderer state
React Flow viewport and drag state, Three.js objects/refs, per-frame signal positions, GSAP timelines, and local hover/presentation state. Use selectors for derived data; do not duplicate derived values without a reason or update global state every frame.

## 7. Cross-view contract
- Selection is represented by canonical entity type and ID.
- Registry, 2D, and 3D selections update the same shared selection.
- Each view resolves that ID to its own visual representation.
- Inspector reads canonical data.
- Switching views preserves selection, environment, and shared filters.
- If a filter hides the selected entity, handle this consistently and visibly; do not silently desynchronize views.

## 8. Shared visual mappings
Centralize protocol, category, provider, health, and connection-status labels/icons/colors, plus accessible descriptions. Provide fallbacks for unknown values. Do not use color as the only indicator; verify both themes.

## 9. Repository and future integrations
Start with a repository interface and mock implementation. Features depend on the interface, not raw mock arrays. Future adapters may cover cloud inventory, Kubernetes, broker metadata, APM/telemetry, internal service catalogs, and on-prem inventory. Do not build real integrations until requested.

## 10. Simulation
Keep simulation separate from rendering. A simulation service emits typed events or updates mock repository state; selectors derive presentation; all views render canonical state. Label simulated data. Make failure/recovery behavior deterministic in tests. Do not place simulation timers inside graph nodes or frame loops.

## 11. Animation
- GSAP: finite sequences, scene reveal, camera focus, transitions.
- `useFrame` or shaders: continuous signal motion/pulses.
- CSS transitions: ordinary interface transitions.
- Do not animate one property with competing systems.
- Keep handles in refs/local renderer code, clean up resources, respect reduced motion, and never call React state setters at frame frequency.

## 12. Performance and accessibility
Lazy-load 3D; cap DPR; reuse and dispose geometries/materials correctly; stabilize React Flow node/edge identities; avoid unnecessary store subscriptions; support keyboard/focus/contrast; provide WebGL fallback and loading/empty/error states.

## 13. Testing
Test domain validation, repository integrity, selectors/filters, dependency traversal, style mappings, store actions, cross-view selection, registry focus, simulation transitions, state preservation, important integration workflows, production build, and manual 3D smoke tests.

## 14. Architecture decision log
For material decisions record:
- Decision
- Context/reason
- Alternatives considered
- Consequences and affected phases/tests/docs
- Date and phase

Do not silently change shared contracts.


---

# Revision 2 Addendum — Explicit Modeling and Integration Contracts

**This addendum is authoritative where the original architecture is ambiguous.** The original architecture and examples are retained above.

## 1. Dependency and layout engine

React Flow is a required 2D visualization dependency. Use **ELK.js (`elkjs`) as the default graph layout engine** for deterministic hierarchical layout and edge routing. Keep layout computation behind a `GraphLayoutService` interface so the engine can be benchmarked or replaced without changing domain types.

The layout adapter accepts serializable nodes, edges, groups, constraints, and pinned positions, and returns positions/routes. It must not mutate canonical domain entities. Add fixture-based tests for non-overlap, valid edge endpoints, deterministic output, and nested grouping.

## 2. Canonical entity model: definitions, instances, resources

The original conceptual `Service` type is retained for context, but the implementation should distinguish these entities:

```ts
type EntityId = string;
type EnvironmentId = string;
type ResourceId = string;

interface ServiceDefinition {
  id: EntityId;
  name: string;
  description?: string;
  owner?: string;
  team?: string;
  category: string;
  protocols: string[];
  metadata?: Record<string, unknown>;
}

interface ServiceInstance {
  id: EntityId;
  serviceDefinitionId: EntityId;
  environmentId: EnvironmentId; // exactly one environment per instance
  provider: "aws" | "azure" | "gcp" | "on-prem" | "saas" | "internal" | "unknown";
  health: "healthy" | "degraded" | "unavailable" | "unknown";
  version?: string;
  endpoint?: string;
  resourceId?: ResourceId;
  metrics?: Metrics;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface EnvironmentRecord {
  id: EnvironmentId;
  name: string;
  kind: "development" | "staging" | "production" | "other";
}

interface InfrastructureResource {
  id: ResourceId;
  name: string;
  type:
    | "account" | "subscription" | "project" | "region" | "cluster"
    | "namespace" | "workload" | "database" | "broker" | "topic"
    | "queue" | "external-resource" | "other";
  provider: "aws" | "azure" | "gcp" | "on-prem" | "saas" | "internal" | "unknown";
  parentResourceId?: ResourceId;
  environmentId?: EnvironmentId;
  metadata?: Record<string, unknown>;
}

interface CommunicationRelationship {
  id: EntityId;
  sourceEntityId: EntityId;
  targetEntityId: EntityId;
  protocol: string;
  pattern: "synchronous" | "asynchronous" | "streaming" | "scheduled" | "database" | "unknown";
  direction: "unidirectional" | "bidirectional";
  status: "active" | "degraded" | "inactive" | "unknown";
  metrics?: Metrics;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}
```

These interfaces are illustrative contracts; consolidate shared enums/types in actual code rather than copying duplicate string unions. Communication endpoints may reference service instances and first-class resource entities. Validate endpoint existence and allowed relationship semantics.

## 3. Messaging topology and containment

- Kafka topics and RabbitMQ queues/exchanges are first-class `InfrastructureResource`/topology entities when represented in the graph.
- Model producer → topic and topic → consumer as explicit communication relationships.
- Do not rely on a topic string on an edge as the only topology representation.
- Keep infrastructure containment separate from communication relationships.
- Use `parentResourceId` for explicit hierarchy and validate missing parents and cycles.
- A service definition may have multiple service instances across environments; each instance belongs to exactly one environment.

## 4. Layout and graph performance

- Layout runs in an adapter/service boundary; use a worker if profiling shows layout blocks the main thread.
- Benchmark 250 visible nodes / 750 visible edges and a 1,000-entity inventory accessed through filters/grouping.
- Do not promise all 1,000 entities simultaneously rendered at full detail.
- Keep graph view models minimal and memoized; apply viewport culling, grouping, and edge filtering when needed.
- Store manual positions as serializable records keyed by stable entity ID.
- Test initial layout for node-box overlap using known fixtures and a defined tolerance.

## 5. URL state, snapshots, and saved layouts

Create serializable, versioned contracts for:
- `TopologyUrlState`: active view, environment, selected entity type/ID, supported filters.
- `TopologySnapshot`: schema version, timestamp, entity/relationship state, and snapshot metadata.
- `SavedLayout`: schema version, layout ID/name, relevant filters/grouping, node positions keyed by canonical IDs, and view preferences.

Implement URL encoding/decoding with tests for malformed or unknown IDs and browser back/forward behavior. Keep snapshots deterministic for tests. Start saved layouts with local persistence behind a `SavedLayoutRepository` interface; avoid coupling to browser storage in domain code.

## 6. Backend/API contract

Before adding real backend connectivity, create `docs/API_CONTRACT.md` with:
- OpenAPI 3.1 as the contract for future HTTP APIs.
- JSON Schema for persisted snapshots, saved layouts, and domain payloads where useful.
- Versioning/error conventions and ID/enum semantics.
- A mapping between API schemas and frontend domain types.
- Examples for service search, topology retrieval, snapshots, and saved layouts.

The initial mock implementation must satisfy the same repository interfaces expected of a future API adapter. Do not implement an unrequested backend or introduce GraphQL merely because it was considered earlier; choose one API contract strategy deliberately.

## 7. Architecture decisions

Record these decisions in the architecture decision log:
- React Flow + ELK.js for the initial 2D graph.
- Service definition versus per-environment service instance.
- First-class topic/queue resources.
- Explicit infrastructure containment hierarchy.
- Infrastructure view as a grouped 2D topology mode.
- 2D as primary; 3D as secondary.
- Scale and benchmark targets.
- URL state, snapshots, and saved-layout schemas.
- OpenAPI 3.1 + JSON Schema as the future contract strategy.


## Revision 4 — 3D galaxy scene architecture

`docs/3D_GALAXY_EXPERIENCE.md` is the authoritative specification for the 3D galaxy view. The scene must be built from renderer-specific view models derived from canonical domain data; Three.js objects, mesh UUIDs, camera objects, and transient animation state must never become domain identity or canonical shared state.

### Scene data pipeline

1. Select the current topology scope from shared application state (environment, filters, selected entity, current scope/breadcrumbs).
2. Resolve canonical entities and relationships for that scope, keeping containment relationships separate from communication/dependency relationships.
3. Convert them through a deterministic 3D layout/view-model adapter into stable node positions, cluster regions, and edge paths.
4. Render reusable node, edge, containment, label, and camera/navigation components.
5. Send user actions (select, focus, enter scope, go back, filter) through shared domain/UI actions; do not mutate canonical entities from the render loop.

### Hierarchical scope navigation

Represent 3D navigation as explicit application state, such as a stack of scope IDs and return contexts. A scope contains the parent entity ID, the displayed child entities, the local dependency neighborhood if enabled, and the prior camera/layout context. Entering a node resolves actual modeled children/related entities; it must not assume every entity has children. On return, restore the previous scope and camera context where possible. The scope stack must be serializable enough for tests and URL/deep-link integration; never serialize Three.js instances.

### Camera and animation ownership

The camera rig owns orbit, pan, zoom, fit, focus, dive-in, and restoration transitions. Use imperative refs/frame-loop updates for animation; avoid React state updates on every frame. Transitions must be interruptible, deterministic in intent, and reduced-motion aware. Global pause stops decorative/traffic animation but must not disable camera controls or essential interaction.

### Graph rendering and quality

Use semantic clusters and deterministic layout; reduce detail as node/edge density grows. Labels, selection, status, and direction cannot depend solely on color or bloom. Edge animation must bind to a known traffic/status field and visibly distinguish mock data. Lazy-load the scene, cap DPR, clean up resources, and provide a WebGL/context-loss fallback to the registry or 2D map. Performance claims require a documented benchmark.

---

## Milestone 1 implementation notes (2026-10-11)

What exists in code, so readers do not have to infer it. Contract extensions and open questions are in `DECISIONS.md` ADR-008.

| Concern | Location |
|---|---|
| Canonical types and enums | `apps/web/src/domain/types.ts` |
| Lookup index, ancestors, environment inheritance | `apps/web/src/domain/topologyIndex.ts` |
| Integrity validation | `apps/web/src/domain/validation.ts` |
| Registry rows, shared filters, sorting (renderer-agnostic) | `apps/web/src/domain/registry.ts` |
| Repository interface / mock implementation / fixture | `apps/web/src/data/repositories/`, `apps/web/src/data/mock/topology.ts` |
| Loading, validation on load, React context | `apps/web/src/data/TopologyDataProvider.tsx`, `apps/web/src/data/topologyContext.ts` |
| Cross-view state (selection, filters, environment, view, theme) | `apps/web/src/state/uiStore.ts` |
| Presentation mappings with fallbacks | `apps/web/src/shared/mappings.ts` |
| Registry and shared inspector | `apps/web/src/features/service-registry/`, `apps/web/src/features/inspector/` |

- Topology data is held in React context (loaded once per repository), not in Zustand. Zustand holds only the canonical selection and filters.
- `apps/web/src/domain` imports only its own modules; `boundaries.test.ts` enforces this.
- If a filter or the environment hides the selected entity, the registry shows a notice with a "Show it" action and the inspector offers to switch environment. Selection is never cleared silently.
- Not yet implemented (as of Milestone 1): URL state, snapshots, saved layouts, simulation, and the 2D/3D renderers.

## Milestone 2 implementation notes (2026-10-11)

Decisions: `DECISIONS.md` ADR-009. Measurements: `docs/BENCHMARKS.md`.

| Concern | Location |
|---|---|
| Dependency traversal (direct/upstream/downstream, neighborhood) | `apps/web/src/domain/traversal.ts` |
| Renderer-agnostic graph model (scoping, filters, grouping, collapse) | `apps/web/src/features/service-map/graph/topologyGraph.ts` |
| Layout boundary, ELK implementation, worker loading | `apps/web/src/features/service-map/layout/` |
| React Flow adapter (view models, highlight, object reuse) | `apps/web/src/features/service-map/adapters/reactFlowAdapter.ts` |
| Map view, custom nodes/edges, layouts menu | `apps/web/src/features/service-map/views/` |
| Shared filter UI (registry + map) | `apps/web/src/features/filters/FilterBar.tsx` |
| URL state codec and history sync | `apps/web/src/state/urlState.ts`, `apps/web/src/state/useUrlStateSync.ts` |
| Saved layout schema and repositories | `apps/web/src/data/savedLayouts/` |
| Scale fixtures and runtime dataset switch (`?dataset=`) | `apps/web/src/data/mock/generateTopology.ts`, `apps/web/src/data/selectRepository.ts` |

Data flow for the map: `TopologyIndex` + shared state → `buildTopologyGraph` → `toLayoutRequest` → `GraphLayoutService` (worker) → `toFlowNodes`/`toFlowEdges` → React Flow. Graph IDs are canonical entity/relationship IDs (group IDs for groups); selection flows back through `refForNode`/`refForEdge` into the shared store. Drag positions and collapsed groups are local to the map, except when saved as a layout.

## Milestone 3 implementation notes (2026-10-11)

Decisions: `DECISIONS.md` ADR-010.

| Concern | Location |
|---|---|
| Propagation rules and impact analysis | `apps/web/src/domain/propagation.ts` |
| Snapshot contract, validator, diff | `apps/web/src/domain/snapshot.ts` |
| Simulation engine (pure) | `apps/web/src/simulation/engine.ts` |
| Simulation runtime state and timer | `apps/web/src/state/simulationStore.ts`, `apps/web/src/state/useSimulationTicker.ts` |
| Snapshot repository and fixtures | `apps/web/src/data/snapshots/`, `apps/web/src/data/mock/snapshots.ts` |
| One index for all views (current simulated state or snapshot) | `apps/web/src/data/TopologyDataProvider.tsx` |
| Simulation page (controls, log, history, rules); formerly "Events & Traffic" at `/events` | `apps/web/src/features/simulation/` |
| History banner, header simulation status | `apps/web/src/layouts/HistoryBanner.tsx`, `apps/web/src/layouts/Header.tsx` |

Data flow: repository → baseline → `useSimulationStore.initialize` → engine `data` → `TopologyDataProvider` index → registry/map/inspector. With `asOf` set, the provider builds the index from the snapshot instead; the engine is untouched.

## Milestone 4 implementation notes (2026-10-11)

Decisions: `DECISIONS.md` ADR-011. Measurements: `docs/BENCHMARKS.md`.

| Concern | Location |
|---|---|
| Scope resolution (overview, container, leaf, logical service) | `apps/web/src/features/service-map/galaxy/scope.ts` |
| Deterministic 3D layout | `apps/web/src/features/service-map/galaxy/layout3d.ts` |
| Scene view models, label LOD, motion policy | `apps/web/src/features/service-map/galaxy/sceneModel.ts` |
| Camera math and per-scope camera memory | `apps/web/src/features/service-map/galaxy/cameraMath.ts` |
| WebGL detection, context loss | `apps/web/src/features/service-map/galaxy/webgl.ts` |
| Three.js scene and camera rig | `apps/web/src/features/service-map/galaxy/GalaxyScene.tsx` |
| Lazy boundary, fallbacks, overlay, entity list | `apps/web/src/features/service-map/galaxy/Network3DView.tsx` |

Pipeline (Revision 4): shared state (environment, filters, neighborhood, `galaxyScope`, selection) → `resolveGalaxyScope` → `layoutGalaxy` → `buildScene` → React Three Fiber. Actions (select, enter, back) go through the shared store; the render loop only moves particles, toggles label visibility, and runs camera tweens.

## Milestone 6 implementation notes (2026-10-11)

Decisions: `DECISIONS.md` ADR-013. Requirements: `PRODUCT_SPEC.md` Revision 5 (§J–L).

| Concern | Location |
|---|---|
| Tailwind entry, theme mapping (`@theme inline`, default palette disabled), base styles | `apps/web/src/styles/global.css` |
| Design tokens (single source of values, both themes) | `apps/web/src/styles/tokens.css` |
| Layered component CSS: glyphs, status shapes, tags, React Flow and 3D label overrides | `apps/web/src/styles/components.css` |
| Shared class helpers and primitives (Button, Chip, Segmented, Panel, Kicker) | `apps/web/src/shared/ui/classes.ts`, `apps/web/src/shared/ui/primitives.tsx` |
| Section page layout (content + shared inspector), Card, Note | `apps/web/src/features/pages/PageShell.tsx` |
| Overview summary selector | `apps/web/src/domain/summary.ts` → `apps/web/src/features/overview/OverviewPage.tsx` |
| Dependency trees (direct/transitive with paths) | `apps/web/src/domain/traversal.ts` (`dependencyTree`) → `apps/web/src/features/dependencies/DependenciesPage.tsx` |
| Containment forest with roll-ups and inherited environments | `apps/web/src/domain/containment.ts` → `apps/web/src/features/infrastructure/InfrastructurePage.tsx` |
| Local preferences (repository, store), motion helper | `apps/web/src/state/preferencesStore.ts`, `apps/web/src/state/motion.ts` → `apps/web/src/features/settings/SettingsPage.tsx` |

State: preferences are local and per browser (localStorage behind `PreferencesRepository`); they set defaults only (initial theme, view, simulation speed, 3D labels/traffic) and never enter URLs, snapshots, or canonical data. `AppShell` applies the effective theme (following the OS for "system") and `data-motion="reduce"` on `<html>`; renderers read `isMotionReduced()` / `useMotionReduced()`. The new pages read the same `TopologyIndex` as the other views (a snapshot when `asOf` is set) and act only through the shared store; the Dependencies impact preview calls `analyzeImpact` read-only.

## Milestone 7 implementation notes (2026-10-11)

Decisions: `DECISIONS.md` ADR-014. Requirements: `PRODUCT_SPEC.md` Revision 6 (§M).

| Concern | Location |
|---|---|
| `EventType`, `EVENT_CHANNEL_TYPES` | `apps/web/src/domain/types.ts` |
| Index maps `eventTypes`, `eventTypesByChannel` | `apps/web/src/domain/topologyIndex.ts` |
| Flow resolver (per environment; exchange → bound queue → consumer), highlight reach | `apps/web/src/domain/eventFlow.ts` |
| Event-type validation rules | `apps/web/src/domain/validation.ts` |
| Mock event types | `apps/web/src/data/mock/topology.ts` |
| Events catalog page (`/events`, `/events/:eventTypeId`) | `apps/web/src/features/event-catalog/EventsPage.tsx` |
| Shared highlight hook and map chip | `apps/web/src/features/event-catalog/useEventHighlight.ts`, `EventHighlightChip.tsx` |
| 2D / 3D emphasis from an event reach | `computeHighlight` (`reactFlowAdapter.ts`), `buildScene` (`sceneModel.ts`) |
| Inspector "Events carried" | `apps/web/src/features/inspector/InspectorPanel.tsx` |
| Simulation page (moved from `/events`) | `apps/web/src/features/simulation/` |

Pipeline: `uiStore.eventHighlight` (URL `ev`) → `useEventHighlight(index)` → `resolveEventFlow` → `eventFlowReach` (a `Reach`, the same shape as selection reach) → 2D `computeHighlight` / 3D `buildScene`, used only when nothing is selected. Event types never add graph nodes or edges and do not change propagation; they select existing relationships. The catalog reads the same `TopologyIndex` as every view, so history mode works unchanged.


## Revision 8 — Transit board architecture (2026-10-12, Milestone 9)
Status: Phase 1 implemented (ADR-021). Specification: `docs/TRANSIT_BOARD.md`.

**Code map:**
- `apps/web/src/transit/`:
  - `types.ts`: the read model;
  - `board.ts`: index, search, budget, formatting;
  - `layout.ts`: rows, track graph, bundling, projection, `computeMapGeometry`;
  - `trace.ts`: replay helpers (current step, steps in flight, divergence, samples, speed);
  - `repository.ts`: `TransitRepository` (`getBoard`, `getTraces`, `getTrace`), the example implementation, and the context;
  - `mock/`: the Payment Service example board and traces, and a scale generator.
- `apps/web/src/features/transit-board/`:
  - `TransitBoardPage.tsx`: the route, states, responsive grid, and URL state;
  - `LineIndex.tsx`, `TransitMap.tsx`, `StopStrip.tsx`, `LineCard.tsx`: the four panels;
  - `visuals.tsx` and `colors.ts`: badges, diamonds, tags, and token colours;
  - `TraceReplay.tsx`: the train, the timeline strip, and the replay card;
  - `playback.ts`: the board-local playback clock store;
  - `useTransitBoard.ts`: loading the board (keeping the last good board on error), trace lists, and traces.
- **Route:** `/services/:serviceId/transit`, linked from the inspector ("Open transit board").
- **Tokens:** `--transit-*` in `tokens.css`.
- **Separate read model.**
  - Stations, lines, branches, policy stops, findings, and trace steps describe the internals of one service. They are not canonical topology entities, so they get their own types and module (proposed: `apps/web/src/transit/`), not additions to `apps/web/src/domain`.
  - The only link to the canonical model is the service: a service definition, resolved to the service instance in the selected environment.
- **Data access.**
  - A `TransitRepository` interface (`getBoard(serviceId, window)`, `getTraceSteps(traceId, serviceId)`), with a mock implementation built from the prototype's example data (Phase 1).
  - An HTTP implementation comes only once the backend endpoints are decided (spec phases 2–4). They are not part of `docs/api/openapi.json` yet.
- **Pure layout pipeline.**
  - The track graph (trunks, exit/approach nodes, the bus), bundling offsets, and the perspective projection are pure functions of the board data and the container size.
  - They are computed once per data load and memoised, and tested in jsdom without React.
  - Selection and playback change only styles and the overlay marker; they never rebuild paths.
- **Rendering.**
  - Two SVG layers: the static map, and an overlay for the train and highlights. No WebGL and no new dependencies.
  - Below 760px the projection is turned off (top-down 2D).
- **State.**
  - Board view state (`line`, `mode`, `q`, `trace`, `t`) is local to the feature and mirrored to the URL (additive to URL state v1; `t` only while paused).
  - The playback clock runs in the component (`requestAnimationFrame`), never in Zustand (ARCHITECTURE "State ownership").
  - The global shared selection stays the canonical service instance.
- **Styling.**
  - Tokens only (ADR-013). The board's palette becomes new tokens with light-theme values that pass `contrast.test.ts`.
  - Line colours are a token-backed categorical palette.

## Revision 9 — Business flows (2026-10-12, Milestones 10 and B8)
Status: implemented (ADR-022). Specification: `docs/BUSINESS_FLOWS.md`, including its implementation notes.

**Code map:**
- **Domain:**
  - `apps/web/src/domain/businessFlow.ts`: the resolver and transition backing;
  - `validation.ts`: the flow rules;
  - `topologyIndex.ts`: `businessFlows`, `flowsByService`, `flowsByEventType`.
- **Flows read side and layout:** `apps/web/src/transit/flows/`:
  - `flowLayout.ts`: indexing, ranks, the placement strategy, the track graph, `computeFlowGeometry` (Milestone 11: renamed `flowIndex.ts`, keeping codes, ranks, and shared steps; the geometry was replaced by `swimlane.ts`, see Revision 10);
  - `flowModel.ts`: stages, typical path, budget, findings, search;
  - `observed.ts`: stats, transactions, samples, divergence;
  - `exampleFlows.ts` and `generateFlows.ts`.
- **UI:** `apps/web/src/features/business-flows/`:
  - catalog and board pages;
  - `FlowMap` (Milestone 11: replaced by `FlowSwimlane`), `FlowPanels` (list, strip, card), `FlowReplay`;
  - `FlowEditorDialog` and `flowForm.ts`; `FlowEditActions`.
- **Backend:**
  - `backend/internal/domain/businessflow.go` and `validation.go`;
  - `internal/adapters/flowformats/` (native, BPMN);
  - `internal/application/importflows.go`;
  - `cmd/importflows`;
  - the `businessFlows` collection.
- **Canonical domain.** `BusinessFlow` joins `apps/web/src/domain/types.ts`:
  - validation rules in `validation.ts`, ported to Go;
  - a pure per-environment resolver (`domain/businessFlow.ts`, like `eventFlow.ts`) that maps each transition to the backing relationships or event flows, or reports what is missing;
  - an index (`flowsByService`, `flowsByEventType`).
- **Observed side.** Separate from the domain, like the transit read model: `apps/web/src/transit/flows/` holds the flow stats and business transactions (steps with attempts, waits, redeliveries, compensation, and the trace ids per step). Example data is derived from the existing example traces' business keys.
- **Layout.** `computeMapGeometry` gains a placement strategy:
  - the per-service board keeps columns by station kind;
  - the flow board uses step rank for columns and service bands for rows.

  Track graph, bundling, projection, labels, and rendering are shared.
- **UI.** `features/business-flows/`: catalog, `FlowBoardPage`, flow card, transaction replay (reusing `playback.ts` and the train), and the flow editor (`features/editing` pattern). Drill-down links to `/services/:id/transit?line=…&mode=trace&trace=…`.
- **Backend (B8).**
  - A `businessFlows` collection, a writable entity kind, and validation parity.
  - An importer with format adapters (native, BPMN 2.0) behind a port.
  - Later, observed flow endpoints once traces are integrated.

## Revision 10 — Flow swimlanes, two-way navigation, and the pattern catalog (2026-10-12, Milestone 11)
Decisions: ADR-023 and ADR-024. Spec: `docs/BUSINESS_FLOWS.md` Revision 2.

- **Swimlane layout** (`apps/web/src/transit/flows/swimlane.ts`):
  - It is pure and computed once per flow: lanes, columns, node boxes, routed edge paths, and label and policy positions.
  - React Flow renders it on the flow board (`apps/web/src/features/business-flows`) with fixed positions.
  - Selection, search, and replay pass state through node and edge data only.
- **Matching steps to lines:** `lineForStep` (`transit/flows/flowModel.ts`) is the single rule used by retry amplification and by the service board's flow highlighting.
- **Pattern catalog** (`apps/web/src/domain/patterns.ts`): a pure catalog of pattern IDs, labels, categories, where each applies, and descriptions. `FlowPolicyType` and the transit `PolicyType` are subsets of it. Three additive enumeration values in contract v1 are mirrored in Go (`backend/internal/domain/fields.go`).
- **Specified for later:**
  - flow impact: a pure `flowImpact` plus an optional `flows` in the impact response (ADR-025, Milestone 12 and B9);
  - the 3D drill-down (ADR-026, Milestone 13).

**Code map (implemented 2026-10-12):**
- **Pure:**
  - `apps/web/src/domain/patterns.ts`: the pattern catalog;
  - `apps/web/src/transit/flows/swimlane.ts`: the layout, with per-channel widths, tracks, gutters, label and policy positions, and `edgeLabelText`;
  - `flowIndex.ts`: codes, ranks, shared steps;
  - `flowModel.ts`: adds `lineForStep`, `flowsOnService`, and the messaging findings;
  - `transit/board.ts`: `lineNamed`, the single step ↔ line rule.
- **Flow board** (`apps/web/src/features/business-flows/`):
  - `swimlaneAdapter.ts` builds the React Flow view model once per flow; `applyView` maps view state onto data only.
  - `FlowSwimlane.tsx` is the canvas: readable initial zoom, frozen lane captions, follow-the-step, controls, and minimap.
  - `SwimlaneParts.tsx` holds the lane, step, and outcome nodes, the routed edge, and the legend.
  - `FlowPanels.tsx` `FlowPicker` is the index bar.
- **Board kit** (`features/boards/`):
  - `BoardGrid` `wideMap` (picker bar, map beside the card);
  - `StripScroller`, the focusable scroll region of every strip.
- **Service board:**
  - `features/transit-board/FlowsOnService.tsx` (`FlowRows`, `UsedByFlows`);
  - the `flow` page parameter (`state/useUrlStateSync.ts`).

## Revision 11 — Data stores on both boards (2026-10-12, Milestone 11.1)
Decision: ADR-027. Spec: `docs/BUSINESS_FLOWS.md` Revision 3.

- **Transit read model:** `Station.entityId` and `TransitBoard.tables` (`apps/web/src/transit/types.ts`).
  - `transit/links.ts`: `linkDependencies`, `applyLinks`, `linksKey`.
  - `transit/board.ts`: `tablesOfLine`, `withTableFindings`, `tablesByStation` in the index.
- **Domain:** `apps/web/src/domain/dataStores.ts` (`dataStoresOf`, `flowDataStores`).
- **Service board** (`features/transit-board/`):
  - `useLinkedBoard` (in `TransitBoardPage.tsx`) applies the table rules and the links before indexing;
  - `DependencyList` is the card's "Depends on"; `linkText.ts` holds the link wording;
  - `LineData` is the card's "Data";
  - `FlowsOnService.tsx` holds `UsedByChips` and `FlowsWithoutBoard`.
- **Flow board:** `StoreRef` and `policyStores` in `swimlaneAdapter.ts`, store chips in `SwimlaneParts.tsx`, and `DataStores` in `FlowPanels.tsx`.
- **Shared:** `shared/hooks/useKeyed.ts`.

## Revision 12 — Process view (2026-10-12, Milestone 11.2)
Decision: ADR-028. Spec: `docs/BUSINESS_FLOWS.md` Revision 4.

- **Model:** `apps/web/src/transit/process.ts` (pure): `Process`, `lineProcess`, `flowProcess`, `fragmentsOf`.
- **Declared transit fields:** `Branch.condition`, `Branch.parallel`, `Line.repeat`, `Line.transactions`.
- **UI** (`features/boards/`):
  - `ProcessDiagram.tsx`: an ordered list on a CSS subgrid, with lifelines and fragments;
  - `StripSwitch.tsx`;
  - the `strip` page parameter on `/services/` and `/flows/`.
- **Endpoint chip:** in `features/transit-board/TransitMap.tsx`.

## Revision 13 — Endpoint contracts (2026-10-12, Milestone 11.3)
Decision: ADR-029. Spec: `docs/BUSINESS_FLOWS.md` Revision 5.

- **Pure contracts layer** (`apps/web/src/contracts/`, in the layer guard):
  - `openapi.ts`: `parseHttpEndpoint`, `findContract`, `exampleOf`, `schemaTypeName`;
  - `examples.ts` and `examples/*.openapi.json`.
- **Source:** `TransitRepository.getOpenApi(serviceDefinitionId)`.
- **UI** (`features/contracts/`):
  - `useEndpointContract`;
  - `ContractView`;
  - `EndpointContractPanel`, passed to `ProcessDiagram` as `endpointPanel`.
- **Flow step detail:** `StepContract` in `features/business-flows/FlowPanels.tsx`.
- **Process model:** messages and notes carry `endpoint` (`EndpointRef`).

## Revision 14 — Authored boards and the local sandbox (2026-10-13, Milestone 11.4 and B10)
Decision: ADR-031. Spec: `docs/TRANSIT_BOARD.md` Revision 2.

- **Definitions** (`apps/web/src/transit/definition.ts`, pure): `BoardDefinition`, `definitionOf`, `boardFromDefinition` (merges observed data by ID), `validateBoardDefinition` (codes and paths shared with `backend/internal/domain/board.go`).
- **Board stores** (`transit/boardStore.ts`): the `BoardStore` interface, kind `backend` or `sandbox`, with revisions.
  - `data/boards/httpBoardStore.ts`: `/api/v1/transit-boards`, ETag / If-Match.
  - `data/sandbox/`: `createSandbox(base, storage)` gives a topology repository with a writer and `SandboxControls`, and a board store, over `localStorage` (`storage.ts`, with a memory fallback and a fingerprint reset).
- **Composed transit repository** (`data/transitRepository.ts`): `createTransitRepository(store, observed)`; stored definitions win over the example board. Selected in `data/selectRepository.ts` (`Repositories.transit`) and provided by `TransitRepositoryContext` in `App.tsx`.
- **Shared change logic:** `domain/topologyChanges.ts` (`applyChange`, `idTaken`) is used by the sandbox writer and the entity forms.
- **Editor UI** (`features/transit-board/editor/`): `BoardEditorDialog` (sections plus a preview `TransitMap`), `BoardSections`, `boardForm.ts` (pure helpers), `BoardEditActions`, `useStoredBoard` and `boardSourceLabel`. The Settings page has the sandbox row.
- **Backend:** `transitBoards` collection (schema version 2), `ports.BoardRepository` (MongoDB and memory), `application/boards.go`, `httpapi/routes_boards.go`.

## Revision 15 — Data bundle export and import (2026-10-13, Milestone 11.5 and B11)
Decision: ADR-032. Spec: `docs/DATA_BUNDLE.md`.

- **Bundle** (`apps/web/src/data/bundle/`, pure except the YAML library): `DataBundle`, `bundleOf`, `topologyOf`, `countsOf`, `validateBundle` (codes and paths shared with `backend/internal/domain/bundle.go`), `serializeBundle` / `readBundle`, `collectBundle`.
- **Importing:** `TopologyRepository.importer` (`BundleImporter`). The sandbox replaces its state; the HTTP repository calls `POST /imports/bundle` with the topology revision. `TopologyEditing.importer` exposes it to the UI.
- **Board listing:** `BoardStore.list()`, and `TransitRepository.boardDefinitions()` (stored definitions plus example boards).
- **UI:** `features/settings/DataBundleRows.tsx` (`ExportDataRow`, `ImportDataRow`); `features/settings/SettingsRow.tsx`; `shared/download.ts`.
- **Backend:** `ports.BundleImporter` (`ReplaceAll`: canonical collections and `transitBoards` in one transaction); `application.ImportBundle`; route `POST /api/v1/imports/bundle`.

## Revision 16 — UI polish and quick search (2026-10-13, Milestone 11.6)
Decision: ADR-033. Spec: `docs/milestones/MILESTONE_11_6_UI_POLISH.md`.

- **Quick search** (`features/search/`): `quickSearch.ts` is pure (items from the topology index, the environment's flows and event types, board definitions, and the navigation pages; ranking; target URLs). `QuickSearchDialog.tsx` reads the data and stores and navigates. The header opens it (button or ⌘K / Ctrl+K). It writes the shared filter only through its explicit option.
- **Inspector:** `InspectorPanel hideWhenEmpty` on section pages.
- **Map:** `openingFit` (React Flow adapter) chooses what a new layout fits: the selection and its highlighted neighbours, else the whole graph.
- **3D labels:** `LabelLayer` holds the label elements and hides overlapping ones from the frame loop, re-measuring only when the camera, size, nodes, hover, or labels change; no React or store state per frame.
- **Transit map:** `placeLabels` keeps labels inside the map; the flat projection compresses the policy lanes.
- **Shell:** `useTruncationTitles` gives truncated text a tooltip app-wide.

## Revision 17 — Flows in impact analysis (2026-10-13, Milestone 12 and B9)
Decision: ADR-025. Spec: `docs/BUSINESS_FLOWS.md` §12.

- **Domain:** `flowImpacts(index, roots, impacts)` in `domain/flowImpact.ts` (pure; Go port `internal/domain/flowimpact.go`; fixtures `conformance/impact/flows.json`). `typicalPath` moved to `domain/businessFlow.ts` so both stacks share it.
- **API:** `GET /topology/impact` returns `flows` (FlowImpact, AffectedFlowStep, LikelyFlowOutcome in OpenAPI).
- **UI:** `state/useFlowImpacts.ts` derives flow impact from the simulation store, memoized on failures and impacts (never per frame). Surfaces: the inspector's simulated section, the simulation page, the flow board banner and swimlane marks (`SwimlaneView.simulated`), and the catalog.

## Revision 18 — 3D drill-down from a flow (2026-10-13, Milestone 13)
Decision: ADR-026. Spec: `docs/BUSINESS_FLOWS.md` §13 and its implementation notes.

- **Layers:** `features/business-flows/drilldown/`: the pure scene model (swimlane layout + transit plane coordinates → world positions, shafts, scope bounds) → the R3F scene → the lazy boundary. Three.js, R3F, and drei are one lazy chunk shared with the galaxy; the main bundle has none.
- **State:** `scene` and `drill` are page URL parameters of `/flows/` (`PAGE_PARAMS`); the selected step is `step`, shared with the swimlane. Camera poses live in CameraControls; replay particles read the board's local playback store. Nothing is written to Zustand per frame (frame-loop guard).
- **Shared 3D modules:** `galaxy/webgl.ts`, `galaxy/palette.ts` (fallback colours), and `galaxy/labelLayer.ts` (now generic anchors).
- **Dependencies (pinned):** `@react-three/postprocessing` 3.1.3 and `postprocessing` 6.39.5 (selective Bloom), `maath` 0.10.8 (frame-local easing).

## Revision 19 — Which line each step uses (2026-10-13, Milestone 13.2)
- **Read model:** `transit/flows/flowLines.ts` (pure): flow + service boards + typical path → one row per step with its line (stops, dependencies, policies, stats) or the reason it has none. `lineStops` (a line's ordered stations and policy stops) moves to `transit/board.ts`, shared by the service board and the flow board.
- **UI:** the flow board's strip gains `lines` (`FlowLinesView`, reusing the service board's `StopStrip` for the selected step's line); the step card's `StepInside`. The service boards are read once per flow board (`useFlowBoards`) for the findings and these rows.
- **3D role:** the drill-down (Revision 18) is an optional explain view; the 2D views carry the same facts.

## Revision 20 — The 3D drill-down removed (2026-10-13, Milestone 13.3)
The product owner does not need 3D in business flows. Revision 18 (and Revision 19's "3D role") no longer apply:
- `features/business-flows/drilldown/`, the flow board's Swimlane | 3D switch, and the `scene` / `drill` page parameters are gone.
- The pinned `@react-three/postprocessing`, `postprocessing`, and `maath` dependencies are removed. Three.js is again only in the galaxy's lazy chunk.
- The galaxy keeps the generic `LabelLayer` (anchors) introduced for the drill-down.
