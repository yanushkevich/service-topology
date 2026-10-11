# TopologyUrlState v1 — query parameters

Shareable view state for `/map`, `/registry`, and other sections. Implemented in `src/state/urlState.ts` (codec) and `src/state/useUrlStateSync.ts` (history sync).

| Param | Meaning | Values | Default (omitted) |
|---|---|---|---|
| `v` | Schema version (required) | `1` | always present |
| `env` | Environment ID | canonical environment ID | always present |
| `view` | Active view | `2d`, `3d` | `2d` |
| `layout` | 2D layout mode | `topology`, `infrastructure` | `topology` |
| `sel` | Selected entity | `<kind>:<id>`; kind ∈ `environment`, `service-definition`, `service-instance`, `resource`, `relationship` | none |
| `q` | Search text | free text | empty |
| `provider` | Provider filter | comma list of `aws,azure,gcp,on-prem,saas,internal,unknown` | none |
| `health` | Health filter | comma list of `healthy,degraded,unavailable,unknown` | none |
| `kind` | Entity-group filter | comma list of `service,data,messaging,external,other` | none |
| `hl` | Dependency highlight | `direct`, `upstream`, `downstream` | `direct` |
| `nh` | Neighborhood | `<entityId>~<depth>`, depth 1–3 | none |

Rules:
- Encoding is canonical (lists sorted, defaults omitted), so equal state gives an identical URL.
- A missing `v` means "no state in the URL"; the app writes the current state. An unsupported `v` is ignored entirely.
- Invalid values are dropped individually and logged; decoding never throws.
- Unknown entity IDs are kept; the inspector shows "Selection not found". An unknown environment falls back to the first environment.
- Back/forward restore state. Discrete changes push history entries; typing a search replaces the current entry.
- Do not put secrets in the URL. Search text is the only free-form value.
