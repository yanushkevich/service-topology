# REST API Specification

**Status:** The HTTP contract is `docs/api/openapi.json` (OpenAPI 3.1, JSON Schema 2020-12), explained in `docs/API_CONTRACT.md` and enforced by `apps/web/src/contract/contract.test.ts`. This file does not define a second contract. It lists how the Go backend implements that contract and which **proposed additions** may be added to it. An addition is implementable only after it is in `openapi.json` with examples and contract tests.

## General rules (from the contract)
- Base path `/api/v1`. JSON, UTF-8, UTC RFC 3339 timestamps.
- Stable opaque string IDs; clients never parse them.
- Pagination: cursor-based (`cursor`, `limit` ≤ 500, response `nextCursor`, `null` at the end). Cursors are opaque.
- Filtering: AND across parameters, OR within a list parameter (`provider=aws,gcp`). Search parameter is `q`: whitespace-separated terms, all must match, case-insensitive, over name, ID, owner, and team (identical to the client's `matchesFilters`).
- Errors: `application/problem+json` per RFC 9457 (`type`, `title`, `status`, `detail`, `instance`). Validation failures add `errors: [{ code, entityId?, message }]` using `validateTopology` / `parseSavedLayout` codes. The backend adds the extension member `requestId` (allowed by RFC 9457; add it to the `Problem` schema first). Never leak query text, stack traces, credentials, or internal paths.
- Status codes: `400` invalid query/body, `401/403` once auth exists, `404` not found, `409` conflict, `412` failed `If-Match`, `413` payload too large, `422` topology/layout fails validation, `429` rate limited, `500` unexpected, `503` database unavailable.
- Versioning: URL major version; additive changes stay in v1; removals or meaning changes need v2, an ADR, and a migration note in `docs/API_CONTRACT.md`.

## Contract v1 endpoints (implemented in B3)

| Endpoint | Purpose | Frontend interface it backs |
|---|---|---|
| `GET /environments` | Environment selector | `TopologyRepository.getTopology` → `environments` |
| `GET /topology?environmentId=` | Canonical `TopologyData` (optionally one environment), including event types | `TopologyRepository.getTopology` |
| `GET /registry?environmentId=&q=&provider=&health=&kind=&sort=&cursor=&limit=` | Paginated registry search | client-side today; `RegistryRepository.search` |
| `GET /entities/{kind}/{id}` | One entity | `TopologyIndex` lookup today |
| `GET /topology/snapshots?from=&to=` | History list | `SnapshotRepository.list` |
| `GET /topology/snapshots/{id}` | One snapshot | `SnapshotRepository.get` |
| `POST /topology/snapshots` | Store a snapshot (e.g. a simulation capture) | `SnapshotRepository.save` |
| `GET /layouts`, `POST /layouts` | Saved layouts | `SavedLayoutRepository.list` / `.save` |
| `PUT /layouts/{id}`, `DELETE /layouts/{id}` | Replace / delete (concurrency via `ETag`/`If-Match` is an open decision) | `SavedLayoutRepository.save` / `.remove` |

Each operation names its frontend interface in `x-repository`. The frontend switches from mock to HTTP by implementing those interfaces (`apps/web/src/data/selectRepository.ts`); no UI code changes.

`GET /topology` returns plain `TopologyData` v1. Response metadata that is not part of `TopologyData` (generation time, provenance summary, truncation) goes in headers or a documented envelope added as v1-compatible change, never by changing the payload shape. Proposed: the full topology is bounded by environment; a response over the configured maximum returns a documented error rather than a silently truncated graph (add the limit and error to the contract).

## Proposed additions (add to `openapi.json` before implementing)

### Operations (outside `/api/v1`)
- `GET /healthz`: process liveness, no database dependency.
- `GET /readyz`: ArcadeDB connectivity and schema initialized; no connection details in the body.
- `GET /api/v1/meta`: API version, schema versions, feature flags (e.g. event types, server simulation).

### Environments and entities
- `GET /environments/{environmentId}`.

### Traversal (bounded; mirrors the client rules in `apps/web/src/domain/traversal.ts`)
- `GET /topology/neighborhood?entityId=&depth=1..3&environmentId=`: undirected neighborhood, as the URL `nh` parameter (depth 1–3).
- `GET /topology/dependencies?entityId=&direction=upstream|downstream&maxDepth=&limit=`: transitive dependencies with hop count, path, and relationship per hop (as `dependencyTree`). `maxDepth` default 10, `limit` default 500; responses state `truncated`.
- `GET /topology/impact?entityId=&mode=unavailable|degraded`: read-only propagation preview using the rules in `apps/web/src/domain/propagation.ts` (same rule IDs). Only if server-side analysis is needed; the client computes it today.

### Event catalog (ADR-014)
- `GET /event-types?environmentId=&q=&cursor=&limit=`: event types present in the environment with channel and counts.
- `GET /event-types/{id}?environmentId=`: resolved flow (channel, producers, consumers with instance IDs, relationship IDs, `viaQueueId`, not-deployed definitions).

### Telemetry and events (Milestone B5)
- `GET /telemetry?entityId=&metricName=&provenance=&from=&to=&limit=&cursor=`
- `GET /events?environmentId=&entityId=&provenance=&from=&to=&limit=&cursor=`
- No real-time stream semantics; SSE/WebSocket only with a concrete UI requirement and operational design. The UI never says "live".

### Simulation (open decision)
The simulation engine is pure TypeScript and runs in the browser (ADR-010); captures are stored through `POST /topology/snapshots` with `source: simulation`. Server-side simulation (`POST /simulations`, actions, events) is an open decision in `docs/API_CONTRACT.md`. Decide isolation (per session, per user, global) by ADR before implementing; never mutate shared persisted topology from a simulation.

### Not added
`/services`, `/service-definitions/{id}`, `/relationships/{id}`, `/resources` from the v4 pack duplicate `/registry` and `/entities/{kind}/{id}`. Do not add them unless a concrete client need is shown.

## DTO expectations
- Payloads are the schema types (`docs/schemas/*.json`); do not serialize persistence records.
- Containment is `parentResourceId` (resources) and `resourceId` (instance host). There is no separate containment collection.
- Every `metrics` object carries `isSimulated`. Snapshots carry `source` and `isSimulated`.

## Contract acceptance
- `openapi.json` validates (contract tests, `npm test`); the Go server is tested against the same document (`TESTING_AND_PERFORMANCE.md`).
- Examples cover healthy, degraded, unknown, simulated, empty, filtered, paginated, truncated, and leaf cases.
- Contract tests verify status codes, problem shape, stable IDs, and relationship integrity.

## Persistence boundary
All endpoints read/write ArcadeDB through repository interfaces. There is no separate graph projection or projection-freshness field. Never expose ArcadeDB record IDs.
