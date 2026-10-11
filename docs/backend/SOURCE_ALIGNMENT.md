# Alignment with UI Revision 4

This backend spec extends rather than replaces UI Revision 4. Preserve the following product requirements:
- 2D topology is the primary operational view; 3D galaxy is a secondary spatial exploration mode.
- Both views use the same stable resource identity and canonical relationships.
- Grouped infrastructure mode is a presentation of containment hierarchy, not a different domain graph.
- Entering clusters/namespaces/services reveals real modeled children and relationships; leaf resources do not invent children.
- Inspector, registry, dependency exploration, filters and saved views require consistent IDs and query semantics.
- Simulated/illustrative traffic is not presented as observed telemetry.
- Keep existing target: 250 visible nodes, 750 visible edges, navigation across 1,000 entities. These are targets to validate, not guaranteed performance.
- Persist user layout/camera preferences separately from canonical service/resource data.

The UI documents do not prescribe a database; ArcadeDB-only persistence is a backend architecture decision introduced in this v4 package.
