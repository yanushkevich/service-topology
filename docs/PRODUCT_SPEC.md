# Product Specification — Service Topology and Registry Platform

**Status:** Living specification  
**Initial delivery:** Mock data and simulated telemetry; integration-ready architecture.

## 1. Vision
Build a polished interactive enterprise platform that helps engineers discover services, understand how they communicate, inspect their health, and explore dependencies. This is a cohesive application—not a static mockup or landing page.

The first release uses realistic mock data and clearly labeled simulated events. Later integrations may include AWS, Azure, GCP, Kubernetes, Kafka, databases, APIs, and on-premises systems.

## 2. Goals
- Discover and search a normalized service inventory.
- Explore service-to-service and infrastructure relationships.
- Use 2D topology, 3D network, registry, and infrastructure views of the same ecosystem.
- Inspect services and connections in context.
- Filter by environment, provider, health, protocol, and communication pattern.
- Explore upstream/downstream dependencies.
- Simulate traffic, degradation, failure, and recovery.
- Support future integrations without redesigning the core UI or domain model.

## 3. Initial non-goals
- Live cloud discovery, production telemetry, or real incident response.
- Authentication-provider integration.
- Implementing all provider integrations before the core product works.
- A geographic globe as the default topology. Use geographic coordinates only for an explicitly geographic view when valid location data exists.
- Presenting simulated information as real production data.

## 4. Users and workflows
Primary users are platform/SRE engineers, developers investigating dependencies, and architecture/operations teams.

Core workflows:
1. Open Service Map and understand the selected environment.
2. Search for a service and focus it in the active view.
3. Select a service or connection and inspect its details.
4. Filter topology and registry using shared filters.
5. Explore upstream/downstream dependencies.
6. Switch between 2D, 3D, and Infrastructure views while preserving applicable context.
7. Simulate health changes/failures and observe affected services.
8. Find a service in the registry and navigate to it in the map.

## 5. Application layout
### Header
Product identity, environment selector (Development/Staging/Production), global search, overall health, notifications, theme control, and user-menu placeholder.

### Left navigation
Overview, Service Map, Service Registry, Dependencies, Events & Traffic, Infrastructure, Settings. Service Map is the primary experience. Routes must not lead to broken pages; unfinished areas should be clearly labeled placeholders.

### Service Map workspace
Canvas toolbar, 2D/3D/Infrastructure switcher, shared filters, legend, layer controls, overlays, optional minimap, loading/empty/error states, and WebGL fallback.

### Right inspector
Show an empty state when nothing is selected. For services, show name, description, category, provider, environment, owner/team, version, health, endpoint/resource ID, dependencies, protocols, recent events, and clearly labeled simulated metrics. For connections, show source/target, protocol, pattern, direction, status, security metadata where available, simulated metrics, last activity, and topic/queue/endpoint context.

## 6. Visualization requirements
### 2D topology
Use React Flow with custom nodes and edges. Support pan/zoom, drag, select, fit-to-view, search/focus, filters, connection selection, dependency highlighting, neighborhood exploration, optional labels, grouping/collapse where practical, and a minimap. Keep graph data derived from canonical domain entities and avoid unnecessary re-renders.

### 3D galaxy network
The secondary 3D experience is a rotatable, explorable galaxy of service and infrastructure nodes. Nodes are distinct luminous worlds; relationships are glowing curved paths; related systems form semantic constellations. Users can orbit, pan, zoom, focus a node, and explicitly **Explore inside** it to transition into its modeled child scope or local topology. Breadcrumbs and back/overview controls restore the previous scope and camera context. This is a graph-inspired galaxy, not a geographic globe.

The authoritative interaction, visual, data-mapping, performance, and acceptance contract is `docs/3D_GALAXY_EXPERIENCE.md`. Implement it with Three.js via React Three Fiber and Drei, using stable canonical IDs and renderer adapters. Keep containment distinct from communication, show labels/status accessibly, and only animate traffic when backed by explicit observed or clearly labeled simulated data. Never fabricate an interior for a leaf entity. Lazy-load 3D; preserve shared selection/filter/environment state; support reduced motion, pause, cleanup, and graceful WebGL fallback. 2D remains the primary operational view and must not depend on WebGL.

### Infrastructure view
Group services by provider, environment, cluster, namespace, deployment boundary, or available infrastructure metadata. It can begin as a functional grouping view and evolve without changing the domain model.

### Shared visual language
Use centralized configurable mappings for category, provider, health, protocol, direction, selection, and hover. Provide a legend and accessible text/icon indicators; do not communicate status by color alone. Example protocol colors are conventions, not standards.

## 7. Service and connection types
Support REST, GraphQL, gRPC, WebSocket, Kafka, RabbitMQ, PostgreSQL, MySQL, MongoDB, Redis, AWS/Azure/GCP resources, Kubernetes, on-prem, SaaS, business apps, scheduled jobs, and event-driven workers.

A service should have a stable ID, name, description, category/type, provider, environment, health, owner/team, version, metadata, and optional endpoint/resource IDs. A connection should have stable ID, source/target IDs, protocol, communication pattern, direction, status, and optional metrics/security/topic metadata. Define the actual TypeScript schema in the architecture/domain implementation; do not duplicate ad hoc types across components.

## 8. Mock data and simulation
Include at least 15 connected services across AWS, Azure, GCP, and on-premises, multiple environments, health states, and protocols. IDs must be stable and references valid. Keep repositories and simulation separate from renderers. Label all generated metrics/events as simulated. Support traffic/latency changes and health transitions, including failure and recovery.

## 9. Visual design
Premium, restrained enterprise tooling. Dark theme: deep charcoal/midnight surfaces, subtle grid/atmosphere, muted borders, readable labels, cyan/teal highlights, restrained glow. Light theme: warm white/light gray surfaces, neutral borders, dark typography, accessible status colors. Avoid excessive neon, gradients, glassmorphism, and clutter. Clarity takes priority over decoration.

## 10. Technology expectations
React + strict TypeScript, supported Vite, Three.js, React Three Fiber, Drei, React Flow, Zustand, React Router, GSAP, and CSS variables. Add GLSL tooling only when justified; Leva/Stats.js are development-only. Use mutually compatible pinned versions. For a new project, React 19 + R3F 9 is preferred only if selected dependencies support the combination.

## 11. Quality attributes
Strict TypeScript, accessibility, keyboard interactions, visible focus, reduced-motion support, error boundaries, loading/empty/error states, lazy-loaded 3D, sensible DPR limits, resource cleanup, stable React Flow identities, and no React state updates at animation-frame frequency. Support larger graphs with filters and neighborhood exploration.

## 12. Initial acceptance criteria
- Application starts and builds.
- Navigation, themes, and view switching work.
- At least 15 connected mock services span AWS/Azure/GCP/on-prem.
- 2D topology uses canonical data and supports graph interactions.
- Registry search/filter and registry-to-map navigation work.
- Inspector shows selected service/connection details.
- Interactive 3D uses the same domain and shared selection/filter contracts.
- Infrastructure view groups using available metadata.
- Applicable state persists across views.
- Simulation updates the UI consistently and is clearly labeled.
- Core domain, selectors, dependency traversal, and state synchronization are tested.
- Checks pass or existing failures are documented.
- Setup, architecture, and extension instructions exist.

## 13. Definition of done
A phase is complete only when its acceptance criteria pass, integration points work, existing features remain intact, checks are reported honestly, and documentation is updated. Do not automatically start the next phase.


---

# Revision 2 Addendum — Clarifications and Decisions

**This addendum is authoritative where the original text above is ambiguous or conflicts with it.** The original text is retained for traceability; no original requirements have been deleted.

## A. Stack completeness and layout engine

The required frontend stack explicitly includes **React Flow** for 2D topology. Use a graph layout engine rather than relying on manually positioned nodes alone.

- **Default layout engine:** ELK.js (`elkjs`) for hierarchical layouts, nested groups, and routing where its complexity is justified.
- A lighter layout such as dagre may be used for a deliberately simpler graph mode, but the implementation must choose one default and document the reason. Do not install both without a concrete need.
- Layout output must be deterministic for the same input and configuration.
- The initial graph must have no overlapping service-node bounding boxes after auto-layout. Edge crossings should be minimized where practical and edge routing must remain readable.
- Preserve user-pinned/manual positions when a layout mode supports them; document whether saved positions override automatic layout.

The dependency list in the project foundation phase must include React Flow and the chosen layout engine at compatible, pinned versions. The 3D stack remains Three.js + React Three Fiber + Drei.

## B. Delivery strategy and scope control

Do not attempt to build every feature in one pass. The delivery order is defined by five product milestones:

1. **Milestone 1 — Domain, mock data, and registry.**
2. **Milestone 2 — 2D map and inspector.**
3. **Milestone 3 — Simulation and failure propagation.**
4. **Milestone 4 — 3D network view.**
5. **Milestone 5 — Product polish and hardening.**

The application shell and design tokens are enabling work inside Milestone 1, not a reason to build every navigation page in depth. Each milestone has its own acceptance criteria in `docs/milestones/`. The original phase prompts remain available as smaller implementation iterations and are retained unchanged for traceability. The milestone prompts are the recommended delivery-level workflow.

## C. Infrastructure view definition

For the initial release, **Infrastructure is a grouping/layout mode over the same canonical topology**, not a separate graph product or separate source of truth.

It reuses the 2D node/edge components, selection, filters, and inspector. It applies grouping and layout by provider, environment, cluster, namespace, or deployment boundary. Do not build a separate infrastructure graph renderer until user research or product requirements demonstrate a need.

Infrastructure grouping must be derived from explicit hierarchy and metadata; do not infer parent/child relationships from display names.

## D. 3D is secondary to 2D

The 2D map is the primary operational view and must reach its acceptance criteria before full 3D implementation begins. The 3D view is a secondary exploratory and presentation mode. It must not replace functionality that is clearer in 2D.

3D success is measured by selection/filter parity, understandable grouping, readable labels at useful zoom levels, and stable performance—not visual spectacle alone. If a 3D interaction is ambiguous or less usable than 2D, provide a clear way back to 2D.

## E. Scale targets

Initial product targets (benchmark on a documented reference development machine/browser; record the actual test environment):

- **Default supported interactive topology:** 250 visible service/resource nodes and 750 visible edges.
- **Larger inventories:** up to 1,000 total entities should remain navigable through filtering, grouping, search, and neighborhood exploration; do not promise all 1,000 nodes rendered simultaneously at full detail.
- **Performance goal:** common interactions such as selection and filter changes should remain responsive, with a target of under 100 ms for UI/state response excluding layout computation and browser/device variability. Record measured results rather than claiming a guarantee.
- **Layout goal:** deterministic initial auto-layout with no overlapping node boxes for the sample data and the 250-node benchmark fixture. Layout runtime must be measured and documented.
- **3D goal:** the initial 3D view is optimized for the default supported visible graph, not for rendering every entity in a 1,000-node inventory simultaneously.

If performance misses the target, first use progressive rendering, viewport culling, grouping, edge reduction, memoization, and filtering. Reassess library choices only with benchmark evidence.

## F. Explicit domain modeling decisions

### Logical service vs deployed instance
- `ServiceDefinition` represents a logical capability that can be deployed more than once.
- `ServiceInstance` represents one deployment of that capability in exactly one environment.
- Each instance belongs to one environment; the same logical definition can have instances in Development, Staging, and Production.
- The initial registry may display instances as rows, with an optional grouping by logical service. Do not put a multi-valued environment array on an individual instance.

### Kafka topics and queues
- Kafka topics and RabbitMQ queues/exchanges are first-class resource entities when they participate in the topology.
- Model producer-to-topic and topic-to-consumer relationships as explicit connections, so fan-in/fan-out and dependency paths are visible.
- Connection metadata may still contain topic/queue names for convenience, but that field is not the canonical representation when a first-class topic/queue entity exists.
- Keep resource type distinct from executable service type while allowing both to appear in topology.

### Infrastructure hierarchy
Represent infrastructure containment explicitly with stable resource IDs and parent references. The initial hierarchy supports provider/account or subscription/project, region where applicable, cluster, namespace, workload/service instance, and backing resources. Not every provider uses every level.

- `InfrastructureResource` has a stable ID, type, display name, provider, and optional `parentResourceId`.
- A Kubernetes namespace belongs to a cluster; workloads belong to a namespace; deployed service instances reference their workload or resource where known.
- Validate that parent references exist and that containment has no cycles.
- Do not encode hierarchy solely in string paths or labels.

### Relationships
Keep containment separate from runtime communication:
- **Containment** answers “where does this run?”
- **Communication** answers “what talks to what?”
Do not render containment as traffic edges unless a view explicitly distinguishes the relationship type.

## G. History, deep links, saved layouts, and API contract

These are product requirements, implemented incrementally:

1. **Topology history:** define a snapshot contract that can record a timestamped version of topology entities, relationships, health, and relevant metrics. The mock release should support deterministic snapshot fixtures and a simple “as of”/compare workflow if feasible. Real retention and event sourcing are out of scope until a backend is chosen.
2. **URL deep links:** encode shareable view state in query parameters or a documented URL-state codec: active view, environment, selected entity ID/type, and supported filters. Avoid putting sensitive data in URLs. Browser back/forward should restore supported state.
3. **Saved layouts:** persist node positions, grouping/collapse state, and relevant view preferences using a versioned `SavedLayout` schema. Begin with local persistence behind an interface; keep the contract replaceable by a backend. Never persist Three.js objects or React Flow runtime objects—store canonical IDs and serializable positions/options.
4. **API contract:** document the frontend/backend boundary before real integrations. Use **OpenAPI 3.1** for future HTTP endpoints and JSON Schema for serializable domain payloads/snapshots/saved layouts. GraphQL may be added later if the backend explicitly chooses it; do not maintain conflicting hand-written schemas. Keep generated/validated types tied to the contract where practical.

These capabilities should be added after the core domain/registry and 2D map work is stable; they must not delay the first usable 2D milestone.

## H. Testable design quality

Replace subjective terms such as “premium” or “polished” with observable criteria wherever practical:

- Normal text meets WCAG 2.2 AA contrast of at least 4.5:1; large text at least 3:1.
- Important non-text UI indicators and component boundaries meet at least 3:1 contrast against adjacent colors where WCAG requires it.
- All interactive controls have accessible names, visible keyboard focus, and keyboard operation where applicable.
- Initial auto-layout has no overlapping node bounding boxes in required fixtures.
- Status is not conveyed by color alone.
- Loading, empty, no-results, error, and WebGL-unavailable states are testable.
- Theme changes do not remove focus indicators or reduce required contrast.
- Animation honors reduced-motion preference and can be paused where continuous motion is present.

## I. Product differentiation

The product should not claim to replace established products such as Backstage, Datadog Service Map, Dynatrace, or Kiali without evidence. The initial differentiator to validate is:

**A mock-first, integration-ready, cross-environment topology workbench that combines a normalized service registry, explainable dependency/failure simulation, synchronized 2D and optional 3D exploration, and shareable topology context across cloud and on-premises systems.**

This is a positioning hypothesis, not a proven market advantage. Before treating it as a commercial differentiator, compare target users and workflows against existing tools, interview users, and document which unmet need is distinct. Avoid duplicating a full service catalog, APM suite, or Kubernetes-specific dashboard in the initial scope.


## E. 3D galaxy interaction contract

The galaxy view is more than a rotatable overview: it supports hierarchical exploration into modeled service/resource contents, a clear breadcrumb path, and return to overview. See `docs/3D_GALAXY_EXPERIENCE.md` for the complete specification and test checklist. These requirements refine the 3D view without changing the milestone order or making 3D a prerequisite for 2D.

---

# Revision 5 Addendum — Tailwind CSS and complete section pages (2026-10-11)

**Source:** product owner direction after Milestone 5 review. Authoritative where it conflicts with earlier text (it supersedes the "CSS variables" styling expectation in §10 and ADR-007's rejection of a utility framework). Delivery: Milestone 6 (`docs/milestones/MILESTONE_06_TAILWIND_SECTIONS.md`).

## J. Styling: Tailwind CSS
- The UI is styled with **Tailwind CSS (v4)**. The existing design tokens (`apps/web/src/styles/tokens.css`: surfaces, text, accents, status, edges, radii, type scale, light/dark) remain the single source of values and are exposed as the Tailwind theme. Tailwind's default color palette is disabled, so only tokens that passed the WCAG contrast test can be used.
- All components are migrated from CSS Modules to Tailwind utilities. Repeated patterns (buttons, chips, segmented controls, floating panels, cards) become shared components. Bespoke artwork that utilities cannot express (resource glyphs, status shapes) and third-party overrides (React Flow, 3D labels) live in Tailwind `@layer components` / base CSS, not CSS Modules.
- No visual or accessibility regression: contrast, axe, keyboard, and reduced-motion checks must still pass, and both themes must render as before.

## K. Section pages (no placeholders)
Every navigation section is a working page built on the canonical data and shared state (environment, filters, selection, simulation, history mode). Placeholders are no longer acceptable.

### K.1 Overview
- Environment summary for the selected environment: counts of service instances, resources, relationships, and entities by health; providers present; data source and simulation status (labeled simulated).
- "Needs attention": unhealthy instances/resources (worst first), including simulated impacts with their cause; each opens the entity (selection + inspector) and offers "Show on map".
- Provider breakdown (entities and unhealthy per provider) and recent simulated events.
- Quick actions: open the 2D map, open the 3D galaxy, open the registry filtered to unhealthy.
- Honors history mode (`asOf`): shows the snapshot and says so.

### K.2 Dependencies
- Pick an entity (defaults to the shared selection; searchable picker).
- Upstream (what it depends on, transitively) and downstream (what depends on it) with hop count, path, and protocol per hop; direct vs. transitive clearly marked.
- Failure impact preview: "if this entity became unavailable", the entities affected per the propagation rules, each with rule and cause. A read-only what-if that does not change simulation state.
- Actions: select, show on map (neighborhood), simulate the failure (explicit, labeled simulated).
- Keyboard-operable, with empty states (no selection, no dependencies, leaf).

### K.3 Infrastructure
- Containment hierarchy browser: provider → account/subscription/project/datacenter → region → cluster → namespace/broker → hosted instances and resources, from explicit `parentResourceId` (never inferred).
- Per node: type, environment (explicit or inherited), health roll-up (worst of descendants) with counts, and contained-entity counts.
- Expand/collapse (keyboard tree semantics), search and shared filters, environment scoping (environment-independent resources shown separately).
- Select → inspector; "Show grouped on map" (grouped infrastructure mode) and "Explore in 3D".

### K.4 Settings
- Appearance: theme (system, dark, light), persisted; motion preference (follow system or always reduce), which overrides animations app-wide.
- 2D/3D defaults: default view, 3D label density, simulated-traffic particles on/off.
- Simulation: default speed; reset simulation.
- Saved layouts: list and delete (same repository as the map).
- Data: current data source label (mock), switch between the mock inventory and generated datasets, link to the API contract; reset all view state.
- Preferences are stored locally behind an interface and are never treated as shared/canonical state.

## L. Acceptance additions
- No placeholder pages remain; each section page has integration tests and an axe audit case, and is in the real-browser audit.
- The Tailwind theme exposes only token colors; the contrast test continues to gate the build.

# Revision 6 Addendum — Event catalog (2026-10-11)

**Source:** product owner direction after Milestone 6 review: the UI mock (`docs/ui-frontend-mock/Main.dc.html`, "Events" section) shows an event catalog that no document required. Authoritative where it conflicts with earlier text. Delivery: Milestone 7 (`docs/milestones/MILESTONE_07_EVENT_CATALOG.md`). Decision record: ADR-014.

## M. Event catalog

### M.1 Event types (canonical data)
- An **event type** (e.g. `OrderPlaced`) is a logical, environment-independent contract, like a service definition: ID, name, description, schema version, owner/team, and metadata.
- It is **carried on a messaging channel**: a Kafka topic, RabbitMQ exchange, or RabbitMQ queue resource. It lists one channel per environment it exists in (at most one per environment).
- **Producers and consumers** are service definitions. In a given environment they resolve to that environment's service instances. Each resolved producer must have a modeled relationship to the channel, and each resolved consumer must have a modeled relationship from the channel. For an exchange, a consumer may instead read from a queue bound to that exchange. Event types never invent communication: they annotate relationships that already exist.
- Violations are validation errors (consistent with ADR-008): unknown channel, a channel that is not a topic/queue/exchange, two channels in one environment, an unknown producer/consumer definition, or a resolved producer/consumer without the matching relationship.
- Event types are optional in the topology contract (additive within v1). Data without them shows an empty catalog.

### M.2 Events page
- The **Events** navigation section is the event catalog (as in the mock). The simulation/history page formerly called "Events & Traffic" becomes **Simulation** (`/simulation`), unchanged in function.
- List: event types that exist in the selected environment, searchable by event name or channel name, each with its channel and producer/consumer counts. Count shown with the environment.
- Detail: name (monospace), description, schema version, owner; producers → event on its channel → consumers, each with health status. Selecting a producer, consumer, or the channel sets the shared selection (inspector). Empty states: no events, no matches, no consumers modeled, producer/consumer definition not deployed in this environment.
- The selected event is part of the URL (`/events/<eventTypeId>`) so it can be shared.
- Actions: **Highlight in 2D** and **Show in 3D galaxy** open the map with the event's flow emphasized.
- Honors history mode (`asOf`): flows and health come from the snapshot being viewed.

### M.3 Event highlight on the map
- An event highlight emphasizes exactly the event's flow in the selected environment (producer instances, the channel, any bound queue on the path, consumer instances, and the relationships between them) and dims the rest, in 2D and 3D, using the same emphasis treatment as selection.
- A selection takes precedence; the highlight resumes when the selection is cleared. A visible, keyboard-operable chip names the event and clears the highlight.
- The highlight is shared, cross-view state, mirrored to the URL (`ev=<eventTypeId>`, additive within URL state v1).
- The inspector of a topic/queue/exchange lists the event types it carries, each linking to the catalog.

### M.4 Acceptance additions
- Event types validate against the rules in M.1 with tests per rule; the mock inventory has event types consistent with its relationships and validates with zero issues.
- The JSON Schema and OpenAPI contract include event types; contract tests pass.
- The Events and Simulation pages have integration tests and axe cases (jsdom and real browser, both themes).

# Revision 7 Addendum — Editing the topology (2026-10-12)

**Source:** product owner direction: "design buttons in the UI in order to create or update all resources", with delete, only when connected to the backend. Authoritative where it conflicts with earlier text (the product was read-only for inventory). Delivery: Milestones B7 (API) and 8 (UI), `docs/milestones/MILESTONE_08_ENTITY_EDITING.md`. Decision record: ADR-020.

## N. Editing

### N.1 Scope
- Every canonical entity kind can be **created, edited, and deleted**: environments, service definitions, service instances, resources (including topics, queues, exchanges), connections (communication relationships), and event types.
- Editing is available only when the data comes from the backend (`?source=api`). With built-in mock data the actions explain that the data is read-only and link to the backend source. Editing is unavailable while viewing history.
- Edits start from the stored values, never from the simulated state. Telemetry is not editable; "updated" timestamps are set when saving.

### N.2 Actions
- **New** in the header (every page): one entry per entity kind with a one-line explanation.
- **Edit** and **Delete** at the bottom of the inspector for the selected entity (map, registry, and every page with the inspector), and on the event detail of the Events page (plus **New event type** next to the catalog heading).
- Forms open as a side sheet: one field per attribute, with pick-lists for references (environment, service definition, hosting resource, parent resource, connection endpoints, channels, producers, consumers) and enumerations. IDs are suggested from the name or the references and cannot change after creation.

### N.3 Integrity
- Before sending, the form checks the whole resulting topology with the same rules as the server and lists what the change would break; the server validates again.
- A delete of anything that is still referenced is refused, listing each reference in plain words (e.g. "Order Service → Payment Service (connection): uses it as an endpoint").
- If someone else changed the topology since it was loaded, the save is refused and the user can reload the data without losing the form.
- After saving, the topology reloads, the simulation restarts from it, and the new or edited entity is selected (event types open in the catalog).

### N.4 Acceptance additions
- Create, edit, and delete work for every kind against the backend; invalid changes never reach storage; referenced entities cannot be deleted; stale edits are refused.
- Forms, menus, and dialogs are keyboard-operable, label every field, announce errors, keep focus inside dialogs, and return it afterwards; axe audits pass.

# Revision 8 Addendum — Transit board (2026-10-12; Phase 1 implemented)

**Source:** product owner direction: add the "Payment Service Transit Board" screen to the design. The prototype is in `docs/design-references/payment-transit-board/`, and the implementation spec in `docs/TRANSIT_BOARD.md` (the spec wins over the prototype). Authoritative where it conflicts with earlier text. Status: Phase 1 implemented on example data (Milestone 9, 2026-10-12). Delivery: Milestone 9 (`docs/milestones/MILESTONE_09_TRANSIT_BOARD.md`). Decision record: ADR-021 (proposed).

## O. Transit board

### O.1 Purpose
- A per-service screen that shows how **one service** executes:
  - one coloured line per entry point (gRPC/HTTP endpoint, webhook, consumed event, scheduled job, background worker);
  - each line runs through the stations it touches (callers, gates, modules, clients, dependencies);
  - policy stops (timeout, retry, bulkhead, breaker, fallback, cache) sit on every outbound call.
- It answers "what does this endpoint call, in what order, with which protections, and where did this request spend its time?", for service owners, on-call engineers, and reviewers.
- It complements, and does not replace, the cross-service views:
  - the 2D map, the registry, and the 3D galaxy show the topology between services;
  - the board shows the inside of one service.

  Cross-service business flows, editing config, and live traffic streaming are out of scope.

### O.2 Screen
- The layout has five parts:
  - a header with the breadcrumb (environment / service), the title, the mode switch (Typical route | Trace replay), and a data-freshness label;
  - a searchable line index grouped by kind;
  - a perspective SVG transit map with a legend;
  - a line card;
  - a stop strip under the map and the card.
- Breakpoints, the detailed visuals, and the panel states (loading, empty, no selection, no traces, partial data, error) are as specified in `docs/TRANSIT_BOARD.md`.
- **Typical route** shows:
  - the most frequent route over a time window, with branches of at least 2% share;
  - per-step stats;
  - the policy states (solid / outline / missing / unknown);
  - findings with evidence;
  - the deadline budget bar.
- **Trace replay** plays one sample request along the line:
  - controls for play, pause, step, and scrub;
  - retries, fallbacks, and errors shown on the map and the strip;
  - divergence from the typical route marked;
  - gaps where trace context was lost shown as gaps.
- The selection, mode, search, trace, and paused playback time are shareable through the URL.

### O.3 Data honesty
- Every element shows its provenance: **declared** (specs, config), **observed** (traces), or **inferred** (code scan).
- "Missing policy" (config read, policy absent) is never shown when the config source failed to load ("unknown").
- Example and mock data are labelled as such, never as live (same rule as the rest of the app).

### O.4 Acceptance additions (Milestone 9 scope: spec Phase 1, mock data)
- Selection, search, typical mode, all panel states, and the responsive breakpoints work on the prototype's data converted to the spec's types.
- The map is never the only way to reach information: the index and the strip are accessible lists. Colour is never the only signal. The keyboard shortcuts work. Reduced motion steps instead of animating.
- Trace replay on example traces: samples, playback with a train, scrubbing, divergence, off-map and lost-context steps, fan-out, keyboard, reduced motion, and a shareable URL. The window selector (1h, 24h, 7d), per-step stats, and hover tooltips are included.
- The board follows the app's light/dark switch like every other page (not dark-only). New colours are tokens that pass the contrast test in both themes. The page has axe cases.

# Revision 9 Addendum — Business flows (2026-10-12; implemented, Milestones 10 and B8)

**Source:** product owner direction: the transit board should show the steps of a business process, keeping its policies and retries. Decisions: two levels, flows authored and imported, transaction replay included. Authoritative where it conflicts with earlier text (it supersedes "cross-service business flows are out of scope" in Revision 8 §O.1). Spec: `docs/BUSINESS_FLOWS.md`. Delivery: Milestone 10 (frontend) and B8 (backend). Decision: ADR-022.

## P. Business flows

### P.1 Flows
- A **business flow** (Checkout, Refund) is a canonical, environment-independent entity. It has:
  - **steps**, each owned by a service, of kind task, decision, wait, compensation, or manual;
  - **transitions** between steps, each a call or an event, with conditions and policies;
  - **outcomes**, an end-to-end **target**, and its **source** (authored, or imported from where).
- Every transition must be backed by a modeled connection or an event type in each environment where both services run. Flows never invent communication.
- Policies on transitions keep the transit board's model and states, extended with redelivery, dead-letter queue, idempotent consumer, outbox, step deadline, compensation, and manual intervention.

### P.2 Screens
- **Flows** in the navigation: a catalog (search, owner, steps, completion rate, warnings) and a flow board per flow.
  - Lines are flows, stations are steps in service bands, branches are outcomes with shares, and undo tracks are compensation.
  - The board has the budget bar, findings, typical mode with a window, and the same states, themes, and responsive rules as the transit board.
- **Opening a step** shows that service's transit board with the step's line selected; there is a way back.
- **Transaction replay** by business key or from samples (slowest, failed, compensated, with retries, typical): steps on compressed business time, retries, redeliveries, dead-letter parking, compensation, and uncorrelated gaps shown as such. Opening a step during replay shows its own trace on the service board.
- **Editing:** create, edit, and delete authored flows when connected to the backend (rules of Revision 7). Imported flows are read-only, with "duplicate as authored flow".
- **Import:** a native flow file (JSON or YAML) and BPMN 2.0, through the backend.

### P.3 Acceptance additions
- Every validation rule has a test in TypeScript and Go, with identical codes on the shared fixtures. The example Checkout and Refund flows validate with zero issues.
- The flow board, drill-down, and replay have integration tests, axe cases in jsdom and in a real browser in both themes, keyboard access, and reduced motion.
- Example observed data is labelled as example data, never as live.

# Revision 10 Addendum — Flow swimlanes, flows on the service board, patterns, impact, 3D drill-down (2026-10-12; Milestone 11 in progress, 12–13 specified)

Spec: `docs/BUSINESS_FLOWS.md` Revision 2. Decisions: ADR-023 to ADR-026.

## Q. Business flows, second iteration

### Q.1 Milestone 11 (in progress)
- **Swimlanes.** The flow board draws one flow as swimlanes: services are lanes, steps are columns in order, outcomes get the last lane, and edges are orthogonal. It pans, zooms, and fits. Steps shared with other flows say so and link to them.
- **Flows on the service board.** A service's transit board lists the business flows that use it. Selecting one highlights the lines its steps enter. The line card links each step back to its flow.
- **One pattern catalog** names every policy and pattern on both boards. It adds the inbox, polling publisher, and async request-reply patterns, with findings for:
  - an outbox without a relay;
  - at-least-once delivery without deduplication;
  - polling without a deadline.

### Q.2 Milestones 12 and 13 (specified, not started)
- **Flow impact:** simulated failures show which flows break, at which step, and the likely outcome. This appears in the inspector, the simulation page, the flow board, and the catalog, and is always labelled simulated.
- **3D drill-down:** an optional 3D view with the flow above its services' boards. The user flies down into a service and climbs back. The 2D views stay primary.

### Q.3 Acceptance additions
Those of `docs/milestones/MILESTONE_11_FLOW_SWIMLANES_PATTERNS.md`, `MILESTONE_12_FLOW_IMPACT.md`, and `MILESTONE_13_FLOW_3D_DRILLDOWN.md`.
