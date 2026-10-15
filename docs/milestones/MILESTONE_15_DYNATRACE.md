# Milestone 15 — Dynatrace connector: services, databases, and Kubernetes from Smartscape on Grail

**Status:** accepted 2026-10-15; in progress. Backend milestone: B12. Decision: ADR-034. Spec: `docs/DYNATRACE_CONNECTOR.md`.

**Source:** the product owner asked to get "data, services, databases, etc. from dynatrace", and answered:
- Grail / Smartscape (SaaS platform);
- Dynatrace owns what it finds;
- structure is previewed and applied by hand, while health and metrics refresh on their own.

## Today
- The topology is mock data, authored data (editing, the sandbox, bundle imports), or the backend seeded from the same fixtures. Every metric is simulated.
- Milestone 14 (real data) is on hold. It waited for the stack questions in `docs/REAL_DATA_INTEGRATION.md` §6, and this milestone answers them for the topology: the source is Dynatrace.

## Design (summary; details in the spec)
1. **A backend connector** (`backend/internal/adapters/dynatrace`).
   - A Grail query client with a platform token or an OAuth client.
   - Constant DQL queries for services, calls, Kubernetes containment, databases, metrics, and problems.
   - A pure mapping onto canonical entities.
2. **A pure reconcile** of discovered and stored data:
   - owned entities are created, replaced, or deleted;
   - authored entities are linked, never overwritten;
   - entities that are gone but still in use are kept and flagged;
   - aliases map Dynatrace names to existing services.
3. **Preview and apply.** A held preview with every change, note, and validation issue. The apply is one transaction guarded by the topology revision.
4. **An observation overlay** for health and metrics, refreshed every minute without creating topology revisions.
5. **Settings → Data source → Dynatrace:**
   - status;
   - connection check;
   - preview table with alias mapping;
   - apply.

   The rest of the UI only gains provenance ("Observed · Dynatrace · as of 08:45").
6. **A fake tenant** for tests and local demos, labelled as example data.

## Out of scope
- Transit boards, flow statistics, traces, and replay from Dynatrace (Milestone 14, still on hold).
- Hosts, processes, containers, pods, queues, and topics (gaps listed in the spec §1).
- The classic Environment API v2. The connector sits behind one interface, so it can be added later.
- Writing anything to Dynatrace.

## Phases (scope `m15`, backend `b12`)
1. **Client, queries, mapping, and fake tenant:**
   - configuration loading and validation;
   - the Grail client (execute, poll, auth, limits);
   - the mapping to a discovered topology;
   - `fixtures/dynatrace/example-tenant.json`;
   - unit tests against the fake.
2. **Reconcile, preview, and apply:**
   - the pure reconcile with aliases;
   - a batch write port (`ApplyChanges`);
   - entity ownership from `_meta.sourceType`;
   - the `/integrations/dynatrace` endpoints;
   - OpenAPI, API tests, and the contract check.
3. **Observation overlay:**
   - the refresh loop;
   - the `observations` document;
   - the overlay on topology reads (and on the index used by traversal and impact);
   - the meta `observedAt`.
4. **Frontend:**
   - the Settings rows (status, check, preview, aliases, apply);
   - provenance labels;
   - periodic refetch with `?source=api`;
   - accessibility tests.
5. **Close-out:**
   - runbook (creating the platform token or OAuth client, scopes, configuration);
   - docs and screenshots;
   - `make check`, `npm run check`, and the real-browser audit;
   - `make test-integration` and `make contract-check` when the database runs.

## Acceptance criteria
- Against the fake tenant, a preview lists the services, instances per environment, clusters, namespaces, workloads, databases, and calls the fixture holds. Applying it stores them, and a second preview is empty (tested).
- An authored service with the same slug or an alias is linked, not duplicated, and its owner, team, and description are unchanged (tested).
- An owned service that disappears is deleted, unless a flow uses it; then it is kept, flagged, and its health is `unknown` (tested).
- A call across environments is dropped and noted. The applied topology passes validation (tested).
- The apply fails with 412 when the topology changed after the preview (tested).
- A refresh updates health and metrics without changing the topology revision. Observed metrics have `isSimulated: false`. Stale observations are dropped (tested).
- No secret appears in logs, responses, or errors. DQL never contains configuration values (tested).
- The UI never calls example-tenant data observed. axe passes on the new Settings rows in jsdom and the real browser, in both themes. `npm run check` and `make check` pass.
