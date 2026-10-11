# OpenAPI Contract Notes

- OpenAPI 3.1 is the authoritative HTTP contract.
- Keep `openapi/openapi.yaml` or an equivalent single canonical contract in source control.
- Request/response schemas use camelCase JSON names matching the frontend conventions.
- Prefer explicit DTOs over serializing persistence models directly.
- Reuse schema components for IDs, timestamps, health, provider, provenance, relationship endpoints, errors and pagination.
- Every endpoint documents filters, defaults, maximums, sort order, response status codes, error codes and provenance behavior.
- Use examples with realistic but clearly synthetic names and IDs.
- Generated clients/types must be reproducible and version-pinned.
- Validate breaking changes in CI. For contract changes, update frontend adapter/types and integration tests together.
- Do not expose ArcadeDB labels, relationship storage details, internal element IDs, or internal Go types as public API by accident.

## Example topology envelope (illustrative)

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-10-11T12:00:00Z",
  "scope": {
    "environmentId": "env-development",
    "truncated": false
  },
  "provenanceSummary": {
    "simulated": true,
    "sources": ["seed-demo"]
  },
  "entities": [],
  "relationships": [],
  "containment": []
}
```

This envelope is a design example, not an implemented or final contract. Finalize exact schema with contract tests before frontend integration.


## Graph query metadata
There is no separate graph projection. For topology/path/impact endpoints, document applied filters, traversal depth, result limits, and query truncation when applicable. Never expose ArcadeDB internal record IDs; use stable application IDs.
