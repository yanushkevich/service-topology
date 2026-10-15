# Real data integration: from example data to observed data

**Status:** proposed, **on hold** (2026-10-12). Resume when the product owner answers the questions in §6. Milestone: `docs/milestones/MILESTONE_14_REAL_DATA.md`. Decision: ADR-030 (proposed).

**Source:** product owner, 2026-10-12: "we have implemented p99, other metrics, warnings, retries, etc.; how or from where could this data be injected, what are the options? How could we remove it and swap to real data?"

**Scope.** This document covers every number and state the boards show:
- latency, error and retry rates, shares, policy states, traces, business transactions, health, tables, and contracts;
- where each could come from;
- how to replace the example data without changing the UI.

---

## 1. What is example data today, and where it enters

Every value enters through one of three seams. No UI component invents data.

| Data on screen | Enters through | Today | Real source |
|---|---|---|---|
| Entities, relationships, health, instance metrics (latency, throughput, error rate) | `TopologyRepository`: mock, or HTTP with `?source=api` → MongoDB | mock data; health and metrics are simulated | catalog, Kubernetes API, cloud inventory; health from alerts and SLOs |
| Service board: endpoints (lines), routes, stations, p50/p95/p99, error and retry rates, step shares, traces for replay | `TransitRepository.getBoard`, `getTraces`, `getTrace` | example data, Payment Service only | API specs and traces |
| Policies: config (timeout 2 s, retry ×3) and state (exercised, idle, missing, unknown); "fires on 3.1%", "peak 14 / 20" | inside `getBoard` | example data | resilience and mesh config, plus metrics |
| Tables (`payment_outbox`, …) and dependency links (`entityId`) | inside `getBoard` | example data, declared | DB spans, catalog, alias table |
| Flow stats: transactions, outcome shares, completion p50/p95, per-step stats, transition shares | `TransitRepository.getFlowStats` | example data | traces joined by business key, or orchestrator history |
| Business transactions (replay) | `TransitRepository.getTransactions`, `getTransaction` | example data | as above |
| OpenAPI contracts | `TransitRepository.getOpenApi` | example specs in the bundle | spec files from CI or a registry |
| Findings and warnings (retry amplification, missing DLQ, budgets, store patterns, …) | computed in the browser from the data above | — | nothing to ingest: they become real when their inputs do |

The code:
- example data lives in `apps/web/src/transit/mock/`, `apps/web/src/transit/flows/exampleFlows.ts`, and `apps/web/src/contracts/examples/`;
- the repository interface is `apps/web/src/transit/repository.ts`;
- the topology repositories are in `apps/web/src/data/`.

**Consequences:**
- **The swap is a repository swap.** An `HttpTransitRepository` replaces `createExampleTransitRepository`, exactly as `?source=api` already swaps the topology repository. Boards, flows, the process view, and contracts do not change: the read-model types are the contract.
- **Findings are rules over the data**, so real inputs give real findings.

## 2. Sources, per kind of data

### A. Traces (OpenTelemetry): routes, per-step stats, retries, replay

| Option | How | Pros | Cons |
|---|---|---|---|
| A1. Query the trace store at read time | Tempo (TraceQL), Jaeger API, or the APIs of Datadog, Elastic APM, Honeycomb, App Insights, X-Ray | no pipeline; replay is trivial | aggregating 24 hours of traces per request is slow and costly; one adapter per vendor |
| **A2. Own aggregation (recommended)** | The OTel Collector exports OTLP to our backend (or we poll the store); a job every few minutes rolls spans up per (service, entry operation, step) into MongoDB; replay fetches raw traces from the store on demand | fast reads; vendor-neutral; shaped exactly like our read model | we build and run an aggregator |
| A3. Collector connectors only | `spanmetrics` and `servicegraph` connectors → Prometheus | almost free RED metrics and service-graph edges | no per-route data: no "step visited by 98%", no retries per step; not enough for the board alone |

### B. Metrics (Prometheus / Mimir / vendor metrics): policy states and pool usage

- **resilience4j:** retry calls by kind, circuit-breaker state and transitions, bulkhead available calls, time-limiter timeouts.
- **Polly:** the equivalent meters.
- **Envoy / Istio:** upstream retries, timeouts, and outlier ejections per cluster.
- **Connection pools** (HikariCP, pgx, Mongo driver): active and maximum connections. This is where "peak 31 / 40" comes from.

These map directly onto `exercised` / `idle` and onto stats such as "fires on 3.1%". Percentiles come from histograms (`histogram_quantile`); p99s are never averaged.

### C. Declared configuration, pushed from CI on each deploy

- **API specs** (OpenAPI, proto, AsyncAPI): endpoints, which are lines, and contracts (ADR-029).
- **Resilience config:** resilience4j YAML, Polly policies, gRPC service config, Istio DestinationRule and VirtualService. Gives timeouts, retries, breakers, bulkheads, and fallbacks per (service, target).
- **Kubernetes CronJobs** and scheduler config: the scheduled lines.

Pushing from CI is preferred over pulling from git: it is versioned per deploy and correct per environment.

### D. Business transactions: flow stats and replay

| Option | How | Fits |
|---|---|---|
| D1. Business key in traces | Put `order.id` (or a hashed key) in OTel baggage and copy it onto spans; join traces by key and span links; map spans to flow steps by (service, entry point) | any flow; needs an instrumentation convention |
| D2. Orchestrator history | Execution history APIs of Temporal, Camunda, or AWS Step Functions | orchestrated flows: exact, no join needed |
| D3. Events | Outbox tables and Kafka or RabbitMQ message headers (correlation ID) | choreographed hand-offs |

### E. Health

Alertmanager alerts, SLO burn rates, Kubernetes readiness, and synthetic checks feed topology health. The simulation stays a separate, labelled mode.

### F. Tables

DB client spans carry `db.collection.name` or `db.sql.table` and `db.operation.name`, so the writes and reads per route become observed. Transaction boundaries stay declared.

### G. Contracts

OpenAPI files (JSON and YAML) uploaded by CI or read from a registry (Apicurio, Backstage API entities, an API gateway), served behind the existing `getOpenApi`.

## 3. Recommended architecture

1. **Freeze the read-model contract first.**
   - Write JSON Schemas for the transit board, flow stats, and business transactions (`docs/schemas/transit-board.v1.schema.json`, `flow-stats.v1`, `flow-transaction.v1`).
   - Contract-test the example repository against them.
   - Every real adapter must produce exactly that.
2. **One backend module, many adapters** (ports and adapters, like the rest of `backend/`):
   - **Ports:** `TraceSource`, `MetricSource`, `SpecSource`, `ConfigSource`, `TransactionSource`, `HealthSource`.
   - **Aggregation:** a job writes precomputed documents per (service, environment, window) to MongoDB (`transitBoards`, `flowStats`). Raw traces stay in the trace store and are fetched for replay.
   - **Endpoints**, from `TRANSIT_BOARD.md`, extended:
     - `GET /services/{id}/transit?environmentId=&window=`;
     - `GET /traces/{traceId}/steps?service=`;
     - `GET /flows/{id}/stats?environmentId=&window=`;
     - `GET /flows/{id}/transactions?window=`;
     - `GET /flows/{id}/transactions/{key}`;
     - `GET /services/{id}/openapi`.
   - **Frontend:** `HttpTransitRepository` behind `?source=api`.
3. **Phases, in value-per-effort order.** Each turns some example fields into observed or declared ones:
   1. **Contract freeze and HTTP repository.** The backend serves the example data first, so the swap is proven end to end.
   2. **Declared data:** specs, resilience config, CronJobs.
   3. **Metrics:** step stats from histograms, and policy states.
   4. **Trace aggregation:** routes, step shares, retries, tables, replay.
   5. **Business transactions:** business key, orchestrator, events.
   6. **Health:** alerts and SLOs into the topology.
4. **Data honesty while mixing.**
   - Every value keeps its provenance: `declared`, `observed`, `inferred`, or example.
   - Each value also shows its **freshness** ("as of 08:45") and its **sample size** ("5,887 traces").
   - A service may show real policies next to example stats during the transition, with each section labelled.
   - Example data disappears per service once its source exists. It remains only behind `?source=example` and in tests.

## 4. How example data is removed and swapped

1. **Add the HTTP repository** and select it like the topology one (`?source=api`, or the deployment default). The example repository stays for demos and tests.
2. **Flip per service and per section.** The backend returns `isExample: false` and a provenance per section. The UI already labels "Example data" versus observed data on both boards and must never call simulated or example data "live" (an existing test enforces this).
3. **Delete example sources** for a service once all of its sections are real (`transit/mock/*`, `exampleFlows.ts`, `contracts/examples/*`). The schema contract tests keep the example fixtures valid for as long as they exist.
4. **Remove the example toggle** from production builds when no service needs it.

## 5. Hard parts to design for

- **Name joining.** `ledger`, `ledger-svc.payments.svc.cluster.local`, and `LedgerClient` are the same thing. This needs an alias table per service, seeded from mesh and catalog names and editable by owners. Transit `entityId` links (ADR-027) resolve through it.
- **Sampling.** Head sampling loses rare branches and errors. Use tail sampling that keeps errors and slow traces, and always show the count behind a statistic.
- **Broken context propagation** across queues and thread pools splits one transaction into several traces. Join with span links; otherwise show "context lost", never a bridged gap.
- **Percentiles do not add up.** Aggregate histograms or t-digests across windows and instances.
- **Cardinality and cost.** Aggregate per operation, never per user or raw URL. Normalise path templates.
- **Personal data.** Business keys and payload examples may be personal. Hash keys, and never store payloads.
- **Freshness and backfill.** Aggregation lag, late spans, and recomputing windows after an outage.
- **Multi-tenancy and access.** Trace stores often hold every team's data, so read scopes must follow the existing auth model (ADR-018).

## 6. Questions to answer before resuming

1. **Trace backend:** Tempo, Jaeger, Datadog, Elastic, Honeycomb, App Insights, X-Ray, or none yet? Is the OpenTelemetry Collector in place, and how is sampling configured?
2. **Metrics:** Prometheus or Mimir, or a vendor? Which resilience stack: resilience4j, Polly, Istio or Envoy, or none?
3. **Specs:** where do OpenAPI, proto, and AsyncAPI files live: service repositories, a schema registry, Backstage, or an API gateway? Can CI push them on deploy?
4. **Flows:** orchestrated (Temporal, Camunda, Step Functions) or choreographed? Is there a business-key attribute or baggage in traces yet?
5. **Health:** where do alerts and SLOs live?
6. **Environments:** is one trace and metric store shared by every environment, or is there one per environment?

Phase 1 (contract freeze and HTTP repository) does not depend on these answers and can start as soon as the product owner says so.

**Partial answer (2026-10-15).** The product owner's observability platform is **Dynatrace** (SaaS, Grail / Smartscape). For the topology (entities, relationships, health, instance metrics), Milestone 15 builds a Dynatrace connector (ADR-034, `docs/DYNATRACE_CONNECTOR.md`). Transit boards, flow statistics, and traces stay on hold here. When they resume, questions 1, 2, and 5 point to Dynatrace spans, metrics, and Davis problems, while 3, 4, and 6 are still open.
