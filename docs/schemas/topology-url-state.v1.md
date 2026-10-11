# TopologyUrlState v1 — query parameters

Shareable view state for `/map`, `/registry`, and other sections. Implemented in `apps/web/src/state/urlState.ts` (codec) and `apps/web/src/state/useUrlStateSync.ts` (history sync).

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
| `scope` | 3D explore path, outermost first; repeated (`scope=a&scope=b`); added in Milestone 4, optional | entity IDs | overview |
| `asof` | Browse a snapshot (read-only history); added in Milestone 3, optional | snapshot ID | current state |
| `source` | Startup parameter (not view state): `api` loads data from the backend (`/api/v1`) instead of the in-browser mock; kept in the URL so reloads stay on the same source (Milestone B6) | `api` | in-browser mock |
| `dataset` | Startup parameter (not view state): generated fixture to load; kept in the URL | `scale-250`, `inventory-1000` | hand-written mock |
| `ev` | Event-flow highlight on the map (ADR-014); a selection takes precedence; added in Milestone 7, optional | event type ID | none |

Rules:
- Encoding is canonical (lists sorted, defaults omitted), so equal state gives an identical URL.
- A missing `v` means "no state in the URL"; the app writes the current state. An unsupported `v` is ignored entirely.
- Invalid values are dropped individually and logged; decoding never throws.
- Unknown entity IDs are kept; the inspector shows "Selection not found". An unknown `ev` is kept and the map chip says so.
- The event catalog's selected event is the route (`/events/<eventTypeId>`), not a query parameter.
- An unknown environment falls back to the first environment.
- Back/forward restore state. Discrete changes push history entries; typing a search replaces the current entry.
- Do not put secrets in the URL. Search text is the only free-form value.
