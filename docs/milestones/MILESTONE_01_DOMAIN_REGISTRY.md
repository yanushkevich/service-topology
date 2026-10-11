# Milestone 1 — Domain, mock data, registry, and shell

**Read first:** `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/API_CONTRACT.md` when relevant.

## Claude Code operating guidance
- Consult `docs/README_INDEX.md` and `docs/AGENT_WORKFLOW.md`; load only the relevant docs and this milestone.
- Use `/topology-milestone` to structure execution and `/topology-verify` for evidence-based closeout. For domain changes, also use `/topology-domain`; for graph UI, use `/topology-ui`.
- `docs/archive/original-v1/` is historical and must not override current accepted decisions.

## Global execution contract
- Inspect the current repository before changing code.
- Implement only this milestone and its explicit acceptance criteria.
- Preserve existing data and working functionality; do not delete prior requirements or documents.
- If an architectural decision conflicts with the documented contract, explain the impact before changing it.
- Run checks and report only results actually observed.
- Update the milestone/phase status and architecture decision log when complete.
- Commit the completed milestone with a Conventional Commits message (scope `m1`), staging only its files; see `docs/AGENT_WORKFLOW.md` §6.
- Report changed files, tests and benchmarks, known limitations, and next milestone prerequisites.
- Stop after this milestone; do not automatically start the next.

## Deliver
- A running shell with navigation, theme foundations, and clear page/view placeholders.
- Canonical service definitions, per-environment service instances, infrastructure resources, communication relationships, environments, health, protocols, and metrics.
- Repository interface plus realistic mock data with 15+ connected entities spanning AWS, Azure, GCP, and on-premises.
- Searchable/filterable registry and basic inspector for selected records.
- Explicit resource hierarchy and first-class Kafka topic / RabbitMQ queue or exchange support.

## Acceptance criteria
- Type check and production build pass.
- Unique IDs and all references validate.
- A service instance belongs to exactly one environment; a logical definition may have instances in multiple environments.
- Parent-resource hierarchy contains no missing parents or cycles.
- Registry search/filter/selection work from canonical IDs.
- Simulated metrics are visibly labeled.
- Document unresolved data-model questions; do not silently invent new entity semantics.

## Definition of done
The listed acceptance criteria have been verified against the implementation, integration points work, regressions introduced by this milestone are fixed, and limitations are documented.
