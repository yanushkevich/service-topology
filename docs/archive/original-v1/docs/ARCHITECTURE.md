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
Features: Registry, Dependencies, Events & Traffic, Infrastructure
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
