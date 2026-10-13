# Transit Board — implementation spec

**Source:** product owner, 2026-10-12. Imported from the Claude Docs spec "Transit Board — implementation spec" (https://claude.ai/code/artifact/6a1110e4-eb2e-4059-b970-612976ffe1d1, revision 11). The working prototype is in `docs/design-references/payment-transit-board/` (pulled from https://claude.ai/artifact/BrmV6rhi3wrKXJ4CT5th5N); where the spec and the prototype differ, the spec wins.

**Status:** Phase 1 and the Phase 4 replay UI are implemented on example data (Milestone 9 and its follow-up, 2026-10-12). Phases 2, 3, and 5 (real sources and endpoints, findings rules, scale) are not started. Product requirements: `PRODUCT_SPEC.md` Revision 8 §O. Decision: ADR-021 (proposed). Delivery: Milestone 9 (`milestones/MILESTONE_09_TRANSIT_BOARD.md`). The final section, "Reconciliation with this repository", records where this spec meets existing decisions. It takes precedence over the imported text below until the product owner decides the open points.

## Overview

The transit board shows how one service executes, with one line per entry point. Each endpoint, consumed event, or scheduled job is a coloured line. Each line runs through the stations it touches (ingress, domain modules, client adapters, dependencies). It also passes the policy stops on every outbound call (bulkhead, timeout, retry, breaker, fallback).

It does one job: an engineer picks an entry point and understands what happens to a request. First they see the typical route over the last 7 days, then a replay of one real request. Everything on the board is labelled with where it came from: declared in specs or config, observed in traces, or inferred from code.

**Users:** service owners, on-call engineers, and reviewers who need to answer: "what does this endpoint call, in what order, with which protections, and where did this request spend its time?"

**Amended 2026-10-12 (ADR-022):** this board is now the **drill-down of a business-flow step**; the top level is the business flow (`docs/BUSINESS_FLOWS.md`). The exclusion of cross-service business flows below is superseded.

**Out of scope for v1:**
- cross-service business flows (they live one level up, in the galaxy view);
- editing config from the board;
- live streaming of traffic.

## Screen layout and components

The screen is a five-part grid:
- the header on top;
- the line index on the left;
- the map in the middle;
- the line card on the right;
- the stop strip spanning under the map and the card.

```
+---------------------------------------------------------------+
| Header: breadcrumb · title · [Typical route | Trace replay]  |
+-----------+-------------------------------------+-------------+
| Line      | Map (3D transit map, SVG)           | Line card   |
| index     |                                     | (max 600px, |
| 260px     |                                     |  scrolls)   |
|           +-------------------------------------+-------------+
|           | Stop strip (spans map + card)                     |
+-----------+---------------------------------------------------+
```

| Component | Contents | Notes |
|---|---|---|
| Header | Breadcrumb (env / service), title, mode switch (Typical route, Trace replay), data-freshness label | Trace replay is disabled until a line is selected |
| Line index | Search field, "All lines" row, lines grouped by kind (gRPC, HTTP, Webhooks, Events consumed, Scheduled, Background) | Row = colour badge with line code, name, dependency count, warning mark when the line has findings |
| Map | Perspective transit map of the whole service; legend at the bottom-left | Selected line bright, others dimmed to 22% grey |
| Stop strip | Linear diagram of the selected line; with no selection, a network summary | Branches fork into a second row |
| Line card | Typical: signature, caller, deadline, p50/p95, errors, calls/day, provenance, patterns, findings. Trace: request list, playback controls, step list | With no selection: legend of data sources and how to read the map |

Breakpoints:
- **≥ 1180px:** three columns; the strip spans the map and the card.
- **760–1180px:** the index and the map side by side, the strip under the map, the card full width below.
- **< 760px:** a single column in the order index, map, strip, card. The strip scrolls horizontally inside its panel, and the legend is hidden.

Visual system:
- a dark-only control-room look (superseded: the board follows the app's light/dark switch; see "Reconciliation" item 1);
- Geist for the UI, Geist Mono for codes, timings, and signatures;
- semantic colours: ok `#3dd6b0`, warning `#f5b454`, failure `#ff7b7b`;
- one accent, `#5fe1ff`, for focus and playback.

## Data model

The board renders from one JSON document per service and time window, `TransitBoard`, plus traces fetched on demand. The frontend never computes routes itself; it only lays out what the API returns.

```ts
type Provenance = { kind: 'declared' | 'observed' | 'inferred'; detail: string; // e.g. 'payments.proto', '41,208 traces', 'code scan'
                    coverage?: number /* 0..1 share of requests */ };

type Station = {
  id: string;                    // stable, e.g. 'mod:Capture', 'cli:card', 'dep:card-processor'
  name: string; sub?: string;    // 'Capture', 'tx'
  kind: 'caller' | 'gate' | 'module' | 'client' | 'dependency';
  provenance: Provenance;
  status?: 'ok' | 'degraded' | 'down';
  stats?: { p50Ms: number; p95Ms: number; errorRate: number }; // dependencies only
};

type PolicyStop = {
  id: string; clientId: string;  // the lane it sits on
  order: number;                 // position along the lane, 0 = first
  type: 'bulkhead' | 'timeout' | 'retry' | 'breaker' | 'fallback' | 'cache' | 'missing';
  label: string;                 // 'retry ×3', '2 s', 'no breaker'
  config?: Record<string, string>; // attempts, backoff, threshold …
  stat?: string;                 // 'fires on 3.1%', 'peak 14 / 20'
  provenance: Provenance;
};

type Line = {
  id: string; code: string;      // 'A2'
  name: string; group: 'grpc' | 'http' | 'webhook' | 'event' | 'scheduled' | 'background';
  signature: string;             // 'rpc Capture(CaptureRequest) returns (Payment)'
  caller: string; deadlineMs?: number;
  stats: { p50Ms: number; p95Ms: number; errorRate: number; callsPerDay: number; traces: number };
  route: Branch[];               // first = main path, others fork from a module
  patterns: string[]; findings: Finding[];
  provenance: { entry: Provenance; route: Provenance };
};

type Branch = { stations: string[];               // ordered station ids
                kind: 'sequential' | 'alternative'; // alternative = only on some requests
                share?: number };                // 0.06 = 6% of requests take it

type Finding = { severity: 'warn' | 'ok' | 'info'; text: string; stationIds: string[] };
```

Traces are fetched per line, newest first, filtered by status:

```ts
type TraceSummary = { traceId: string; businessKey?: string; startedAt: string;
                      durationMs: number; status: 'ok' | 'slow' | 'failed' };

type TraceStep = { at: string;          // station id or policy stop id
                   label: string;       // 'Attempt 2: timed out after 2 s'
                   startMs: number; durationMs: number;
                   status: 'ok' | 'warn' | 'fail'; spanId: string };
```

The track graph (the junctions and bends between stations) is not part of the API. The client derives it from the routes and the station kinds, so the layout can change without a backend release.

## Map rendering

The map is plain SVG drawn on a tilted ground plane. No WebGL is needed: labels and markers stay upright, and only positions are projected.

1. **Columns and rows.** Stations sit on a grid in plane units (u across, v down the plane).
   - Columns are fixed by kind: callers at u = −660, gates −480, modules −280, clients 0, dependencies 540.
   - Policy stops sit on the lane between a client and its dependency.
   - Rows: modules are ordered so that their clients are close in v. Each client shares a row (its lane) with its dependency.
2. **Track graph.** Insert junction nodes so that lines which share code share track:
   - a trunk at u = −400 from each gate to the modules it fans out to;
   - one exit node per module (u = −215) and one approach node per client (u = −90);
   - a vertical bus at u = −160, with a node at every module row and client row. A module-to-client hop goes exit → bus nodes → approach. Every line on the same bus segment is bundled.
3. **Bundling.** For each track edge, list the lines that use it in a fixed global order (by line code). Line i of n is offset by (i − (n − 1) / 2) × 7 units along the edge normal, with mitred corners. Because the order is global, lines keep their relative position across edges and only jog where they leave a bundle.
4. **Projection.** Rotate the plane about the x axis by t = 1.02 rad and apply perspective:
   - `y1 = h·cos t − v·sin t`
   - `z1 = h·sin t + v·cos t`
   - `k = F / (D − z1)`
   - screen = `(cx + u·k, cy − y1·k)`, with D = 2000 and F set to fit the container.

   Lines are drawn at height h = 9, plus five faint copies from h = 0 to 8 so they read as raised ribbons, and a blurred shadow at h = 0.
5. **Stations.**
   - A station is a white dot with a dark ring.
   - Every gate, and every station used by three or more lines, becomes a capsule whose height scales with the bundle.
   - Inferred stations are hollow, with a dashed amber ring.
   - Labels are upright SVG text with a dark stroke behind them, placed above, below, or right of the station by a per-station hint.
6. **Policy stops.** Diamonds on the lane, coloured by type. A missing policy is a hollow, dashed amber diamond. The map shows no stop labels; the strip carries them.
7. **Selection.**
   - The selected line is drawn last, wider (7 vs 5), with a soft glow.
   - All other lines collapse to a 3px grey at 22% opacity, and stations and stops off the line drop to 30%.
   - A route that has never been observed in traces is dashed.

## Interactions and states

All view state lives in one store and is mirrored to the URL, so any view can be linked from an incident channel.
- The store shape is `{ sel: lineId | null, mode: 'typical' | 'trace', q: string, traceIx: number, t: number, playing: boolean }`.
- The URL encodes `?line=A3&mode=trace&trace=<traceId>&t=1840`.
- `t` (playback time in ms) is written only while playback is paused, to avoid flooding the browser history.

**Selection.**
- Clicking a row in the index, a line on the map, or a station that belongs to one line selects that line.
- Clicking a shared station (one served by several lines) opens a small chooser listing those lines, instead of guessing.
- When a line is selected:
  - every other line drops to about 15% opacity;
  - the selected line is drawn on top at full width;
  - its stations, policy stops, and findings get labels.
- Esc, or a click on empty map, clears the selection and returns to the overview.
- Selecting a new line resets `traceIx` and `t` to 0 and stops playback.

**Search.**
- The index search box filters endpoints by name, by transport (`grpc`, `https`, `kafka`, `cron`), and by station name. Typing `ledger` keeps every line that passes through the ledger station.
- Matching lines stay lit on the map while the rest dim, even with no selection.
- The filter is a case-insensitive substring match over a precomputed string per line. No fuzzy matching is needed for v1.

**Keyboard.**
- Up and Down move through the visible index rows, Enter selects, and Esc clears.
- With a line selected:
  - T toggles typical and trace modes;
  - Space plays or pauses;
  - Left and Right step one trace step;
  - [ and ] switch to the previous or next sample trace.

**Hover.**
- Hovering a station shows a tooltip with its name, kind, provenance badge and, in typical mode, p50 and p99 for the selected line.
- Hovering a policy stop shows the policy summary (for example `retry ×3 · 200 ms backoff · jitter`) and its source file or config key.

**States.** Every panel has explicit states, and the spec treats them as part of the component contract:

| State | Map | Index | Card and strip |
|---|---|---|---|
| Loading | Skeleton track (grey trunk, no labels) | Five shimmer rows | Hidden |
| Empty (no endpoints discovered) | Centred message with a link to the onboarding doc for specs and tracing | "No endpoints yet" | Hidden |
| No selection | All lines at normal weight | Full list | Card shows service summary; strip shows a hint to pick an endpoint |
| Selected, no traces in window | Line drawn dashed (unobserved) | Row badge "no traffic" | Card lists declared steps only; trace mode disabled with a tooltip explaining why |
| Partial data (e.g. traces but no config) | Normal, with missing-policy diamonds where config is unknown rather than missing | Normal | Card shows a "data gaps" note listing which sources failed |
| Error | Last good render kept, banner on top | Same | Same |

The key rule: never show a policy as missing when the config source simply failed to load.
- "Missing" means the config was read and the policy is absent. It gets the dashed amber diamond.
- "Unknown" means the source could not be read. It gets a grey question-mark diamond instead.

## Typical route mode

Typical mode answers "what normally happens when this endpoint is called". It is the default when a line is selected. It is computed from aggregated traces over a time window: the last 24 hours by default, with 1h, 24h, and 7d selectable.

**What the route is.**
- For each root operation (for example `PaymentService/Capture`), the backend groups spans by their call-path signature: the ordered sequence of (station, operation) pairs below the root, with retries collapsed.
- The most frequent signature is the main line.
- Signatures that occur in at least 2% of traces become branches, drawn as side spurs off the main line (for example "fraud fallback" or "3DS challenge").
- Anything below 2% is folded into an "other paths" count on the card, so rare noise never adds track to the map.

**Per-step stats.**
- Each step on the strip shows its call share (how many traces visit it), p50 and p99 latency, error rate, and retry rate.
- Steps whose p99 exceeds their share of the endpoint's deadline budget are tinted amber. Steps with an error rate over 1% are tinted red.
- These thresholds are config, not hardcoded.

**Policies on the line.**
- Policy diamonds sit on the segment leading into the station they guard: timeout, retry, circuit breaker, bulkhead, idempotency key, fallback.
- Each has three possible renderings:
  - **solid:** declared in config and observed in traces (for example, retries actually seen);
  - **outline:** declared but never exercised in the window;
  - **dashed amber:** expected by a rule but absent (for example, an outbound call with retries but no idempotency key).
- The "expected policy" rules are a small, explicit list maintained with the platform team. Do not try to infer best practice generically.

**Findings.**
- The card lists findings in severity order.
- A finding is a rule hit with evidence: the rule id, the step it applies to, the source that proved it, and a one-line fix suggestion.
- Examples from the prototype:
  - retries without an idempotency key on the ledger write;
  - the timeout budget exceeded (downstream timeouts sum to 6.2 s against a 3 s endpoint deadline);
  - a breaker missing on fraud scoring.
- Clicking a finding highlights its step on the map and the strip.

**Budget bar.**
- The top of the card shows the endpoint's deadline as a bar, with the downstream timeouts stacked inside it in route order.
- If the stack overflows the deadline, the overflow is drawn past the end in amber.
- This is the most useful single glance on the whole screen; keep it.

## Trace replay mode

Trace mode answers "what happened in this one request". It replays a single trace along the selected line, so an engineer can debug one execution instead of reading a span waterfall.

**Picking a trace.**
- The card offers a short list of sample traces for the endpoint: the slowest, the most recent error, one with retries, and one typical (closest to p50).
- The user can also paste a trace id.
- The URL keeps the trace id, so a replay can be shared.

**From spans to steps.**
- The client receives a `TraceSummary` with ordered `TraceStep` records (defined in the data model).
- Each step maps to a station or policy stop on the line by `(service, operation)`.
- Retries become repeated steps on the same station, with an attempt counter.
- Spans that do not map to any known station are shown as "off-map" steps on the strip, flagged so that the station catalogue can be extended.
- Steps run in wall-clock order. Parallel spans (fan-out) are shown as a fork on the strip, with both branches advancing together.

**Playback.**
- A clock runs from 0 to the trace duration.
- The default speed is scaled so that the whole trace plays in about 6 seconds, whatever its real duration. A speed control offers 0.25×, 1×, and 4× of that.
- During playback:
  - a train marker moves along the selected line on the map;
  - the active step is highlighted on the strip;
  - the card shows the active step's span attributes (status, attempt, duration, key tags).
- Retries make the train bounce back to the policy diamond and re-run the segment. A fallback branches it onto the spur. An error stops it with a red marker.

**Scrubbing.**
- The strip doubles as a timeline: clicking a step jumps the clock to its start, and dragging scrubs.
- Left and Right arrows move one step at a time.
- Playback pauses on any manual move.

**Divergence.**
- When the replayed trace leaves the typical route (it takes a branch, hits an unusual station, or skips a step), the strip marks the divergence point.
- The card says how this trace differs from the typical route. For example: "took fraud fallback after 300 ms timeout; typical calls fraud scoring successfully".
- This is the comparison users care about most when debugging.

**Limits shown honestly.** If the trace is incomplete (dropped spans, or context propagation broken across an async hop), the strip shows a dashed gap labelled "context lost". It never draws the train jumping across the gap.

## Data sources: specs, OpenTelemetry, config, code scan

The board merges four sources.
- Every element on screen carries a `provenance` of `declared`, `observed`, or `inferred`, and the UI always shows which.
- The legend on the map explains the three styles: solid, solid with a trace tick, and dashed.

| Source | What it gives | Provenance | How to ingest |
|---|---|---|---|
| API specs (proto, OpenAPI, AsyncAPI) | Entry points: every endpoint, topic consumer and producer, with transport and request schema | declared | Read from the service repo or schema registry on each deploy |
| Scheduler config (k8s CronJob, Quartz, Temporal schedules) | Cron and scheduled entry points with schedule expression | declared | Read manifests from the deploy pipeline |
| OpenTelemetry traces | Routes, stations below the entry point, per-step stats, sample traces, actual retries | observed | Aggregate spans by root operation in a batch job every few minutes; keep raw traces for replay from the existing trace store |
| Resilience config (resilience4j / Polly / gRPC service config / Istio DestinationRule and VirtualService) | Timeouts, retries, breakers, bulkheads, fallbacks per outbound target | declared | Parse service config and mesh resources; key them by (service, target) |
| Code scan (optional, later phase) | Internal modules, outbox, saga steps, routes that exist but were never called | inferred | Static analysis of call sites to known clients; drawn dashed |

**Joining them.**
- The join key is `(service, operation)` for stations and `(service, target)` for policies.
- Name normalisation is the main practical problem: the same downstream appears as `ledger`, `ledger-svc.payments.svc.cluster.local`, and `LedgerClient`.
- Keep an explicit alias table per service, seeded automatically from mesh service names and editable by owners.

**Known gaps to design for.**
- **Internal module stations** appear only if the service creates internal spans. Without them, the line goes straight from the entry to the outbound calls, which is fine.
- **Sampling** means rare branches may be missing from short windows. Show the trace count behind every stat.
- **Context propagation** often breaks across message queues and thread pools, which splits one request into two traces. Link them through span links where present; otherwise show "context lost".
- **Cross-service business flows** are out of scope for this board. It shows one service; the galaxy view handles flows across services.

**API for the client.** Two endpoints are enough for v1:
- `GET /services/{id}/transit?window=24h` returns the stations, lines, branches, policies, findings, and stats.
- `GET /traces/{traceId}/steps?service={id}` returns a `TraceSummary` already mapped to station ids.

The track graph and the layout are computed client-side from the first response.

## Accessibility, performance, responsive

**Accessibility.**
- The map is an SVG with `role="img"` and an `aria-label` summarising the service. It is never the only way to reach information:
  - the endpoint index is a real list with buttons;
  - the strip is an ordered list of steps, with text for every stat.

  A screen-reader user can therefore do everything through the index and the strip.
- Colour is never the only signal:
  - provenance uses line style;
  - policy state uses fill and outline;
  - severity uses an icon and a word.
- Text contrast meets 4.5:1 against the dark background. Dimmed lines are decorative and exempt.
- Every keyboard shortcut from the interactions section works without a mouse, and focus is always visible.
- Playback respects `prefers-reduced-motion` by stepping the train instead of animating it.

**Performance.**
- The target is up to 60 endpoint lines and 80 stations per service, at 60 fps on a laptop.
- Compute the track graph, the bundling offsets, and the projected geometry once per data load, and memoise them. Selection and playback only change styles and one marker position, so they must not rebuild paths.
- Render the static map into one SVG layer, and the train and highlights into a second overlay layer.
- If a service exceeds the limits, collapse lines by transport into grouped trunks with an "expand" control, rather than drawing everything.

**Responsive.**
- **1180px and above:** the three-column grid (index, map, card), with the strip below the map and the card.
- **760–1180px:** the card moves under the map, and the index becomes a collapsible drawer.
- **Below 760px:**
  - the map flattens to a 2D top-down view (perspective off: it is unreadable at phone width);
  - the index becomes a select at the top;
  - the strip scrolls horizontally within its own container.
- The page itself must never scroll horizontally.

## Build plan in phases and open questions

**Phase 1: static board on mock data (1–2 weeks).**
- Port the prototype into the real frontend stack as components: `EndpointIndex`, `TransitMap`, `StepStrip`, `DetailCard`.
- Use the prototype's mock data, converted to the TypeScript types from the data model section.
- Deliverable: selection, search, typical mode, all the empty and error states, and the responsive breakpoints.
- This phase de-risks layout and bundling before any backend work.

**Phase 2: declared data.**
- Ingest API specs and scheduler config, so the index and the entry stations are real for one pilot service.
- Lines are drawn as unobserved (dashed) until traces arrive.
- Add resilience config parsing for policies.

**Phase 3: observed routes.**
- Build the trace aggregation job, the `/transit` endpoint, and the alias table.
- Turn on typical-mode stats, branches, and the budget bar for the pilot service.

**Phase 4: trace replay.**
- Add the `/steps` endpoint, sample trace selection, playback, scrubbing, and divergence.
- This is where the debugging value lands.

**Phase 5: findings and scale.**
- Add the rule set for missing and conflicting policies.
- Roll out to more services, and handle large services with grouped trunks.
- The code scan for inferred stations comes last and is optional.

**Open questions.**
1. Which tracing backend holds raw traces (Tempo, Jaeger, a vendor), and can it return a trace by id fast enough for replay?
2. Do services emit internal spans for modules, or will the first version show only entry and outbound stations?
3. Who owns the alias table and the expected-policy rules: the platform team or each service team?
4. What time window and sampling rate are available, and are they enough to see 2% branches reliably?
5. Should the board link back into the galaxy view (enter node → transit board) in v1, or ship standalone first?

**Reference.** The working prototype is the Payment Service Transit Board artifact (`docs/design-references/payment-transit-board/`). Its mock data, track layout constants, and trace generator are the best starting point for Phase 1.

---

## Reconciliation with this repository (added on import, 2026-10-12)

This section takes precedence over the imported text above until the product owner decides the open points. Nothing here is implemented yet.

**Fits as-is:**
- **Fonts.** Geist and Geist Mono are already the app's `--font-sans` / `--font-mono` (`apps/web/src/styles/tokens.css`).
- **Rendering.** Plain SVG, with no WebGL and no new dependency.
- **URL state.** Mirroring to the URL fits URL state v1 (additive parameters, like `ev` in Revision 6).
- **Labelling.** The prototype already labels its data "example data". The rule that simulated or mock data is never called live applies here too.

**Conflicts and their resolution (ADR-021; item 1 decided, the rest proposed):**

1. **Theme: decided (product owner, 2026-10-12): not dark-only.** The board follows the same light/dark switch as all other functionality (ADR-013).
   - The spec's dark-only raw hex palette is replaced by tokens. New ones (line colours, policy fills, map ground) go in `tokens.css` with values for both themes that pass `contrast.test.ts`.
   - The control-room look is the dark theme's rendering. The light theme gets an equivalent light rendering; no page forces a theme.
2. **Not the canonical domain.**
   - Stations, lines, policy stops, and traces are a per-service read model (the internals of one service). They are not canonical topology entities (`CLAUDE.md` constraints: follow the canonical domain model, and do not invent integrations).
   - Proposal:
     - the model gets its own types, in a module separate from `apps/web/src/domain`, linked to the canonical model only by the service ID (`service-definition` plus environment → service instance);
     - track graph, bundling, and projection are pure functions, independent of React.
3. **Backend endpoints.**
   - `GET /services/{id}/transit` and `GET /traces/{traceId}/steps` are proposals. They are not in `docs/api/openapi.json`, and the backend has no trace store, spec ingestion, or config parsing.
   - They are added to the contract only in Phase 2 or 3, after the open questions on the tracing backend are answered. Phase 1 uses a mock repository behind an interface, like the topology (`apps/web/src/data`).
4. **Where it lives in the app.**
   - Proposal: a route `/services/:serviceId/transit` (environment from the shared state), reached from the inspector of a service instance ("Open transit board").
   - The galaxy "enter node" link (open question 5) waits for the product owner.
5. **Internal inconsistencies in the imported spec, to settle in Phase 1:**
   - dimming of unselected lines: 22% (layout table, map rendering §7) vs. "about 15%" (interactions). Proposal: 22%, as in the prototype.
   - the card and line stats show p50/p95, while per-step stats and hover show p50/p99. Proposal: keep both, label them explicitly, and put p99 in the data model's step stats.
   - responsive 760–1180px: "card full width below" (layout) vs. "index becomes a collapsible drawer" (responsive). Proposal: the responsive section wins (it is the more specific one).

---

## Revision 2 — Authoring boards, and a local sandbox (2026-10-12, Milestone 11.4 with backend B10)

**Source:** product owner: "data is mocked; implement create/edit/delete of a transit board or a new flow". Answers:
1. Storage is the backend plus a local sandbox.
2. What can be edited is the declared structure.
3. Editing uses a structured form with a live preview.

Decision: ADR-031, which amends ADR-020 (mock data was read-only) and ADR-021 (the board was a read model only).

### A. What a board definition is

A **board definition** is the declared part of a transit board, written once per service and independent of the environment.

| Part | Fields |
|---|---|
| Stations | id, name, sub, kind (caller, gate, module, client, dependency); dependencies may link `entityId` to a topology entity (ADR-027) |
| Lines (endpoints) | id, code, name, group (gRPC, HTTP, webhook, event, scheduled, background), signature, caller, deadline; route (branches with `kind`, `share`, `condition`, `parallel`); patterns (catalog IDs, ADR-024); `repeat`; `transactions` |
| Policies | id, client station, order, type (the board policy types), label, config, `missing` (declared as expected but absent) |
| Tables | id, dependency station, name, pattern (`outbox` / `inbox` / none), writer and reader lines |

**Observed data is never authored:** statistics, step statistics, traces, policy firing states, and findings. A new board shows its lines as "not observed". Observed data, today the example data, merges onto a definition by line ID and station ID. Policies show `idle` (declared, not observed), or `missing` when flagged so.

### B. Validation

The same codes are used in TypeScript (`validateBoardDefinition`) and Go, on shared conformance fixtures:

| Code | Rule |
|---|---|
| `board-service-not-found` | the service definition does not exist |
| `invalid-board-station` | duplicate ID, unknown kind, or an `entityId` on a non-dependency |
| `board-entity-not-found` | a dependency's `entityId` is not a service definition or resource in the topology |
| `invalid-board-line` | duplicate ID or code; an empty route; an unknown station; a fork that does not start at a station of an earlier branch; a share outside 0..1 |
| `invalid-board-policy` | duplicate ID; not on a client station; a type that is not a board policy type |
| `invalid-board-table` | not on a dependency station; an unknown line; a writer or reader whose route does not reach the table's station |

### C. Storage and API (backend B10)

- **Storage.** A `transitBoards` collection, `_id` = service definition ID, with a revision per board.
- **Endpoints:**
  - `GET /api/v1/transit-boards` (summaries);
  - `GET /api/v1/transit-boards/{serviceId}` (with `ETag`);
  - `POST /api/v1/transit-boards` (409 if it exists);
  - `PUT /api/v1/transit-boards/{serviceId}` (`If-Match`);
  - `DELETE /api/v1/transit-boards/{serviceId}` (`If-Match`).
- **Validation.** Writes validate against the current topology. Failures are 422 with `errors[]`, and the editor role is required when `AUTH_MODE=token`.
- **Example fallback.** A service with no stored definition still shows the example board where one exists. Saving it (or creating one) stores a definition, which then wins.

### D. Local sandbox (mock data)

- **What it is.** With the built-in mock data, edits go to a **local sandbox** in the browser: every editable entity kind, business flows, and board definitions. The data is the mock topology plus the changes, saved in `localStorage`.
- **Same rules as the server.** Writes validate the whole result exactly like the server (`validateTopology`, `validateBoardDefinition`), with the same error shapes.
- **Clear labelling.** Everywhere the source shows, it reads "Mock inventory · local sandbox (not saved to the backend)". A **Reset sandbox** action (in Settings) restores the built-in data.
- **When there is no storage.** In private windows or with storage blocked, the sandbox works in memory and says so.

### E. Editor

- **Entry points.** The service board header gets **Edit board** and **Delete board**. A service with no board gets **Create a transit board**.
- **The dialog.** Sections for endpoints, stations, routes, policies, and tables, using the shared form fields (`shared/ui/form.tsx`).
  - Pick-lists come from the topology: dependencies link to resources and services, and patterns come from the catalog.
  - A **live preview** (map and process view) and the validation issues update while editing.
  - Errors focus their field.
- **Flows.** They use the existing flow editor, which now also works in the sandbox.

### F. Implementation notes (2026-10-13)

Where the build differs from, or adds to, A–E:

- **Definitions** live in `apps/web/src/transit/definition.ts`: `definitionOf`, `boardFromDefinition`, `validateBoardDefinition`. The schema is `docs/schemas/transit-board-definition.v1.schema.json`; the fixtures are `fixtures/conformance/boards/`. Issues carry a field `path` (for example `lines[1].code`) on both stacks and in the API's `errors[]`.
- **Which board shows.** The composed transit repository (`data/transitRepository.ts`) returns the stored definition, merged with the example board by ID, when one exists; otherwise the example board; otherwise none. Generated datasets (`?dataset=…`) have no board store and are read-only.
- **Editing the example board** stores a copy. Unchanged line and station IDs keep the example statistics; new ones are "not observed". Deleting the copy brings the example back.
- **Source label.** The board header reads "Sandbox board" or "Saved board", followed by "example stats" or "not observed" (`boardSourceLabel`). The topology source is labelled "Mock inventory · local sandbox". The editor and the delete dialog say that the sandbox is this browser only.
- **Sandbox storage.** Key `service-topology.sandbox.v1`. It stores a fingerprint of the built-in data, and resets itself when the built-in mock changes. Without storage, it runs in memory and Settings says so. Reset is in Settings ("Reset sandbox", then "Confirm reset").
- **Preview.** The editor previews the map with counts and issues. The process view is not in the preview; it shows on the board after saving.
- **Not in this milestone:** importing board definitions from files, and observed data for authored boards (Milestone 14).

