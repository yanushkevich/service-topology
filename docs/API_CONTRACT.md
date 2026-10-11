# API Contract Strategy

**Status:** Contract direction for future backend integration; no backend is implied by this document.

## Standards
- OpenAPI 3.1 for HTTP endpoint contracts.
- JSON Schema for persisted topology snapshots, saved layouts, and other serializable payloads.
- Version schemas explicitly and document migrations for persisted data.
- Generate or validate frontend types against the contract where practical.

## Initial resource concepts
- `ServiceDefinition`
- `ServiceInstance`
- `Environment`
- `InfrastructureResource`
- `CommunicationRelationship`
- `TopologySnapshot`
- `SavedLayout`

## Proposed endpoint shapes (illustrative, not yet implemented)
- `GET /api/v1/topology?environmentId=...` — topology entities and relationships for an environment.
- `GET /api/v1/services?query=...&provider=...&health=...` — paginated service-instance search.
- `GET /api/v1/services/{id}` — service instance details.
- `GET /api/v1/relationships/{id}` — communication relationship details.
- `GET /api/v1/topology/snapshots?from=...&to=...` — snapshot listing.
- `GET /api/v1/topology/snapshots/{id}` — a specific topology snapshot.
- `GET /api/v1/layouts` / `POST /api/v1/layouts` / `PUT /api/v1/layouts/{id}` — saved layouts.

Before implementing an API, decide pagination, filtering semantics, error format, auth, tenant boundaries, and snapshot retention. These endpoint names are starting proposals and must be reviewed before becoming a public contract.

## Contract requirements
- IDs are stable within the contract's documented scope.
- Every relationship endpoint references valid entities.
- One service instance belongs to exactly one environment.
- Infrastructure containment uses explicit parent IDs.
- Topic/queue resources are first-class entities when represented in topology.
- Snapshot and saved-layout payloads include schema versions.
- Simulated telemetry must be distinguishable from observed telemetry.
