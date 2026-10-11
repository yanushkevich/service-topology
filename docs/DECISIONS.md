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
- **Context:** `ARCHITECTURE.md` Revision 2 §2 marks its interfaces as illustrative. Implementing them in `src/domain/types.ts` required a few explicit extensions.
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
- **Verification:** `src/domain/validation.test.ts`, `src/domain/registry.test.ts`, `src/domain/boundaries.test.ts`.

