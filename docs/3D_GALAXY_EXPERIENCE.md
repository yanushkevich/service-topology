# 3D Galaxy Experience — Product and Interaction Specification

**Status:** Authoritative design specification for the 3D view. This document expands the 3D requirements in `PRODUCT_SPEC.md`; it does not supersede the 2D-first delivery decision.

## 1. Product intent

The 3D network should feel like an explorable galaxy of software: services and infrastructure resources are luminous, individually selectable worlds; relationships are glowing paths through a deep spatial field; related systems form recognizable constellations; and users can travel into a selected node to explore the next level of its topology. The galaxy metaphor is a visual language for a real, data-backed graph—not a decorative starfield and not a geographic map.

The experience must communicate real relationships, hierarchy, status, and scope. Never invent children, connections, traffic, or health just to make the scene look full. Mock data is allowed in the first release only when it is clearly identified as mock/simulated.

## 2. Scene composition and visual grammar

- **Canvas:** deep midnight/charcoal space with restrained atmospheric depth, subtle dust/stars only as background decoration, and no background decoration that competes with graph content. Support dark theme first; keep text, status, and selection indicators accessible in all themes.
- **Nodes as worlds/planets:** each domain entity is a 3D object with a stable identity, distinct silhouette/scale, a soft rim or halo, and a readable label. Use shape, icon/glyph, and text as well as color to distinguish entity types. Avoid making size imply importance unless a documented metric or explicit visual mode explains it.
- **Constellations:** related services are arranged into spatial clusters using meaningful attributes such as environment, system/domain, cluster, namespace, or infrastructure parent. Cluster boundaries and labels must explain the grouping. Layout is deterministic for the same topology, layout seed, and settings.
- **Glowing relationship paths:** connections are curved tubes, lines, or shader-backed paths with subtle glow and clear endpoints. Direction is shown using arrows or moving particles only when direction is known. Bidirectional links must be visually distinguishable. Edge style encodes relationship/protocol/status through a consistent legend; glow intensity must not be mistaken for live traffic unless it is explicitly bound to a metric.
- **Activity particles:** animated pulses may travel along edges to represent simulated or observed traffic. Their direction, rate, and color must map to named data fields. With mock data, label the mode as simulated. Do not imply real-time telemetry when no integration exists.
- **Depth and occlusion:** preserve the ability to identify nodes behind other objects. Use camera-aware labels, selective label density, focus highlighting, and filters rather than rendering every label at every distance.
- **Selection:** selected nodes gain a high-contrast outline/halo and contextual label; adjacent nodes and edges may be highlighted, while unrelated topology dims but remains perceivable. Hover is supplemental and must not be the only way to access information.

## 3. Navigation and camera behavior

- Provide orbit/rotate in all directions, zoom/dolly, pan, reset view, fit visible graph, and focus selected node. Use damping and bounded acceleration; avoid disorienting perpetual camera motion.
- Dragging empty space rotates/orbits by default; modifier or alternate pointer gesture pans. Provide visible controls and tooltips so interactions are discoverable. Avoid trapping page scroll or keyboard focus.
- Selecting a node offers an explicit **Explore inside** action. Double-click may be an additional shortcut, but must not be the only route.
- **Dive-in transition:** animate the camera toward and through the selected node/portal, then replace the current scene scope with the node's contained or logically related child graph. Preserve a breadcrumb trail and the parent context. The transition must be interruptible/cancellable and respect reduced-motion preferences.
- **Breadcrumbs and return:** show a persistent path such as `Environment / Cluster / Service / Instance`. “Back one level,” “Return to overview,” and a breadcrumb target restore the previous scope and camera context. Browser back should work where routing/deep-link semantics support it.
- **Context preservation:** switching 2D↔3D preserves environment, filters, selected entity, and applicable scope. A 2D selection can focus the matching 3D entity; a 3D selection updates the shared inspector and 2D selection.
- **Deep links:** where URL state is implemented, encode stable entity/scope IDs and relevant filters, not renderer coordinates or Three.js objects.

## 4. What “enter a node” means

Entering a node is progressive disclosure into a real subgraph, not an unstructured animation and not a requirement to model every service as a physical hollow sphere. The exact child content depends on entity type and the available domain relationships:

| Selected entity | Inside/next scope may show |
|---|---|
| Environment / cloud account | regions, clusters, shared infrastructure, services discovered in that environment |
| Cluster / namespace | workloads, deployments, service instances, pods when represented in the model |
| Logical service definition | its environment-specific service instances, owned resources, inbound/outbound dependencies |
| Service instance / workload | endpoints, dependency links, attached infrastructure, runtime resources available in the model |
| Message broker / Kafka cluster | topics, partitions when modeled, producers and consumers |
| Kafka topic / RabbitMQ queue or exchange | producer/consumer or publisher/subscriber relationships and related services |
| Database / storage resource | connected services, replicas or schemas only when represented by actual model fields |

The view must distinguish **containment** (what is inside/hosted by a parent) from **communication** (what talks to what). A relationship edge alone does not mean one node contains another. If the selected entity has no modeled children, show an honest empty/leaf state with its details and connected neighborhood; do not fabricate an interior.

A child scope may include a **local neighborhood** of upstream/downstream dependencies in addition to contained children, but the two sets must be visually and semantically distinct. Provide a scope toggle or legend when both are shown.

## 5. Interaction model and controls

Minimum controls:
- Orbit/rotate, pan, zoom, reset camera, fit visible graph.
- Search and focus entity; filter by environment, entity type, provider, health, protocol, and relationship type where supported.
- Select, inspect, highlight neighborhood, and **Explore inside**.
- Breadcrumbs, back one level, return to overview.
- Toggle labels, edge labels, traffic particles, relationship categories, and containment boundaries.
- Legend explaining entity types, edge types, direction, health, mock/observed data, and selection.
- Pause/resume motion and honor reduced-motion settings.
- Accessible alternative: searchable entity list/registry, keyboard-operable selection/navigation, and the shared inspector. 3D cannot be the only way to discover or understand graph data.

## 6. Entity and edge rendering contract

Create renderer-specific view models from canonical domain entities and relationships. Keep the domain model independent of Three.js/R3F. Every rendered node and edge maps to a stable canonical ID. Never key business identity by a transient mesh UUID.

Node visual state should be derived from explicit data: entity type, health/status, selected/hovered/focused state, current scope, parent/child status, and optional measured metrics. Edge visual state should be derived from source/target IDs, relationship type, direction, protocol, health, and explicitly available traffic metrics. Unknown values use neutral styles and are not inferred.

Use a consistent rendering vocabulary:
- **Contained-by / inside:** enclosure, cluster shell, or spatial grouping—not a glowing communication path.
- **Depends-on / calls / publishes-to / consumes-from:** paths with direction and relationship-specific legend.
- **Selected / focused:** accessible outline plus halo and text.
- **Unhealthy / degraded:** status shape/icon plus color; never color alone.
- **Simulated:** persistent UI label/badge outside the 3D geometry as well as any optional edge animation.

## 7. Spatial layout and scale

- Generate stable spatial placement from graph structure and semantic grouping, not random positions on each render. Repeated visits should preserve layout unless the user explicitly changes it.
- Keep strongly related nodes near their cluster while maintaining edge readability and reducing overlaps/occlusion. Support disconnected components and cyclic graphs.
- Prefer progressive scope: overview shows major systems/clusters and representative or aggregated nodes; entering a cluster reveals detail. Allow expanding a cluster into the current scope and collapsing it again.
- Target the project's benchmark of 250 visible nodes and 750 visible edges, measured on the actual implementation. The 1,000-entity inventory is navigated using filtering, grouping, aggregation, and local neighborhood exploration—not by forcing every full-detail node into one 3D frame.
- Define level-of-detail thresholds for labels, edge detail, particles, and geometry. When many edges overlap, aggregate them or reveal them on focus/zoom rather than drawing an unreadable glowing hairball.
- Use deterministic layouts for the same graph input and settings. Document seed/version and persistence rules for user-adjusted layouts.

## 8. Motion and effects

- Use finite, purposeful camera transitions for focus and dive-in; avoid unrequested camera drift.
- Keep edge glow subtle and localized. Glow is a visual aid, not a substitute for line contrast, direction markers, or a legend.
- Use animation only to encode a known concept such as simulated traffic, propagation, or selection. Include a global pause control and respect `prefers-reduced-motion`.
- In reduced-motion mode, replace camera flights with short fades or immediate scope changes; static arrows/markers replace moving particles.
- Avoid expensive full-screen bloom if it makes labels/edges muddy or harms frame rate. Prefer selective glow, restrained emissive materials, and DPR/quality controls.
- Clean up geometries, materials, render targets, observers, and animation resources when scopes change or the view unmounts.

## 9. Performance, failure, and verification

- Lazy-load the 3D scene and keep the application, registry, inspector, and 2D view usable without WebGL.
- Detect WebGL unavailability/context loss and show a useful fallback with a link back to 2D/registry; do not crash the entire app.
- Cap device pixel ratio and expose a quality mode if needed. Avoid per-frame React state updates; use refs/imperative Three.js updates for animation.
- Test camera controls, scope transitions, breadcrumb restoration, shared selection, filters, deterministic layout, large visible graph, WebGL fallback, context loss, reduced motion, and disposal.
- Record measured frame rate/load time and hardware/browser used for the benchmark. Do not claim the target passes without evidence.

## 10. Acceptance checklist

- [ ] Galaxy-like spatial composition reads as a topology, not a decorative screensaver.
- [ ] Nodes can be orbited around, zoomed, panned, selected, and focused.
- [ ] Communication paths glow subtly, show endpoints/direction where known, and match a legend.
- [ ] Users can enter a node, inspect the relevant next-level subgraph, and return via breadcrumbs/back controls.
- [ ] Containment and communication are never conflated.
- [ ] Selection/filter/environment/scope stay synchronized with the shared application state.
- [ ] Labels, status, and selection remain legible; keyboard/registry alternatives exist.
- [ ] Reduced motion, pause, WebGL fallback, resource cleanup, and measured performance are verified.
- [ ] No unmodeled children, edges, traffic, or health values are fabricated.

## 11. Suggested component boundaries

Use the repository's established conventions if they differ, but keep responsibilities separable:
- `Network3DView`: lazy-loaded scene boundary, loading/error/WebGL fallback.
- `GalaxyScene`: scene composition, lighting, environment, quality settings.
- `GalaxyNode`: entity-type-specific mesh/label/selection representation.
- `GalaxyEdge`: curved path, direction marker, optional data-bound traffic particles.
- `ClusterRegion` / `ContainmentGroup`: spatial containment and cluster labels.
- `CameraRig`: orbit, focus, fit, dive-in, and restore transitions.
- `ScopeNavigator`: current scope, breadcrumbs, enter/back/overview actions.
- `SceneViewModelAdapter`: canonical entities/relationships to stable renderer view models.

These are conceptual boundaries, not a mandate to create many tiny files. Consolidate where it improves clarity and split when a component has independent behavior/tests.
