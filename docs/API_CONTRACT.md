# API Contract

**Status:** Contract v1 (Milestone 5), implemented by the Go + ArcadeDB backend in `backend/` since Milestone B3 (`docs/backend/`, ADR-015). The frontend still runs on in-memory repositories until its HTTP adapters land (B6). Conformance is checked by `make contract-check` in `backend/`, which validates every operation against `openapi.json`. The app runs on in-memory mock repositories that already implement the interfaces this contract maps to. The contract is machine-readable and tested; the prose here explains it.

| Artifact | What it is |
|---|---|
| `docs/api/openapi.json` | OpenAPI **3.1.0** document (`jsonSchemaDialect` = JSON Schema 2020-12) |
| `docs/schemas/topology.v1.schema.json` | `TopologyData` v1: environments, definitions, instances, resources, relationships, optional event types |
| `docs/schemas/topology-snapshot.v1.schema.json` | `TopologySnapshot` v1 (wraps `TopologyData`) |
| `docs/schemas/saved-layout.v1.schema.json` | `SavedLayout` v1 |
| `docs/schemas/topology-url-state.v1.md` | Query-parameter contract for shareable links (not an HTTP API) |
| `apps/web/src/contract/contract.test.ts` | Contract tests (see "How the contract is enforced") |

## Standards
- **OpenAPI 3.1** for HTTP endpoints; **JSON Schema 2020-12** for every payload. OpenAPI references the published schemas instead of duplicating them, so each payload has one source of truth.
- **Errors:** `application/problem+json` per **RFC 9457** (`type`, `title`, `status`, `detail`, `instance`). Validation failures add an `errors` array of `{ code, entityId?, message }`, using the same codes as `validateTopology` and `parseSavedLayout`.
- **Versioning:** URL major version (`/api/v1`). Payloads that are persisted or shared (snapshots, saved layouts) also carry `schemaVersion`. Additive changes (new optional fields, new enum values announced in advance) stay within v1. Removals or meaning changes need v2 and a migration note in this file.
- **Pagination:** cursor-based (`cursor`, `limit` ≤ 500, response `nextCursor`, `null` at the end). Cursors are opaque.
- **Filtering semantics:** AND across parameters, OR within a list parameter (`provider=aws,gcp`). Search terms are whitespace-separated, all must match, case-insensitive, over name, ID, owner, and team. This is identical to the client-side `matchesFilters`.

## Backend behaviour (Milestone B3)
- **`GET /topology?environmentId=`** returns a projection that itself passes validation: the environment record; all service definitions; instances in the environment; resources in it (own or inherited) plus environment-independent ones; relationships between kept entities; event types carried in the environment with channels narrowed to kept ones. Unknown environment: 404.
- **Registry** rows, filters, and order are identical to the client's `buildRegistryRows` / `filterRegistryRows` / `sortRegistryRows`, including `localeCompare('en')` collation (shared conformance fixtures). `environmentId` is required (400 if missing, 404 if unknown). Cursors are opaque, bound to the query (400 otherwise), and offset-based: rows may shift if the topology changes between pages.
- **Errors:** 400 `invalid-parameter` (bad parameter or malformed body), 404, 405 (with `Allow`), 409 (duplicate snapshot or layout ID), 413 (body over 16 MB for snapshots, 1 MB for layouts), 415 (non-JSON body), 422 (validation: topology codes, `invalid-snapshot`, `invalid-layout`), 503 (database unavailable). Every error is `application/problem+json` with the `requestId` extension.
- **Snapshots** are immutable: `POST` with an existing ID is 409, never an overwrite. Lists are ordered by `takenAt` instant.
- **Layouts:** `POST` creates (409 if the ID exists); `PUT` replaces an existing layout (404 if missing; the body ID must equal the path ID, else 422). Concurrency control (`ETag`/`If-Match`) remains an open decision.

## Identity and semantics
- **IDs** are stable, opaque strings, unique across all collections of one topology (an instance and a resource never share an ID). Clients never parse IDs. Selection and deep links use `{ kind, id }`.
- **Environments:** each service instance has exactly one `environmentId`. A resource without one inherits its nearest ancestor's environment; with none it is environment-independent (e.g. SaaS) and appears in every environment.
- **Containment vs communication:** hierarchy is only `parentResourceId` (no cycles). Communication is only `CommunicationRelationship`. Neither is inferred from names or metadata.
- **Messaging:** Kafka topics and RabbitMQ queues/exchanges are resources; producer → channel → consumer are explicit relationships. Exchange → queue bindings are relationships with `metadata.bindingKey`.
- **Event types (added within v1, Milestone 7, ADR-014):** optional `eventTypes`, each a logical contract (`OrderPlaced`) with `channelResourceIds` (topic/queue/exchange, at most one per environment) and `producerServiceIds` / `consumerServiceIds` (service definitions). Per environment they resolve to instances and existing relationships (producer → channel, channel → consumer, or exchange → bound queue → consumer); they never add communication. Clients that ignore the field are unaffected.
- **Integrity beyond JSON Schema:** servers must reject topologies that fail `validateTopology` (missing references, parent cycles, environment conflicts, cross-environment relationships, invalid binding targets, event types inconsistent with relationships), returning 422 with problem details.
- **Simulated vs observed:** every `metrics` object carries `isSimulated`. Snapshots carry `source` (`fixture` | `simulation` | `observed`) and `isSimulated`, which must be `true` unless the source is `observed`. Clients label simulated data and never describe it as live.

## Endpoints and the frontend interfaces they back

| Endpoint | Purpose | Frontend interface today |
|---|---|---|
| `GET /environments` | Environment selector | `TopologyRepository.getTopology` → `environments` |
| `GET /topology?environmentId=` | Canonical topology (optionally one environment), including event types | `TopologyRepository.getTopology(signal)` |
| `GET /registry?environmentId=&q=&provider=&health=&kind=&sort=&cursor=&limit=` | Paginated registry search | Computed client-side (`buildRegistryRows`, `filterRegistryRows`, `sortRegistryRows`); proposed `RegistryRepository.search` |
| `GET /entities/{kind}/{id}` | One entity (deep links, inspector) | Resolved from `TopologyIndex`; proposed |
| `GET /topology/snapshots?from=&to=` | History list | `SnapshotRepository.list()` |
| `GET /topology/snapshots/{id}` | One snapshot ("as of") | `SnapshotRepository.get(id)` |
| `POST /topology/snapshots` | Store a snapshot (e.g. simulation capture) | `SnapshotRepository.save(snapshot)` |
| `GET /layouts` / `POST /layouts` | Saved layouts | `SavedLayoutRepository.list()` / `.save()` |
| `PUT /layouts/{id}` / `DELETE /layouts/{id}` | Replace / delete a layout | `SavedLayoutRepository.save()` / `.remove()` |
| `GET /topology/dependencies`, `GET /topology/neighborhood` | Bounded traversal (B4) | `traversal.ts` `dependencyTree` / `neighborhood` (identical results) |
| `GET /topology/impact`, `GET /propagation-rules` | Read-only failure impact and the rules (B4) | `propagation.ts` |
| `GET /event-types`, `GET /event-types/{id}` | Event catalog (B4, ADR-014) | `eventFlow.ts` |
| `POST /simulations`, `GET /simulations[/{id}]`, `GET /events`, `GET /telemetry` | Isolated simulation runs with stored events and watched telemetry (B5, ADR-017) | `simulation/engine.ts` (identical results) |
| `GET /topology/snapshots/{id}/diff` | Compare a snapshot with another or with the current topology (B5) | `snapshot.ts` `diffTopology` |

Each operation in `openapi.json` names its interface in `x-repository`. An HTTP adapter implements the existing interfaces (`apps/web/src/data/repositories/TopologyRepository.ts`, `apps/web/src/data/snapshots/SnapshotRepository.ts`, `apps/web/src/data/savedLayouts/SavedLayoutRepository.ts`), so UI code does not change.

## Example payloads

Registry page (`GET /registry?environmentId=production&q=payment`):
```json
{
  "items": [
    {
      "ref": { "kind": "service-instance", "id": "payment-service.production" },
      "name": "Payment Service", "type": "api", "group": "service", "provider": "azure",
      "environmentId": "production", "owner": "Payments", "team": "Payments", "health": "healthy",
      "outgoingCount": 4, "incomingCount": 1, "updatedAt": "2026-10-11T08:00:00Z"
    }
  ],
  "nextCursor": null
}
```

Snapshot summary (`GET /topology/snapshots`):
```json
{ "items": [{ "id": "fixture-0600", "label": "Before incident", "takenAt": "2026-10-11T06:00:00Z", "source": "fixture", "isSimulated": true }] }
```

Error (`GET /entities/service-instance/ghost`):
```json
{ "type": "https://topology.example.test/problems/not-found", "title": "Entity not found", "status": 404, "detail": "No service-instance with ID \"ghost\"." }
```

Full topology, snapshot, and layout examples: `apps/web/src/data/mock/topology.ts`, `apps/web/src/data/mock/snapshots.ts`, and the `createLayout` example in `openapi.json`. All are validated by the contract tests.

## How the contract is enforced
`apps/web/src/contract/contract.test.ts` (runs with `npm test`):
- The mock inventory, both generated scale datasets, every snapshot fixture, and a frontend-generated registry page validate against the schemas (ajv, draft 2020-12, formats on).
- Invalid payloads (unknown enum, unknown field, missing `isSimulated`, fixture claiming to be observed) are rejected.
- Schema enums equal the TypeScript constants (`PROVIDERS`, `RESOURCE_TYPES`, …), so code and contract cannot drift silently.
- The OpenAPI document is 3.1, every `$ref` resolves, every operation has an `operationId`, an `x-repository` mapping, and an error response, and every example validates against its schema.

## Open decisions (required before implementation or publication)
- **Authentication and authorization:** method (OIDC/OAuth2 assumed), scopes for read vs. write (snapshots, layouts).
- **Tenancy:** tenant boundary (organization, account?) and how IDs are scoped.
- **Retention and history:** snapshot retention, event sourcing vs. periodic snapshots, `from`/`to` limits.
- **Saved-layout ownership:** per user or shared, and conflict handling (ETags / `If-Match` on `PUT`).
- **Rate limits and caching:** `ETag` on `/topology`, incremental sync or change feed for large inventories.
- **Observed telemetry:** source systems, freshness guarantees, and how `observedAt` and `isSimulated: false` are populated.
- ~~**Server-side simulation**~~: decided in ADR-017 (isolated, deterministic, bounded runs; `POST /simulations`).
- **Snapshot retention:** snapshots are kept until deleted; there is no delete endpoint yet.

## Change process
Change the schema and `openapi.json` together with the TypeScript types. Run `npm test` (contract tests fail on drift). Record breaking changes as an ADR in `DECISIONS.md` and bump the version as described above.
