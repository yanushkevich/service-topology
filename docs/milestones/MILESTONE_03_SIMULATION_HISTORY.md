# Milestone 3 — Simulation, dependency analysis, and topology history

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
- Report changed files, tests and benchmarks, known limitations, and next milestone prerequisites.
- Stop after this milestone; do not automatically start the next.

## Deliver
- Simulation service separate from renderer components.
- Simulated traffic/latency updates, health transitions, failure and recovery.
- Explicit and explainable dependency-propagation rules.
- Versioned topology snapshot contract and a simple fixture-based historical “as of” or comparison workflow.
- Event/history presentation that clearly distinguishes simulated from observed data.

## Acceptance criteria
- Given the same fixture and action, simulation results are deterministic in tests.
- Propagation rules specify which relationship types propagate failure and why.
- Changes appear consistently in registry, inspector, and 2D graph.
- Snapshots contain schema version and timestamp and can represent topology/relationship/health state.
- Historical data does not mutate current state when browsing a prior snapshot.
- No UI describes mock events as live telemetry.

## Definition of done
The listed acceptance criteria have been verified against the implementation, integration points work, regressions introduced by this milestone are fixed, and limitations are documented.
