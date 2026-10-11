# OpenAPI Contract Notes

- **One contract for the monorepo:** `docs/api/openapi.json` (OpenAPI 3.1.0, `jsonSchemaDialect` JSON Schema 2020-12). Payload schemas live in `docs/schemas/` and are referenced, not duplicated. Do not create a second `openapi.yaml` under `backend/`.
- Every operation has an `operationId`, an `x-repository` mapping to the frontend interface it backs, and an error response. Every example validates against its schema. These are enforced by `apps/web/src/contract/contract.test.ts` (`npm test`).
- JSON names are camelCase, exactly as in the schemas. Prefer explicit DTOs over serializing persistence records.
- Reuse schema components for IDs, timestamps, health, provider, `EntityRef`, problems, and pagination.
- Each endpoint documents filters, defaults, maximums, sort order, status codes, error codes, and provenance (`isSimulated`, snapshot `source`).
- Examples use the shared fixture IDs (e.g. `payment-service.production`) and are clearly synthetic.
- Change process (`docs/API_CONTRACT.md`): change the schema, `openapi.json`, the TypeScript types, and the Go DTOs together; run the contract tests on both sides; record breaking changes as an ADR and bump the URL version.
- Generated clients/types, if introduced, are reproducible and version-pinned; checked in or generated deterministically in CI.
- Never expose ArcadeDB type names, edge storage details, record IDs, or Go internal types through the API.

## Topology response
`GET /topology` returns plain `TopologyData` v1 (`docs/schemas/topology.v1.schema.json`): `environments`, `serviceDefinitions`, `serviceInstances`, `resources`, `relationships`, optional `eventTypes`. Containment is in `parentResourceId` and `resourceId`. If response metadata is needed (generation time, provenance summary, truncation), add it as a documented, backward-compatible change (headers, or an envelope behind a new media type or endpoint). Never change the v1 payload shape in place.

## Traversal metadata (proposed endpoints)
Traversal endpoints state applied filters, depth, limits, and `truncated`. There is no graph projection, so there is no freshness field. IDs are application IDs only.
