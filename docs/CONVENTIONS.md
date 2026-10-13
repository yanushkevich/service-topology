# Engineering Conventions

The rules for writing code in this repository, frontend (`apps/web`) and backend (`backend/`).
Read this before adding a file, a component, a style, or an endpoint. The product rules (what
to build) live in `PRODUCT_SPEC.md` and `DECISIONS.md`; this document covers how to build it.

**Precedence.** An explicit instruction for the current task wins, then ADRs in `DECISIONS.md`,
then this document. If a rule here gets in the way of a good change, change the rule in the same
commit and say why. Do not quietly work around it.

**Enforced rules** are marked *(enforced: test name)*. The test fails on a violation, so the
rule cannot drift. Everything else is a review rule.

---

## 1. Principles

1. **Reuse before you write.** Search §3.3 and §4.3 for an existing component, helper, or route
   pattern first. Before you write a third copy of something, extract it.
2. **One owner per fact.** Colours live in `tokens.css`. Enumerations live in the schema and its
   mirrors. Validation lives in `validation.ts` and is ported to `validation.go`. URL parameters
   live in `urlState.ts`. Do not keep a second copy "for convenience". Copies drift: a copied
   per-kind ID switch once returned an empty `Location` header for business flows.
3. **Readable over clever.** Code should read from top to bottom: named stages, early returns,
   one level of abstraction per function. See §2.
4. **Honest data.** Mock, simulated, imported, and observed data are always labelled as what
   they are. Nothing simulated is ever called "live".
5. **Small, verified steps.** Run the focused tests, then the full checks. Never claim a check
   passed without running it.

## 2. Readable code (both stacks)

| Rule | Guidance |
|---|---|
| Functions do one thing | Aim for under about 60 lines. When a function has stages, give each stage its own function and let the parent read as the list of stages. Examples: `RunSimulation` (check → replay → summarize → snapshot → save) and the BPMN `processReader` (boundaries → steps → outcomes → transitions → start). |
| Files have one subject | Aim for under about 300 lines for a component file and about 400 for a module. Split by subject, not by size: the inspector is one file per entity kind (`InstanceDetails`, `ResourceDetails`, …) plus shared parts (`InspectorParts`); the HTTP API is one file per area (`routes_*.go`). |
| Name things by role | Name a value for what it is in this domain (`startStepId`, `deadlineMs`, `revision`), not for its type (`data`, `obj`, `tmp`). Booleans read as questions (`isStep`, `isOutcome`, `reduced`). |
| Early returns | Handle the error, empty, and missing cases first, then write the main path without nesting. |
| No nested ternaries | Allow at most one `?:` in an expression. Otherwise use a small function, a lookup table (`Record<Kind, …>`), or a `switch`. |
| Lookup tables over chains | Map per-kind labels, colours, and icons with a typed `Record` (`EDGE_KIND_LABELS`, `taskKinds`). TypeScript then checks the table is exhaustive. |
| Comments explain *why* | Doc-comment every exported function, component, and type in one sentence about its role. Comment in the body only for a non-obvious reason: a spec rule, an ADR, or a browser or driver quirk. Do not narrate the code. |
| Mirror, don't restructure, paired ports | `validation.ts` ↔ `validation.go` and the traversal and registry ports keep the same section order and names, so a reviewer can diff them side by side. Split them only together. |
| No dead code | Delete unused helpers, exports, and branches in the change that orphans them. Do not comment code out. |

## 3. Frontend (`apps/web`)

### 3.1 Layers

```
app/, layouts/                     routes, shell, navigation
features/<feature>/                pages, panels, feature hooks, view adapters
state/   data/   shared/           Zustand stores + URL sync · repositories · UI kit, hooks, format
transit/   simulation/             pure read models, layouts, engines
domain/                            canonical types, validation, traversal (pure TypeScript)
```

- Dependencies point down. A lower layer never imports a feature, a layout, or the app
  *(enforced: `src/test/layers.test.ts`)*.
- `domain/` imports only its own modules *(enforced: `src/domain/boundaries.test.ts`)*.
  `transit/` imports only domain types and its own modules *(enforced:
  `src/transit/boundaries.test.ts`)*. `simulation/` is pure and never runs in renderers
  *(enforced: `src/simulation/boundaries.test.ts`, `src/test/frameLoop.test.ts`)*.
- A feature may import another feature's public component when it composes it. For example, the
  inspector uses `editing/EditingControls`. When two features need the same building block, move
  it down into `shared/`, or into `features/boards/` for the transit and flow boards.
- React Flow nodes and Three.js objects are view models built by adapters in the feature. Domain
  types never extend them, and Three.js objects never enter Zustand.

### 3.2 Where new code goes

| You are adding… | Put it in |
|---|---|
| A canonical type, rule, or graph query | `domain/` (port the rule to `backend/internal/domain` too, §4.5) |
| A read model or layout for a board | `transit/` (pure, with tests next to it) |
| A data source or adapter | `data/` behind the repository interfaces (`data/repositories`) |
| Cross-view UI state (selection, environment, filters, view) | `state/uiStore.ts`, mirrored in the URL by `urlState.ts` |
| Page-local URL parameters | `PAGE_PARAMS` in `state/useUrlStateSync.ts` |
| A button, field, heading, or panel style used in 2+ places | `shared/ui/` (§3.3) |
| A piece shared by the transit and flow boards | `features/boards/` |
| A generic hook (media query, keyboard) | `shared/hooks/`, `shared/keyboard.ts` |
| Formatting (durations, numbers, labels) | `shared/format.ts`, `shared/mappings.ts` |
| A new colour | `styles/tokens.css`, both themes (§3.4) |
| A page | `features/<feature>/…Page.tsx`, a route in `app/routes.tsx`, and a case in `test/a11y.test.tsx` |

### 3.3 Reusable components (use these first)

**`shared/ui/primitives.tsx`**

| Component | Use for |
|---|---|
| `Button` (`variant`: primary, secondary, danger, ghost, icon) | Every button. For a link styled as a button, use `buttonClass(variant)` |
| `Chip` (`pressed`) | Filter toggles |
| `Segmented` + `Segment` (`pressed`) | Mode switches (2D/3D, typical/replay, label density) |
| `Panel` | Floating panels over a canvas |
| `Kicker` (`as`, `count`, `mono`, `id`) | Small uppercase section headings, with an optional count on the right. Use `as="span"` for a label that is not a heading |
| `KeyValueRow` | One label/value row of a `<dl>` (stats, settings, budgets) |
| `SearchField` | Search box with a hidden label (lists, indexes) |

**`shared/ui/form.tsx`** is the only form field system: `TextInput`, `NumberInput`, `SelectInput`
(`empty` for an optional "none"), `TextAreaInput`, `CheckboxGroup`, and `FormField` for a custom
control (a render prop that receives `id`, `aria-*`, `data-path`, and `data-autofocus`). Every
field gets a visible label, `(required)`, a hint, and an error, all wired to ARIA. Use `compact`
in dense nested forms. Never hand-roll `<label>` + `<input>`.

**Other shared UI:**
- `Modal`: dialogs with a focus trap and Escape handling.
- `LoadState`: loading, empty, and error states.
- `DataSourceTag` / `SimulatedTag`: provenance labels.
- `StatusShape`: health shown as a shape, not colour only.
- `TypeGlyph` and `Icon`.

**`shared/ui/classes.ts`**:
- `cx(...)` joins class names.
- Class helpers: `buttonClass`, `segmentClass`, `fieldClass`, `kickerClass`, `floatClass`,
  `cardClass`, `boardPanelClass`.

**Section pages** (`features/pages/PageShell.tsx`): `PageShell`, `Card`, `Note`.

**Boards** (`features/boards/`):
- `BoardFrame`, `BoardHeader`, `BoardGrid`, `BoardSkeleton`: layout, responsive at `max-md`.
- Playback store and clock: `createPlayback`, `usePlaybackClock`, `playbackActions`,
  `useReplayUrlTime`.
- `PlaybackControls`, `WindowSelect`.
- SVG parts: `GlowFilter`, `RibbonLine`, `SelectedLine`, `StationLabel`, `MapGround`,
  `MapTooltip`, `MapChooser`.

### 3.4 Styling: Tailwind v4 and tokens (ADR-013)

- **Colours come only from tokens.** Every value lives in `styles/tokens.css`, in both the dark
  and light blocks, and is exposed as utilities through `@theme inline` in `styles/global.css`.
- Components use token utilities (`bg-surface-1`, `text-fg-2`, `border-line`, `text-crit-fg`) or
  `var(--token)`. In SVG, use `stroke="var(--color-line)"`.
- No hex, `rgb()`, `hsl()`, or default-palette classes (`text-red-500`) in TypeScript. The
  default palette is disabled, so those classes render nothing *(enforced:
  `src/styles/rawColors.test.ts`)*.
- The one exception is `features/service-map/galaxy/palette.ts`, because WebGL materials cannot
  read CSS variables.
- Gradients and other compound values become tokens too (`--stage-glow`, used as
  `bg-(image:--stage-glow)`).
- **Contrast.** Status and accent *text* uses the `*-fg` tokens. The raw light-theme status
  colours fail 4.5:1. New colours must pass `styles/contrast.test.ts` in both themes.
- **Theme** switches with `data-theme` on `<html>`. Never use `dark:` variants. Every page, the
  boards and the 3D view follow the theme switch.
- **One breakpoint:** `max-md:` (≤ 760 px), plus `NARROW_QUERY` / `useMediaQuery` when the
  structure itself must change.
- **State styling** uses ARIA and data variants (`aria-pressed:`, `aria-selected:`,
  `aria-expanded:`, `data-[emphasis=dim]:`). These double as test hooks. Never assert on class
  names.
- **Long class lists** that repeat go into `classes.ts` or a primitive. One-off layout utilities
  stay inline. Arbitrary values (`text-[12.5px]`, `w-[220px]`) are fine when they replicate the
  design reference; repeated ones belong in a helper.
- Glyph artwork, status shapes, and third-party overrides (React Flow, drei labels) go in
  `@layer components` in `styles/components.css`.
- No CSS Modules and no inline `style={{…}}` except for computed geometry (positions, sizes,
  transforms) *(CSS Modules enforced: `rawColors.test.ts`)*.

### 3.5 Components and hooks

- **Component files export only components.** Helpers, constants, and types used elsewhere go in
  a `.ts` file next to them (`flowForm.ts`, `inspectorText.ts`, `flowVisuals.ts`). This keeps
  fast refresh working (`react-refresh/only-export-components`).
- **Props are explicit.** Pass the data a component needs, not the whole store. Read from the
  store in the page or panel, and keep leaf components pure.
- **Hooks follow the rules.** Do not reassign variables during render
  (`react-hooks/immutability`), and keep complete dependency lists (`exhaustive-deps`). When a
  memo must re-run on a value it does not read, say so in code (`void theme`) rather than
  suppressing the rule.
- **State placement** (see `DEVELOPER_GUIDE.md` §3):
  - Cross-view state goes in Zustand.
  - Viewport, hover, drag, refs, timelines, and animation frames stay local.
  - Never write global state every frame.
- **Derived data** is computed with pure functions (domain, transit, adapters) and memoized at the
  page. Do not compute layouts in render bodies of leaf components.

### 3.6 TypeScript

- Settings: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `noUnused*`. ESLint uses `typescript-eslint` strict. Non-null assertions
  (`!`) are allowed only in tests.
- Use `import type { … }` for type-only imports.
- With `exactOptionalPropertyTypes`, optional props that may receive `undefined` are typed
  `prop?: T | undefined`. Do not pass `undefined` to a `prop?: T`. Spread conditionally instead
  (`...(x ? { x } : {})`).
- Model variants as discriminated unions (`via.kind`, `source.kind`) and switch on them
  exhaustively.
- TypeScript stays pinned to 6.0.x until `typescript-eslint` supports newer versions (see
  `CLAUDE.md`).

### 3.7 URL state

- Shareable state lives in the URL: selection, environment, filters, view, `asOf`, and the board
  parameters. `urlState.ts` parses and serializes it, and `useUrlStateSync` mirrors it.
- Page-local parameters are listed per route prefix in `PAGE_PARAMS`:
  - `/services/`: `line`, `mode`, `trace`, `t`, `window`.
  - `/flows/`: `step`, `mode`, `tx`, `t`, `window`.
- Theme, motion pause, and preferences never go in URLs.

### 3.8 Accessibility checklist (every UI change)

- [ ] Every control has a visible or accessible name; icon buttons have `aria-label`.
- [ ] Headings are in order; panels on boards are landmarks with `aria-label`.
- [ ] Status is never colour-only: use a shape, text, or pattern as well (`StatusShape`, dashes).
- [ ] Keyboard: everything clickable is reachable and operable; Escape closes; focus moves into
      dialogs and choosers and returns on close; shortcuts ignore typing targets
      (`shared/keyboard.ts`).
- [ ] Motion respects reduced motion (`useMotionReduced`); playback has a paused state.
- [ ] New pages have a case in `test/a11y.test.tsx` (axe); new colours pass `contrast.test.ts`.
- [ ] Before closing a milestone, run `npm run audit:a11y -- --url <preview-url>` (real browser).

### 3.9 Testing (frontend)

- Put pure modules' tests next to them (`*.test.ts`). Integration tests render through
  `test/renderApp.tsx` with injectable repositories and `resetUiStore()`.
- Query by role and name inside a landmark (`within(screen.getByRole('region', { name }))`).
  Page-wide role queries over large SVGs are slow.
- Use `fireEvent` inside React Flow and SVG maps; user-event's `mousedown` has `view: null`.
- Writes go through `createWritableRepository`, not network mocks.
- Under load, run Vitest with `--maxWorkers=2` or `3`. The 5 s timeout is about machine load, not
  correctness.
- Fixtures are deterministic. After changing the mock or validation, run
  `npm run fixtures:update` and commit `fixtures/`.

### 3.10 Performance

- Targets (ADR-005): 250 visible nodes and 750 visible edges, with 1,000 entities navigable.
- Layout runs in a Web Worker (ELK) or in pure precomputed pipelines (transit). Selection and
  replay change styles, never geometry.
- Lazy-load heavy views (3D).
- Performance claims need a recorded measurement in `BENCHMARKS.md`, using `npm run bench`,
  `bench:browser`, or `bench:3d`.

## 4. Backend (`backend/`, Go)

### 4.1 Layers

```
cmd/<tool>/                     entry points: api, seed, importflows, apibench, token
internal/app                    wiring: config → adapters → application → HTTP server
internal/adapters/httpapi       REST contract v1, problems, security middleware
internal/adapters/mongodb       persistence (sole database, ADR-019)
internal/adapters/memory        in-memory repositories (tests, no-DB mode)
internal/adapters/flowformats   native JSON/YAML and BPMN 2.0 flow decoders
internal/application            use cases: queries, writes, imports, simulation runs
internal/ports                  repository and decoder interfaces, sentinel errors
internal/simulation             deterministic engine (port of src/simulation)
internal/domain                 canonical types, validation, traversal, propagation (pure)
```

- Dependencies point inward. `domain` uses the standard library only *(enforced:
  `domain/boundaries_test.go`)*.
- `application` and `ports` never import adapters, `app`, `config`, `net/http`, or the MongoDB
  driver *(enforced: `application/boundaries_test.go`)*.
- Adapters implement `ports` interfaces. `internal/app` is the only place that chooses them.
- The backend implements `docs/api/openapi.json` and the frontend's domain rules. It never defines
  a parallel API or domain.

### 4.2 HTTP adapter

- `api.go` is the route table only. Each operation is one line, `h("METHOD /api/v1/…",
  d.handler)`, grouped by area.
- Handlers are named methods in `routes_<area>.go`:
  - `routes_read.go`: topology, registry, traversal, event types.
  - `routes_entities.go`: writes and imports.
  - `routes_history.go`: snapshots and layouts.
  - `routes_simulations.go`.
- A handler has three parts: parse the request, call one application method, write the
  response. Business rules belong in `application`.
- `request.go` holds the parsing helpers:
  - `intParam`, `listParam`.
  - `readBody` / `decodeBody`: Content-Type check, size limit, strict decoding.
  - `setETag` / `ifMatch`.
- Every body has a limit constant in `api.go`.
- Lists respond as `items(v)` → `{"items": […]}`. Creates respond `201` with `Location`. Writes
  set the new revision as `ETag`.
- **Adding an operation:**
  1. Add it to `openapi.json` with `x-repository`.
  2. Add the application method and its tests.
  3. Add a handler in the right `routes_*.go` and one line in `api.go`.
  4. Map any new error in `errors.go`.
  5. Add an `httpapi` test.
  6. Run `make contract-check`.

### 4.3 Errors

- The application returns typed errors (`ErrInvalid`, `ErrValidation`, `NotFound`,
  `ErrPrecondition`) or sentinels (`ports.ErrNotFound`, `ErrConflict`, `ErrUnavailable`,
  `ErrImportedFlow`, …).
- Wrap with `fmt.Errorf("…: %w", err)` to keep `errors.Is` working.
- `httpapi/errors.go` maps every error to an RFC 9457 problem with `problem(slug, title, status,
  detail, code)`. A new error needs a case there; anything unmapped becomes a logged 500.
- Problem details never include internal errors, query text, credentials, or paths.

### 4.4 Readability (Go)

- Follow §2: stage functions, early returns, and small named helpers. When stages share lookups,
  put them in a small struct with methods (`runRecorder`, `processReader`) rather than closures
  over many locals.
- Write table-driven tests (`[]struct{ name string; … }` + `t.Run`).
- `gofmt` and `go vet` run in `make check`.
- Accept `context.Context` first and respect it. Log with `slog` at the adapter or app boundary,
  not in the domain.

### 4.5 Parity with the frontend

- Validation codes and rules equal `apps/web/src/domain/validation.ts`. Change both in the same
  commit, then regenerate fixtures (`npm run fixtures:update`). Both suites check them.
- Enumerations are the schema's `$defs`, and `fields.go` is checked against the schema. Use those
  lists (`ProviderValues`, `HealthValues`, …); never write the values out again.
- Traversal, registry sorting, propagation, and the simulation engine have conformance tests
  against the shared fixtures.

### 4.6 Persistence and security

- MongoDB rules: `backend/CLAUDE.md` and `docs/backend/PERSISTENCE.md`.
  - One collection per kind.
  - `_id` is the stable ID.
  - Typed filters with input only as values.
  - No `$where`.
  - Never expose ObjectIds or `_meta`.
- Bound every traversal (depth, count, time) and every payload (`max*Body`).
- **Secrets stay in the gitignored `backend/secrets/`.** Never put a password on a command line,
  in an environment-variable example, or in a log. Use `scripts/mongosh.sh` or `make db-shell`.
- Security model: ADR-018 and `docs/backend/SECURITY.md`.

### 4.7 Checks (backend)

- `make check`: gofmt, vet, and unit, conformance, and lifecycle tests.
- `make test-integration`: needs `make dev-up`.
- `make contract-check`: the running API against the OpenAPI document.
- `make vulncheck` before a milestone closes.

## 5. Documentation and commits

- When behaviour, contracts, or decisions change, update the docs in the same commit:
  - the spec section;
  - `ARCHITECTURE.md` code map;
  - `DEVELOPER_GUIDE.md` recipes;
  - an ADR for a decision;
  - `BENCHMARKS.md` for measurements.
- When you change a convention, update this file.
- Commits follow Conventional Commits with the milestone or area as scope (`feat(m10): …`,
  `refactor(backend): …`). Commit on `main`, one unit per commit, after its checks pass. Do not
  push unless asked (`docs/AGENT_WORKFLOW.md` §6).

## 6. Review checklist

- [ ] Reused an existing primitive, helper, or pattern (§3.3, §4.2), or extracted one for the third copy.
- [ ] No new literal colours; any new token is in both themes and passes contrast.
- [ ] Functions and files have one subject; stages are named; no nested ternaries.
- [ ] Layers respected (guards pass); domain changes ported to Go with fixtures regenerated.
- [ ] Accessibility checklist (§3.8) for UI changes.
- [ ] Simulated, mock, or imported data labelled; nothing called live.
- [ ] Tests added next to the change; focused and full checks run, with results reported as observed.
- [ ] Docs updated (§5).
