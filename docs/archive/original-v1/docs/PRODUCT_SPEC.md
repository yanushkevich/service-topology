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

### 3D network
Use Three.js via React Three Fiber and Drei. Build a real interactive scene with reusable nodes, curved connections, meaningful spatial grouping, orbit/zoom/pan, hover/selection, camera focus, readable labels, restrained glow, and animated signals only when they communicate simulated activity. Synchronize selection and filters with other views. Lazy-load the scene, support reduced motion, and provide graceful WebGL fallback.

Do not force services onto a geographic globe unless coordinates exist and the user chooses that representation.

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
