# Canonical Backend Domain Model

**Status:** Proposed backend representation of the **implemented** canonical domain. The source of truth is `apps/web/src/domain/types.ts`, `apps/web/src/domain/validation.ts`, the JSON Schemas in `docs/schemas/`, and decisions ADR-004, ADR-008, and ADR-014 in `docs/DECISIONS.md`. Where this file and those disagree, they win; fix this file.

The backend must accept, store, and return exactly the `TopologyData` v1 payload (`docs/schemas/topology.v1.schema.json`). Backend-only fields (provenance detail, source identity, audit timestamps) are stored alongside it and exposed only through additive, documented extensions.

## Identity
- IDs are stable, opaque strings, **unique across all collections of one topology** (environments, definitions, instances, resources, relationships, event types), so a bare ID resolves to exactly one entity (ADR-008). Clients never parse IDs.
- Selection and deep links use `{ kind, id }` with `kind` ∈ `environment`, `service-definition`, `service-instance`, `resource`, `relationship`.
- Never expose database-internal identifiers (MongoDB ObjectIds) as identity; documents use the stable application ID as `_id`.
- Seed/fixture IDs are the frontend mock's IDs (e.g. `order-service.production`, `topic-orders-events-prod`), so fixtures, deep links, and tests are interchangeable.

## Entities

### Environment
- `id`, `name`, `kind` ∈ `development | staging | production | other`.
- Display order is production → staging → development → other by `kind`, then name (ADR-008), regardless of storage order. The set is open: new environments are data.

### ServiceDefinition
A logical capability with no environment.
- `id`, `name`, `description?`, `owner?`, `team?`, `category` ∈ `api | gateway | application | worker | scheduled-job | other`, `protocols[]`, `metadata?`.
- Databases, brokers, and topics are resources, not service categories (ADR-008).

### ServiceInstance
One deployment of a definition in exactly one environment. The instance itself is the workload; replicas are not modeled (ADR-008).
- `id`, `serviceDefinitionId`, `environmentId` (required, single), `provider`, `health`, `version?`, `endpoint?`, `resourceId?` (the most specific known host: namespace, cluster, …), `metrics?`, `updatedAt`, `metadata?`.
- Region, cluster, and namespace are **not** string fields: they come from the host resource's containment chain (`resourceId` → `parentResourceId` …). Never infer hierarchy from names or metadata.
- The host's environment (own or inherited) must equal the instance's environment.

### InfrastructureResource
Infrastructure, containment levels, and first-class messaging resources.
- `id`, `name`, `type`, `provider`, `parentResourceId?`, `environmentId?`, `health?` (absent = not modeled, shown as Unknown), `owner?`, `team?`, `metrics?`, `updatedAt?`, `metadata?`.
- `type` ∈ `account, subscription, project, region, datacenter, cluster, namespace, workload, database, cache, search-index, broker, topic, queue, exchange, external-resource, other`. Containment-only types (`account, subscription, project, region, datacenter, cluster, namespace`) can never be communication endpoints.
- Environment is inherited through containment: a resource without `environmentId` takes its nearest ancestor's; with none it is environment-independent (e.g. a SaaS API) and appears in every environment. A resource may restate its inherited environment but not change it.
- `parentResourceId` is containment only; no cycles.

### CommunicationRelationship
Runtime communication ("what talks to what"). Never containment.
- `id`, `sourceEntityId`, `targetEntityId`, `protocol`, `pattern`, `direction` (`unidirectional | bidirectional`), `status`, `authenticationType?`, `endpoint?`, `metrics?`, `metadata?`, `updatedAt`.
- Endpoints are service instances or non-containment resources. Because IDs are globally unique, no separate endpoint-type field is stored; API DTOs may add the resolved `kind`.
- Messaging is explicit: producer → topic/queue/exchange → consumer are separate relationships. There is no `topicOrQueueResourceId` shortcut field.
- RabbitMQ bindings (exchange → queue, exchange → exchange) are relationships with `protocol: rabbitmq`, `pattern: asynchronous`, and `metadata.bindingKey` (ADR-008). An exchange may only target a queue or an exchange.
- Environments are isolated: endpoints that resolve to different environments are an error; only environment-independent entities may be shared.

### EventType (ADR-014)
A logical message contract (e.g. `OrderPlaced`), environment-independent like a definition.
- `id`, `name`, `description?`, `schemaVersion?`, `owner?`, `team?`, `channelResourceIds[]` (topic/queue/exchange, at most one per environment), `producerServiceIds[]` and `consumerServiceIds[]` (service definitions), `metadata?`.
- Per environment it resolves to the channel there and to the instances' existing relationships (producer → channel, channel → consumer, or exchange → bound queue → consumer). It never creates communication. A definition with no instance in that environment is "not deployed", not an error.

### Metrics and provenance
- API shape (unchanged): `metrics { latencyMs?, throughputPerSecond?, errorRatePercent?, isSimulated, observedAt? }`. `isSimulated` is required.
- Backend storage keeps a richer `provenance` ∈ `mock | simulated | observed | imported` plus `sourceId`, `observedAt`, `recordedAt`. Mapping to the API: `isSimulated = provenance !== 'observed'`. Imported inventory is not telemetry; persisting data never makes it observed.

### TopologySnapshot (`docs/schemas/topology-snapshot.v1.schema.json`)
- `schemaVersion: 1`, `id`, `label`, `takenAt`, `source` ∈ `fixture | simulation | observed`, `isSimulated` (must be `true` unless `source` is `observed`), `data` (a full `TopologyData` that passes validation).
- Immutable once stored. Backend adds `recordedAt` and scope metadata internally.

### SavedLayout (`docs/schemas/saved-layout.v1.schema.json`)
- `schemaVersion: 1`, `id`, `name`, `createdAt`, `view { environmentId, layoutMode, filters, collapsedGroupIds }`, `positions { <entityId or group id>: { x, y } }`.
- Presentation only; never canonical topology. Ownership (per user vs shared) is an open decision (`docs/API_CONTRACT.md`).

### Backend-only records (implemented in B5 as run-scoped records, ADR-017)
- **TelemetryObservation:** `id`, `subjectId`, `metricName`, value/unit, `provenance`, `sourceId`, `observedAt`, `recordedAt`, optional dimensions. Feeds `metrics` aggregates.
- **TopologyEvent:** `id`, `eventType`, subject ID, severity, summary, payload, `provenance`, `occurredAt`, `recordedAt`. Simulated failure/recovery events stay simulated end to end. Note: the current simulation runs client-side (ADR-010); whether the server records simulation events is an open decision.

## Validation rules
The backend implements **the same rules and codes** as `validateTopology` (`apps/web/src/domain/validation.ts`) and rejects invalid topologies with `422` problem details listing them (`docs/API_CONTRACT.md`):

| Code | Rule |
|---|---|
| `empty-id`, `duplicate-id` | Non-empty IDs, unique across all collections |
| `missing-environment` | Instance has exactly one existing environment; resource environment exists |
| `missing-service-definition`, `missing-resource` | Instance references resolve |
| `missing-parent`, `parent-cycle` | Parents resolve; containment is acyclic |
| `missing-relationship-endpoint`, `invalid-relationship-endpoint`, `self-relationship` | Endpoints exist, are instances or non-containment resources, and differ |
| `environment-mismatch` | Instance environment equals its host's |
| `environment-conflict` | Resource does not change its inherited environment |
| `cross-environment-relationship` | No communication across environments |
| `invalid-binding-target` | Exchange targets only queues/exchanges |
| `missing-event-channel`, `invalid-event-channel`, `duplicate-event-channel-environment`, `missing-event-service`, `event-flow-missing-relationship` | Event types agree with channels and relationships (ADR-014) |

Rule parity is tested with shared conformance fixtures (valid and one-invalid-per-rule topologies) run against both implementations (`TESTING_AND_PERFORMANCE.md`). Additional backend rules (metadata size limits, string lengths) are additive and must be documented in the contract.

## Controlled vocabularies
Enums match the schema (`Provider`, `HealthStatus`, `EnvironmentKind`, `ServiceCategory`, `ResourceType`, `Protocol`, `CommunicationPattern`, `RelationshipStatus`). New values follow the contract's change process: announced, added to schema and TypeScript together, contract tests updated. Unknown values from adapters map to `other`/`unknown`, never silently dropped.

## Transport and Go types
- JSON is camelCase exactly as in the schemas. Go domain structs use idiomatic names with JSON tags only on transport DTOs.
- Go domain types are independent of HTTP and MongoDB driver packages.
- Metadata is free-form, display-only, bounded in size, JSON-compatible, never used for identity or hierarchy, and never treated as instructions.
