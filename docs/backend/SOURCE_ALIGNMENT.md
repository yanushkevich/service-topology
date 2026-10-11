# Alignment with the Product and Frontend Docs

The backend extends the product; it does not redefine it. The v4 pack was written against UI Revision 4. Since then the frontend implemented Milestones 1–7 and Revisions 5–6, and several decisions became binding. This file lists what the backend must preserve and where the authoritative definitions are.

## Precedence (same as the root `CLAUDE.md`)
1. Explicit user direction for the current task.
2. Approved decisions in `docs/DECISIONS.md` (ADR-001…ADR-015) and the latest revisions of `docs/PRODUCT_SPEC.md` / `docs/ARCHITECTURE.md`.
3. The implemented, tested contract: `docs/api/openapi.json`, `docs/schemas/*`, `apps/web/src/domain/*`.
4. These backend docs. Backend-only decisions are recorded as `ADR-DB-*` in `DATABASE_DECISIONS.md`; a backend decision that changes product behavior or the contract needs a root ADR.

## Product requirements to preserve
- 2D topology is the primary operational view; 3D galaxy is secondary. Both, the registry, and the event catalog use the same canonical IDs and relationships.
- Grouped infrastructure mode and the Infrastructure page present the containment hierarchy (`parentResourceId`, instance `resourceId`); they are not a different graph.
- Entering a scope in 3D reveals real modeled children and relationships; leaves never invent children.
- Simulated/mock data is labeled; nothing is described as "live" (`docs/POSITIONING.md` messaging rules).
- Scale targets (ADR-005): 250 visible nodes / 750 visible edges; 1,000 entities navigable. Targets to measure, not guarantees.
- Layout, camera, and preferences are separate from canonical data. Preferences are local to the browser today (Revision 5 §K.4).

## Decisions the v4 pack predated (now binding)

| Topic | Decision | Where |
|---|---|---|
| ID uniqueness | Unique across all collections | ADR-008 |
| Environment inheritance | Resources inherit through containment; environment-independent resources are shared | ADR-008 |
| Cross-environment communication | Validation error (except environment-independent endpoints) | ADR-008 |
| Instance/host environment | Must match | ADR-008 |
| Workloads and replicas | The instance is the workload; replicas not modeled | ADR-008 |
| RabbitMQ bindings | Relationships with `metadata.bindingKey`; exchange → queue/exchange only | ADR-008 |
| Propagation rules | Rule-based, explainable, in `apps/web/src/domain/propagation.ts` | ADR-010 |
| Simulation | Pure engine running client-side; snapshots `source: simulation` | ADR-010 |
| API standards | OpenAPI 3.1, JSON Schema 2020-12, RFC 9457 problems, cursor pagination | ADR-012, `docs/API_CONTRACT.md` |
| Event types | Logical contracts on channels; validated against relationships | ADR-014 |
| URL state | Versioned query contract (`docs/schemas/topology-url-state.v1.md`); not a backend concern but IDs must stay stable | ADR-009 |

## Database choice
The product docs do not prescribe a database. ArcadeDB-only persistence is a backend decision (`DATABASE_DECISIONS.md` ADR-DB-001), adopted for the monorepo by root ADR-015.
