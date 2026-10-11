# Canonical Backend Domain Model

**Status:** Proposed backend representation of the Revision 4 product domain.

## Entities

### Environment
- `id`, `name`, `key`, `description`, `created_at`, `updated_at`.
- Seed keys include `development`, `staging`, `production`; do not assume the set is closed forever.

### ServiceDefinition
A logical service identity independent of any deployment.
- `id`, `name`, `description`, `category`, `owner`, `team`, `created_at`, `updated_at`.
- Stable identity across versions/environments; do not duplicate the definition merely because it has multiple deployments.

### ServiceInstance
A deployment/runtime instance of a logical service.
- `id`, `definition_id`, `environment_id`, `name`, `version`, `provider`, `health`, `endpoint` (optional/sensitive), `external_resource_id`, `region`, `cluster`, `namespace`, `protocols`, `metadata`, `created_at`, `updated_at`.
- Exactly one environment. A service may have many instances.

### InfrastructureResource
- `id`, `kind`, `name`, `provider`, `environment_id` (nullable only if product rules explicitly allow shared/global scope), `parent_resource_id` (nullable), `external_resource_id`, `region`, `cluster`, `namespace`, `health`, `metadata`, timestamps.
- `kind` includes cluster, namespace, deployment, container/workload, database, message broker, Kafka topic, RabbitMQ queue/exchange and other resource categories as needed.
- Parent-child is containment only. Validate no cycles.

### CommunicationRelationship
- `id`, `source_entity_type`, `source_entity_id`, `target_entity_type`, `target_entity_id`, `protocol`, `pattern`, `direction`, `status`, `authentication_type`, `endpoint`, `topic_or_queue_resource_id` (optional), `metadata`, timestamps.
- Use explicit endpoint entity types so services, instances, and messaging resources can participate. Validate endpoint references. If polymorphic references weaken referential integrity in the chosen database design, use typed association tables or a single canonical entity table rather than accepting dangling IDs.

### TelemetryObservation
- `id`, `subject_type`, `subject_id`, `metric_name`, numeric value and unit, `provenance` (`simulated`, `observed`, `imported`), `source_id`, `observed_at`, `recorded_at`, optional dimensions.
- Do not overload a metric with an ambiguous boolean if richer provenance is required. API compatibility can expose `isSimulated` derived from provenance.

### TopologyEvent
- `id`, `event_type`, subject/reference, severity, summary, payload, provenance, `occurred_at`, `recorded_at`.
- Simulated failure/recovery events remain marked simulated end-to-end.

### TopologySnapshot
- `id`, `schema_version`, `environment_id` or explicit scope, `captured_at`, `provenance`, immutable normalized topology payload or normalized snapshot rows.
- Store schema version and timestamps. Never mutate an existing snapshot in place.

### SavedLayout
- `id`, `name`, `description`, `scope`, optional environment, schema version, layout payload, owner/user key if authorization is introduced, timestamps.
- Layout is presentation preference, not canonical domain topology. It may store node positions/group collapse/viewport, but not duplicate authoritative entity details.

## Relationship types
Use a controlled vocabulary for protocol, communication pattern, status, provenance, health and resource kind, but support unknown/future values. Initial patterns: synchronous, asynchronous, streaming, scheduled, database, unknown. Health: healthy, degraded, unavailable, unknown. Connection status: active, degraded, inactive, unknown.

## Validation rules
1. All IDs unique within their entity collection and stable across reads.
2. Foreign keys/references resolve; no dangling relationships.
3. Instance definition/environment references resolve.
4. Infrastructure parents resolve and graph is acyclic.
5. No cross-environment communication unless explicitly represented and allowed by policy; if allowed, both endpoint environments remain visible.
6. `observed_at` describes source observation time; `recorded_at` describes backend ingestion time.
7. Simulated observations/events are never relabeled observed.
8. Snapshot payload schema versions are explicit; document-version upgrades and index setup are tested.
9. Metadata is bounded in size, JSON-compatible, and not treated as trusted instructions.

## UI mapping compatibility
The UI needs provider, environment, health, owner/team, version, category, protocols, region/cluster/namespace, relationships, metrics, and event context. API DTOs may use camelCase to fit existing frontend conventions while Go domain fields use idiomatic exported names and JSON tags only at transport boundaries.


## Persistence mapping note
These are domain concepts, not a database schema. ArcadeDB persists resources as nodes and domain connections as directed relationships, with stable common fields and versioned extensible metadata. Do not let the database representation define domain invariants. Keep Go domain types and API DTOs independent from ArcadeDB driver records.
