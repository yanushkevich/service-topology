# Dynatrace connector: topology from Smartscape on Grail (Milestone 15, backend B12)

**Status:** implemented 2026-10-15 (closeout in `docs/IMPLEMENTATION_PLAN.md`); Revision 2 (Milestone 15.1: hosts, topics and queues, the documented metric join); Revision 3 (Milestone 15.2: metrics on calls from spans, no workload resources). Not yet verified against a real tenant. Decision: ADR-034. Milestone: `docs/milestones/MILESTONE_15_DYNATRACE.md`.

**Source:** the product owner asked for "a feature that would allow us to get data, services, databases, etc. from dynatrace, and lets say i can connect it to dynatrace". Their answers:
1. **API:** Grail / Smartscape (the SaaS platform), not the classic Environment API v2.
2. **Ownership:** Dynatrace owns what it finds. Authored data (flows, event types, boards, owners) stays and links by ID. Names match existing services, with an editable alias list. A service that disappears but is still used is kept and flagged, not deleted.
3. **Sync:** structure changes are previewed and applied by hand; health and metrics refresh on their own.

This answers `docs/REAL_DATA_INTEGRATION.md` §6 for the **topology** (entities, relationships, health, instance metrics): the source is Dynatrace. Transit boards, flow statistics, and traces stay with Milestone 14, which remains on hold.

> **Unverified against a real tenant.** The queries and field names below come from Dynatrace's public documentation (Smartscape on Grail, the semantic dictionary, the Grail query API). They are recorded in one place (`backend/internal/adapters/dynatrace/queries.go`), and the connection check (§6) reports every expected field a tenant does not return. Confirm them on the first connection to a real tenant, and correct the fixtures if they differ.

---

## 1. What comes from Dynatrace, and what it becomes

| Dynatrace (Smartscape on Grail) | Canonical entity | ID |
|---|---|---|
| `SERVICE` node, in an environment (§3) | a service definition (logical, shared across environments) and one service instance per environment | definition: the alias (§4), else a slug of the service name; instance: `<definition>.<environment>` (the existing convention) |
| `K8S_CLUSTER` | resource `cluster` | `dt-<tenant>-<Dynatrace ID, lowercase>` |
| `K8S_NAMESPACE` | resource `namespace`, parent: its cluster | as above |
| `K8S_DEPLOYMENT`, `K8S_STATEFULSET`, `K8S_DAEMONSET`, `K8S_CRONJOB`, `K8S_JOB` | no resource: the service instance is the workload (ADR-008). The instance runs in its namespace (`resourceId`), and the workload is kept in its link as `metadata.dynatrace.workload = {id, name, kind}` (Milestone 15.2) | — |
| `DB_DATABASE_<VENDOR>` and `DB_INSTANCE_<VENDOR>` (when a service calls the instance directly) | resource `database` | as above |
| `HOST` that a service outside Kubernetes `runs_on` (exactly one) | resource `host` (containment only); the instance's `resourceId` | as above |
| A messaging destination a service published to or received from (`dt.service.messaging.publish.count` / `.receive.count`) | resource `topic` (Kafka, SNS, Event Hubs, Pub/Sub, Pulsar, RocketMQ), `exchange` (a RabbitMQ publish), or `queue` (a RabbitMQ receive and other systems), one per environment | `dt-<tenant>-<system>-<destination slug>-<environment>` (`-exchange` appended for exchanges) |
| A publish / a receive | relationship producer → channel / channel → consumer, `asynchronous`, protocol `kafka`, `rabbitmq`, or `other` | as above |
| `SERVICE` `calls` `SERVICE` (in the same environment) | relationship, `synchronous`, protocol `other` unless an authored relationship says otherwise | `rel:<source>-><target>` (the existing convention) |
| `SERVICE` `calls` `DB_*` | relationship, `database`; protocol from the vendor (`POSTGRES` → `postgresql`; `MYSQL`, `MARIADB` → `mysql`; others → `other`) | as above |
| Open Davis problems on an entity | health (§5): `AVAILABILITY` → `unavailable`; `ERROR`, `SLOWDOWN`, `RESOURCE_CONTENTION`, `CUSTOM_ALERT` → `degraded`; `MONITORING_UNAVAILABLE` → `unknown`; none → `healthy` | — |
| `dt.service.request.response_time`, `.count`, `.failure_count` | instance metrics: latency (ms), throughput (/s), error rate (%), `isSimulated: false`, `observedAt` | — |

- **Containment** comes from the service's own `belongs_to` edges (to its cluster and namespace). The namespace's parent is the cluster the same service belongs to. Workloads are not resources (ADR-008); a sync deletes those an earlier version created.
- **Owner and team** come from the service's `owner` and `team` tags, when present.
- **Category** is `application` when the connector creates a definition; Dynatrace gives no reliable signal for `api`, `gateway`, or `worker`. Authors can change it, and syncs keep the change (§4).
- **The Dynatrace link** is kept on every entity as `metadata.dynatrace`: `{tenant, id, idClassic}`. Metrics and problems are joined through it.

- **Hosts** (Milestone 15.1): a service with no Kubernetes containment that runs on exactly one host runs in it. On several hosts it gets no `resourceId`, and the preview notes `service-on-several-hosts`.
- **Channels** (Milestone 15.1): Smartscape has no topic or queue nodes, so channels come from the messaging metrics over the discovery window. A destination with no messages in the window is not a channel. An authored channel with the same type and name in the same environment (also when inherited from its broker) is linked instead, so event types keep working. A relationship whose ID derives from its endpoints (`rel:<source>-><target>`) is renamed when an endpoint is linked.

**Not mapped (documented gaps):**
- **Processes, containers, and pods.** Below the workload and the host the domain has no containment level.
- **Event types.** They stay authored; channels and their producers and consumers come from Dynatrace.
- **Calls across environments.** Validation rejects them (`cross-environment-relationship`); the preview lists them as dropped.
- **Calls to databases and across tenants** get no metrics: a database call has a client span but no server span, and a tenant's spans only join within it.

## 2. Queries

All queries are constants: no configuration value or user input is ever put into DQL. Environment matching (§3) runs in Go on the results. The time window is passed through the query API's `defaultTimeframeStart` and `defaultTimeframeEnd`, not in the query text.

| Name | DQL | Used by |
|---|---|---|
| `services` | `smartscapeNodes SERVICE \| fields id, name, tags, id_classic` | structure, refresh |
| `service-calls` | `smartscapeEdges calls \| filter source_type == "SERVICE" \| fields source_id, target_id, target_type` | structure |
| `service-belongs-to` | `smartscapeEdges belongs_to \| filter source_type == "SERVICE" \| fields source_id, target_id, target_type` | structure |
| `k8s-nodes` | `smartscapeNodes "K8S_*" \| fields id, name, type, id_classic` | structure, refresh |
| `databases` | `smartscapeNodes "DB_*" \| fields id, name, type, id_classic` | structure, refresh |
| `hosts` | `smartscapeNodes HOST \| fields id, name, id_classic` | structure, refresh |
| `service-runs-on` | `smartscapeEdges runs_on \| filter source_type == "SERVICE" and target_type == "HOST" \| fields source_id, target_id` | structure |
| `messaging-publish` | `timeseries n = sum(dt.service.messaging.publish.count), by: { dt.smartscape.service, messaging.destination.name, messaging.system } \| fieldsAdd n = arraySum(n)` | structure |
| `messaging-receive` | the same with `dt.service.messaging.receive.count` | structure |
| `service-metrics` | `timeseries { rt = avg(dt.service.request.response_time), n = sum(dt.service.request.count), f = sum(dt.service.request.failure_count) }, by: { dt.smartscape.service } \| fieldsAdd rt = arrayAvg(rt), n = arraySum(n), f = arraySum(f)` | refresh |
| `call-metrics` (opt-in, Milestone 15.2) | `fetch spans \| filter span.kind == "server" …` joined to its parent `span.kind == "client"` span on `span.parent_id` = `span.id`, then `summarize { n = sum(m), f = sum(if(failed, m, else: 0)), rt = avg(call_duration) }, by: { caller, callee }` with `m = coalesce(sampling.multiplicity, 1) * coalesce(aggregation.count, 1) * dt.system.sampling_ratio` (full text in `queries.go`) | refresh, every `callMetrics.interval` |
| `problems` | `fetch dt.davis.problems \| filter not(dt.davis.is_duplicate) \| dedup event.id, sort: { timestamp desc } \| filter event.status == "ACTIVE" \| fields event.id, display_id, event.name, event.category, affected_entity_ids` | refresh |

- **Windows:** structure uses the last 24 hours (`discoveryWindow`), metrics the last 5 minutes (`metricsWindow`), and problems the last 7 days.
- **Units:** response time is in microseconds; span `duration` is in nanoseconds. Throughput is `n` divided by the window in seconds. The error rate is `f / n` × 100, and absent when `n` is 0.
- **Joining.** Metrics are keyed by the Smartscape ID (`dt.smartscape.service`), as Dynatrace's service docs join them (Milestone 15.1); a record keyed by the classic `dt.entity.service` still joins through `id_classic`. Problems are keyed by classic IDs (`affected_entity_ids`), matched against `id_classic`, falling back to `id`.
- **Cost.** Smartscape queries are included in the DPS licence. Metric and problem queries scan data, so their windows are short. Every query's scanned bytes are logged and shown in the connection check.

## 3. Configuration

The connector is configured by an operator in a YAML file named by `DYNATRACE_CONFIG_FILE`. Secrets are never in that file: it names secret files, as the MongoDB settings do. Example: `backend/dynatrace.example.yaml`.

```yaml
tenants:
  - id: main                                   # short ID: letters, digits, '-'
    url: https://abc12345.apps.dynatrace.com   # the platform URL, not *.live.dynatrace.com
    auth:
      platformTokenFile: secrets/dynatrace_platform_token.txt
      # or an OAuth client (client credentials):
      # oauth:
      #   clientId: dt0s02.EXAMPLE
      #   clientSecretFile: secrets/dynatrace_client_secret.txt
      #   accountUrn: urn:dtaccount:00000000-0000-0000-0000-000000000000   # optional
environments:
  - id: production
    name: Production
    kind: production
    tenant: main
    match: { tag: { key: environment, value: production } }
  - id: staging
    name: Staging
    kind: staging
    tenant: main
    match: { tag: { key: environment, value: staging } }
refresh: { interval: 60s, metricsWindow: 5m }
discovery: { window: 24h }
limits: { maxRecords: 10000, queryTimeout: 30s }
callMetrics: { enabled: false, interval: 5m }   # opt-in: reads every span (Milestone 15.2)
```

- **Environments.** Each environment names a tenant and one rule, so one tenant split by tags and one tenant per environment both work:
  - `tag: {key, value}`: a service tag;
  - `k8sCluster: <name>` or `k8sNamespaces: [<name>, …]`: the cluster or namespaces the service belongs to;
  - `all: true`: every service in the tenant.

  The first matching environment wins. A service that matches none is skipped, and the preview counts it.
- **Required scopes** (platform token or OAuth client): `storage:smartscape:read`, `storage:entities:read`, `storage:metrics:read`, `storage:events:read`, `storage:buckets:read`. Without `storage:buckets:read`, queries succeed but return no records; the check warns when every query is empty.
- **Validation.** Loading fails fast on any problem: the URL must be `https` (plain `http` only on a loopback host with `allowInsecureLoopback: true`, for the fake tenant); IDs must be unique; every environment must name a known tenant and exactly one rule.
- **Example tenants.** A tenant with `example: true` (the fake tenant, §7) gives entities and metrics `mock` provenance, and the UI says "Example Dynatrace tenant", never "observed".

## 4. Sync: preview, then apply

1. **Discover.** The structure queries run per tenant, and their results map to a *discovered topology* (§1).
2. **Reconcile** (pure Go, tested). The discovered topology is compared with the stored one. Entities the connector created are *owned* (stored `_meta.sourceType: "dynatrace"`); everything else is *authored*.

   | Case | Change |
   |---|---|
   | Discovered, not stored | create, owned |
   | Discovered, stored and owned | replace with the discovered values, keeping what Dynatrace does not provide: description, category (set only on create), owner and team unless tagged, and other `metadata` keys |
   | Discovered, stored and authored (same ID, or an alias) | **link**: add `metadata.dynatrace`; fill the instance's `resourceId` if empty. Nothing authored is overwritten |
   | Owned, not discovered, not referenced by authored data | delete |
   | Owned, not discovered, referenced by a flow, event type, authored relationship, or board link | keep, with health `unknown` or status `inactive`, and flag it in the preview with what uses it |

   **Aliases** map a Dynatrace service name to an existing service definition ID (for example `PaymentService` → `payment-service`). They are stored in the backend, editable from the preview, and applied before the slug. Without an alias, a service whose slug equals an existing definition ID links to it.
3. **Validate** the whole resulting topology with the existing rules. A preview with errors cannot be applied.
4. **Preview.** The result is held for 10 minutes: counts per kind and change, every change with its entity, notes (skipped services, dropped calls, kept-because-used, truncated results), and validation issues.
5. **Apply.** One transaction applies the held change set, if the topology revision is still the one the preview was built on, and records one new revision with source `dynatrace`.

## 5. Health and metrics: refreshed on their own

- **Overlay, not revisions.** Observations live in their own document (`observations`, one per source) and are merged onto instances and resources on read. A refresh never creates a topology revision, so it never conflicts with an edit (If-Match) and never needs a preview.
- **Loop.** Every `refresh.interval` (default 60 s), the refresh queries run (the three node queries, for what is present now, plus metrics and problems), and the overlay is replaced in one write. Every node present is `healthy` unless a problem affects it. Only entities with a Dynatrace link use the overlay.
- **Freshness.** An observation older than three intervals is dropped on read, so stale health is never shown as current.
- **Provenance.** Observed metrics have `isSimulated: false` and `observedAt`. The topology meta gains `observedAt` and the source label "Dynatrace".
- **What a read shows.** Service instances and resources take the observed health; instances take the metrics. `metadata.dynatrace` gains `problems` (Davis display IDs) and `observedAt`. Reads through the index (registry, traversal, impact, single entities) see the same values. `GET /meta` and `GET /integrations/dynatrace` describe the overlay (`observedAt`, `entities`, `isExample`, `stale`).
- **Writes never store observations.** An edit of a linked entity keeps its stored health and its stored `metadata.dynatrace` link, whatever the client sends; metrics were never writable.
- **Metrics on calls** (Milestone 15.2, opt-in with `callMetrics.enabled`):
  - The `call-metrics` query runs every `callMetrics.interval` (default 5 minutes, at least the refresh interval) over a window of the same length, so each span is read about once; refreshes in between reuse the last result.
  - A service-to-service relationship's link holds `id: "calls:<caller>-><callee>"` (Smartscape IDs). Its observed metrics are throughput, error rate (server spans with `span.status_code == "error"`), and latency (the client span's duration).
  - A relationship's status is never changed by observations.
  - If the query fails (for example, Grail's 128 MB join limit), the refresh still updates health and service metrics. The failure appears as a warning in `lastRefresh.warnings`, and call metrics older than three intervals are dropped.
  - Merged duplicate services contribute only the first service's calls.
- **Restarts.** The overlay is also stored (`observations`, one document per source) and restored at start-up, so recent states survive a restart. Each API process refreshes on its own.
- **Example tenants.** Their metrics keep `isSimulated: true`.
- **Clients.** With `?source=api`, the frontend refetches the topology every refresh interval.

## 6. API

| Method and path | Role | Purpose |
|---|---|---|
| `GET /integrations/dynatrace` | reader | configuration (tenant hosts, environments, auth kind; never secrets), last sync, last refresh, last error |
| `POST /integrations/dynatrace/check` | editor | runs every query once; per query: records, missing expected fields, missing scopes, scanned bytes, duration |
| `POST /integrations/dynatrace/preview` | editor | discover and reconcile; returns the held preview (§4) |
| `POST /integrations/dynatrace/apply` | editor | `{previewId}` with `If-Match: <base revision>`; 412 if the topology moved, 410 if the preview expired |
| `GET`, `PUT /integrations/dynatrace/aliases` | reader, editor | the alias list, revision-guarded |

Without a configuration, every endpoint returns 404 `integration-not-configured`. Only one preview or check runs at a time (409 `integration-busy` otherwise).

## 7. The fake tenant

A Go fake of the platform endpoints (`/platform/storage/query/v1/query:execute`, `query:poll`, and the SSO token endpoint) serves recorded records from `fixtures/dynatrace/example-tenant.json`. It answers the first poll with `RUNNING` to exercise polling, and it checks the bearer token.
- Tests use it through `httptest`.
- `make fake-dynatrace` serves it on `127.0.0.1:8099` for local demos, with `backend/dynatrace.example.yaml`. It is marked `example: true` (§3).

## 8. Security

- The platform token or OAuth secret is read from a file, cached in memory, and never logged, returned, or sent anywhere but the tenant and the SSO endpoint. OAuth access tokens are refreshed 30 s before they expire.
- Requests use `https`, a timeout, a response-size cap (64 MiB), and a record cap (`limits.maxRecords`; a truncated result is a preview note). Redirects are not followed, and polling is bounded by the query timeout.
- Dynatrace errors reach clients as fixed messages (for example "Dynatrace rejected the credentials (401)" or "Missing scopes: storage:smartscape:read"), never as response bodies.
- The sync endpoints need the editor role when `AUTH_MODE=token` (ADR-018).

## 9. Hard parts

- **Names.** One service can have different names per environment or tenant. Aliases make the join explicit.
- **Duplicate names in one environment** (for example, two process groups exposing `checkout`) map to one instance. The preview notes it and keeps both Dynatrace IDs in `metadata.dynatrace` (`also`). The instance's observed state merges theirs: the worst health, every open problem, and the first metrics found (Milestone 15.2).
- **Unverified field names** (see the note at the top). The connection check exists for this.
- **After a bundle import,** every entity is authored (source `import`). Dynatrace links to it but never deletes it.

## 10. In the app

- **Settings → Data source → Dynatrace** (with `?source=api`; `features/settings/DynatraceRows.tsx`):
  - the connection: tenant hosts and auth kind, environment rules, last sync, and how current health and metrics are;
  - **Check connection**: one row per query, with missing fields and scopes;
  - **Preview sync**: changes by kind, notes, validation issues, and every change; **Apply** when the result validates;
  - **Aliases**: Dynatrace names mapped to existing services.
- **Inspector:** a Dynatrace section on linked entities: the Smartscape ID, when health was observed and the open Davis problems, or "Not seen in Dynatrace since …" for kept entities. Telemetry says Observed or Simulated per entity, as before.
- **Data-source label:** "observed by Dynatrace at 08:46", "Dynatrace observations out of date", or "example Dynatrace tenant", never observed for the fake tenant.
- **Refetch:** the app refetches the topology every refresh interval (not while the tab is hidden) and continues a running simulation on the new data (`rebase`) instead of restarting it.
- **Simulation:** observed metrics neither drift nor turn simulated; only a simulated failure that changes an entity replaces them, with simulated values (TypeScript and Go engines; conformance scenario `observed-metrics`).

