# Milestone 15.2 — Metrics on calls from spans, and no workload resources (ADR-008)

**Status:** implemented 2026-10-15 (closeout in `docs/IMPLEMENTATION_PLAN.md`); not yet verified against a real tenant. Backend: B12.2. Amends ADR-034. Spec: `docs/DYNATRACE_CONNECTOR.md` (Revision 3).

**Source:** product owner: "continue with Metrics on calls … and Workloads in the registry".

## Today
- **Relationships have no metrics.** No documented Grail metric splits requests by caller.
- **Workloads clutter the registry.** Milestone 15 created a `workload` resource per discovered service. That breaks ADR-008, which says the service instance *is* the workload: `resourceId` points to the most specific host (namespace, cluster, VM host), because a per-instance workload resource is a 1:1 duplicate. The result was registry rows with "0 out · 0 in".

## Design
1. **Workloads (ADR-008):**
   - no workload resources;
   - a Kubernetes instance runs in its namespace (else its cluster);
   - the Dynatrace deployment is kept in the instance's link: `metadata.dynatrace.workload = {id, name, kind}`. The inspector shows it.
   - On the next sync, workload resources a previous sync created are owned and unreferenced, so they are deleted.
2. **Metrics on calls, from spans:**
   - One query, `call-metrics`. It joins each server span to its parent client span (`span.parent_id` = `span.id`) to get caller and callee services (`dt.smartscape.service`), then summarizes per pair:
     - count, extrapolated with Dynatrace's documented multiplicity: `coalesce(sampling.multiplicity, 1) * coalesce(aggregation.count, 1) * dt.system.sampling_ratio`;
     - failures, from server spans with `span.status_code == "error"`;
     - average latency, from the client span's `duration` (nanoseconds; the call as the caller sees it).
   - The values become observed metrics on the relationship: throughput, error rate, and latency, `isSimulated: false` (except on an example tenant). The relationship's link gains `id: "calls:<caller>-><callee>"` (Smartscape IDs). Linked authored relationships get the metrics too.
   - **Opt-in, because of cost.** Grail bills scanned data, and this query reads every span. It is enabled with `callMetrics: {enabled: true, interval: 5m}`. It runs every `interval` over a window of the same length, so each span is scanned about once, and refreshes in between reuse the last result. The example configuration enables it.
   - **Isolated.** If the query fails (for example, Grail's 128 MB join limit), health and service metrics still refresh. The relationship metrics keep their last values until they go stale, and the status reports the failure.
   - **Not covered:** calls to databases (client spans without a server span) and calls across tenants.

## Phases (scope `m15.2`, backend `b12.2`)
1. **Workloads** (mapping, link, inspector, tests).
2. **Call metrics:**
   - configuration;
   - the query and its mapping;
   - the overlay on relationships;
   - the fixture and tests.
3. **Close-out:**
   - docs;
   - `make check`, `make test-integration`, `make contract-check`, and `npm run check`;
   - a live run;
   - the real-browser audit.

## Acceptance criteria
- A discovered Kubernetes service runs in its namespace. No workload resources exist, and the deployment is in the link. A topology synced by Milestone 15 loses its workload resources on the next sync (tested).
- With call metrics enabled, a relationship between two services shows the fixture's count per second, error rate, and latency as observed. Disabled, the query never runs (tested).
- A failing call-metrics query leaves health and service metrics refreshing, and the status says why (tested).
- Example-tenant edge metrics stay simulated (tested).
