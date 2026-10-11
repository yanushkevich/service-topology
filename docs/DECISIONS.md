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
