# Business flows on the transit board — specification

**Source:** product owner, 2026-10-12. The transit board should be a business flow, showing the steps of a business process while keeping its model of policies, retries, and so on. Decisions on the proposal:
1. **Option B:** the flow level goes on top, and today's per-service board becomes the drill-down of a step.
2. **Both sources:** flows are authored in the app *and* imported from workflow definitions.
3. **Replay included:** replaying a business transaction by its business key is part of the first release.

**Status:** implemented on example observed data (Milestone 10 and B8, 2026-10-12). **Revision 2** (end of this file) changes the flow board to swimlanes and adds flows on the service board and a pattern catalog (Milestone 11), with flow impact (Milestone 12) and a 3D drill-down (Milestone 13) specified. Earlier status: (Milestone 10 and B8, 2026-10-12; closeouts in `docs/IMPLEMENTATION_PLAN.md` and `docs/backend/IMPLEMENTATION_PLAN.md`). The section "Implementation notes" at the end records the decisions made while building it. Decision: ADR-022, which amends ADR-021. This spec extends `docs/TRANSIT_BOARD.md` and supersedes its "out of scope: cross-service business flows".

## 1. What the board shows

A **business flow** (Checkout, Refund, Subscription renewal) is a process that runs through several services. The flow board shows it as a transit network:

| Transit term | Business flow meaning |
|---|---|
| Line | A business flow. A flow's variants (paths) are its branches. |
| Station | A **business step**, e.g. "Reserve stock" or "Authorize payment", owned by one service. |
| Interchange | A step that several flows share (Capture is used by Checkout and Subscription renewal). |
| Branch | A **decision outcome** with its observed share, e.g. "declined 2%" or "3DS challenge 6%". |
| Terminus | An **outcome**: Completed, Cancelled, Refunded, Failed. |
| Zones | The owning **service**, drawn as bands (swimlanes) so team boundaries stay visible. |
| Policy diamonds | Policies on the **transitions** between steps (section 3). |
| Undo track | **Compensation** paths, drawn in the opposite direction and dashed (e.g. Void undoes Authorize). |

**Drill-down:** opening a step shows the per-service transit board of that service (`/services/:id/transit`), with the line of the step's entry point selected. The per-service board is unchanged; it is now the second level.

## 2. Model (canonical, environment-independent)

Business flows are a new **canonical entity kind**, `business-flow`. Like event types (ADR-014), a flow is logical: it is written once and resolved per environment.

```ts
type BusinessFlow = {
  id: string; name: string;                 // 'checkout', 'Checkout'
  description?: string; owner?: string; team?: string;
  trigger: { kind: 'call' | 'event' | 'schedule' | 'manual'; ref?: string }; // e.g. event type id
  target?: { p95Ms?: number; completionMs?: number };  // end-to-end objective
  steps: FlowStep[];
  transitions: FlowTransition[];
  outcomes: { id: string; name: string; kind: 'success' | 'cancelled' | 'failed' | 'compensated' }[];
  source: { kind: 'authored' } | { kind: 'imported'; format: string; ref: string; importedAt: string };
  metadata?: Record<string, unknown>;
};

type FlowStep = {
  id: string; name: string;                 // 'authorize-payment', 'Authorize payment'
  serviceDefinitionId: string;              // the owning service
  kind: 'task' | 'decision' | 'wait' | 'compensation' | 'manual';
  entryPoint?: string;                      // operation that implements it, e.g. 'Authorize' (links to a transit line)
  deadlineMs?: number;                      // how long the step may take (or wait, for 'wait')
  compensatedBy?: string;                   // step id that undoes this one
};

type FlowTransition = {
  id: string; from: string; to: string;     // step ids, or an outcome id for `to`
  via: { kind: 'call'; protocol?: string }  // backed by a relationship between the two services
     | { kind: 'event'; eventTypeId: string }; // backed by an event type's producer → consumer flow
  condition?: string;                       // 'declined', '3DS required'
  policies: FlowPolicy[];
};

type FlowPolicy = {
  type: 'timeout' | 'retry' | 'breaker' | 'bulkhead' | 'idempotency'           // today's types
      | 'redelivery' | 'dead-letter' | 'idempotent-consumer' | 'outbox'          // asynchronous
      | 'step-deadline' | 'compensation' | 'manual-intervention';               // process level
  label: string; config?: Record<string, string>;
  state?: 'exercised' | 'idle' | 'missing' | 'unknown';                          // as on the transit board
};
```

**Validation** extends `validateTopology`, with the same codes in TypeScript and Go:
- unique ids;
- known service definitions;
- transitions between known steps and outcomes;
- at least one path from the trigger to a success outcome;
- `compensatedBy` points to a compensation step;
- **every transition is backed by the topology**, in each environment where both services are deployed:
  - a `call` needs a modeled relationship between their instances;
  - an `event` needs the event type, with the source step's service among its producers and the target's among its consumers.

  Flows annotate communication; they never invent it (the same rule as ADR-014). A missing backing is a validation error. A service not deployed in an environment shows the step as "not deployed".
- Missing *expected* policies (an event transition without a dead-letter queue, a call retried without an idempotency key) are **findings**, not validation errors. They come from the same explicit rule list as the transit board.

**Contract:** an optional `businessFlows` array in topology contract v1 (additive). It becomes a writable kind in the entity API (ADR-020: `POST`, `PUT`, `DELETE /entities/business-flow`).

## 3. Policies and retries at three levels

1. **Calls between services:** timeout, retry, breaker, bulkhead, idempotency key (today's types).
2. **Asynchronous hand-offs:** redelivery, dead-letter queue, idempotent consumer, outbox.
3. **The process:**
   - step deadlines and waits (e.g. the card-processor webhook within 10 minutes);
   - compensation (Void, Refund);
   - manual intervention.

The **flow budget bar** compares the flow's end-to-end target with the sum of its step deadlines and timeouts along the typical path.

**Findings that need the flow level:**
- retry amplification across steps (e.g. Order Service retrying Capture × card retries = up to 12 processor calls per checkout);
- steps with side effects and no compensation;
- event transitions with no dead-letter queue;
- a step whose deadline is longer than the flow's target.

## 4. Sources: authored and imported

- **Authored in the app.** A "Flow" entry in the New menu and Edit/Delete on the flow (ADR-020 rules: backend only, whole-topology validation, revision `ETag`).
  - The flow editor is a form: steps, transitions with pick-lists of event types and services, conditions, and policies.
  - A visual editor is not in the first release.
- **Imported from workflow definitions.** An importer turns a definition into a `business-flow` entity:
  - with `source.kind = 'imported'`;
  - idempotent by id, and re-runnable;
  - validated like an authored flow.

  Imported flows are **read-only in the app**: an edit would be overwritten by the next import. "Duplicate as authored flow" makes an editable copy.

  Formats, in order:
  1. a native **flow definition file** (JSON or YAML, schema `schemas/business-flow.v1.schema.json`);
  2. **BPMN 2.0** XML: tasks become steps, sequence flows and message flows become transitions, gateways become decisions, boundary timer events become step deadlines, compensation associations become `compensatedBy`;
  3. orchestrator adapters (Temporal, AWS Step Functions) later.

  The mapping from a definition's tasks to services is explicit: a `serviceDefinitionId` per task, from an extension attribute or a mapping file. It is never guessed.

## 5. Observed data and business-transaction replay

- **Joining traces.** Observed flow data comes from traces joined by a **business key** (e.g. `orderId`), carried as a span attribute and on events.
  - One business transaction usually spans several traces: trace context breaks across events and webhooks.
  - The join is: the business key, plus span links where present, plus the step mapping `(service, operation) → step` (the alias table of `TRANSIT_BOARD.md`).
- **Typical mode.** Per flow, the board shows:
  - per step: share of transactions, p50 and p99, error rate, retry rate;
  - per decision: outcome shares;
  - per transition: the policy states;
  - the flow's completion time and completion rate.

  A window selector (1h, 24h, 7d) is included.
- **Transaction replay** (decision 3): pick a business transaction by key (`order 4486`) or from samples (slowest, failed, compensated, with retries, typical). It replays across steps on business time.
  - **Waits** (minutes to days) are compressed on the timeline, with their real duration labelled.
  - **Retries** at every level are repeated attempts.
  - **Redeliveries and dead-letter parking** are shown on the transition.
  - **Compensation** runs along the undo track.
  - **Gaps** where no trace connects two steps are shown as "not correlated", never bridged.
  - **Step drill-down:** opening a step during replay opens the per-service board in trace mode, on that step's own trace.
- **Example data first.** Until real sources exist (TRANSIT_BOARD phases 2–3), flows' observed data and transactions are example data, generated from the existing traces' business keys and clearly labelled.

## 6. Example flows (from the existing topology)

```
Checkout
 Place order (order-service) ─OrderPlaced─▶ Reserve stock (inventory-service) ─StockReserved─▶
 Authorize payment (payment-service, A1) ─┬─ declined 2% ─▶ Cancel order ─▶ ⊣ Cancelled
                                          └▶ Capture payment (A2) ─▶ Settle (W1, wait ≤ 10 min) ─▶ Post to ledger
 ─PaymentCaptured (O1 outbox)─▶ Ship order (order-service) ─OrderShipped─▶ Notify customer (notification-service) ─▶ ⊣ Completed
 Undo: OrderCancelled ─▶ Void (E1/A4) · authorization expiry (J1) · Release stock
Refund
 Request refund ─▶ Refund payment (A3) ─▶ Post to ledger ─RefundIssued─▶ Notify customer ─▶ ⊣ Refunded
```

Every transition is backed by a relationship or an event type that already exists in the example topology (`OrderPlaced`, `StockReserved`, `PaymentCaptured`, `PaymentFailed`, `OrderShipped`, `RefundIssued`, `NotificationRequested`, `OrderCancelled`). Where a backing is missing, the example adds it to the topology explicitly; it is not assumed.

## 7. Screens

- **`/flows`:** the flow catalog (like Events): search, owner, step count, completion rate, and warnings. A "Flows" entry joins the navigation.
- **`/flows/:flowId`:** the flow board, using the transit board's layout pipeline and components:
  - **Columns** are step rank (the order of steps); **service zones** are horizontal bands.
  - Bundling, the projection, the selection and dimming styles, the panel states, and both themes are reused.
  - The line index lists flows, so interchanges are visible across flows. The card shows the flow's target, budget, outcomes, findings, and source (authored, or imported from where).
- **Drill-down** to `/services/:serviceId/transit?line=…` from any step, and back.
- **Inspector:** a service lists the flows it takes part in; an event type lists the flows that use it.

Accessibility, performance, and responsive rules are those of `TRANSIT_BOARD.md`. The flow catalog and the step list are the accessible equivalent of the map. Target: 50 flows and 40 steps per flow.

## 8. Open questions (not blocking Milestone 10)

1. Which attribute carries the business key in real traces (`order.id`, `app.business_key`, baggage)?
2. Who owns flow definitions: product teams or the platform team?
3. Which orchestrator adapter comes first after BPMN?

## Implementation notes (2026-10-12)
These refine sections 2–7. Where they differ, these notes win.

- **Model additions:**
  - `startStepId` names the first step.
  - A `local` transition joins two steps of the same service; it needs no backing.
  - A `call` may name its `callerServiceId`, the orchestrator that makes the call; this defaults to the source step's service. Without an explicit caller, the reply to a call the target service made to the source service also counts as backing (for example, Capture payment → Ship order is backed by Order Service → Payment Service).
  - Unconditional transitions from a step run in parallel; conditional ones run when their condition holds.
  - A policy without `state` is declared without observations, and is drawn like `idle`.
- **Validation codes** (TypeScript and Go, identical on the shared conformance fixtures): `missing-flow-service`, `invalid-flow-step`, `invalid-flow-trigger`, `invalid-flow-transition`, `flow-no-success-path`, `flow-transition-unbacked`. Writes add `invalid-field` (schema enumerations), and the import adds `import-invalid` (naming the element). 409 codes: `imported-read-only`, `import-overwrites-authored`.
- **Import:**
  - `POST /api/v1/imports/business-flows` with `{format: native|bpmn, content, ref, mapping}`, or `make -C backend import-flows FILE=… [FORMAT=…] [MAPPING=…]`.
  - Examples: `fixtures/flows/daily-payout.flow.yaml` and `fixtures/flows/order-cancellation.bpmn`. The native file schema is `docs/schemas/business-flow.v1.schema.json`.
  - BPMN uses the namespace `https://service-topology.dev/bpmn`, with the attributes `st:service`, `st:entryPoint`, and `st:eventType`.
  - The flows are validated as a whole before anything is written, then written one at a time on the revision chain.
- **Screens and URL state:** `/flows` and `/flows/:flowId`. The flow board keeps `step`, `mode=replay`, `tx`, `t`, and `window` in the URL. A step's drill-down passes its entry point as `line`; the transit board resolves it by name or signature and rewrites it to the line ID.
- **Typical path:** the unconditional exits of each step; where a step has only conditional exits, the most frequent one.
- **Response-time budget** (called the flow budget before Milestone 11.6): each synchronous step on the typical path counts its incoming call timeout × retry attempts, else its own deadline, against the response-time target (`target.p95Ms`). Waits and asynchronous hand-offs are excluded; they count toward the end-to-end completion target (`target.completionMs`). The flow card labels both that way.
- **Findings:**
  - Retry amplification reads the inner retries from the step's service transit board: the clients of the line that implements the step.
  - Missing compensation flags any step that can still reach both a success outcome and a non-success outcome, has no compensation, and is not the start, a decision, a wait, or a compensation step.
- **Example observed data:** `apps/web/src/transit/flows/exampleFlows.ts`, behind `TransitRepository` (`getFlowStats`, `getTransactions`, `getTransaction`). It includes 8 Checkout and 3 Refund transactions. Waits, and any step longer than 6 s, are compressed to at most 1.5 s on the replay clock, with their real duration labelled.

---

# Revision 2 — Swimlanes, flows on the service board, patterns, impact, and the 3D drill-down (2026-10-12)

**Source:** product owner review of the Milestone 10 board: "flows seem like a part designed as the transit board — do flows need to be visible on the transit board too? What React Three Fiber stack could make them friendlier? I see only the outbox pattern, but system design has many more." Decisions on the proposal:
1. **Yes:** a flat swimlane view for flows, plus two-way navigation between flows and service boards.
2. **Not all patterns:** one catalog for both boards, extended only with messaging reliability (inbox) and polling (polling publisher, async request-reply). Retry topics with delay, parking lots, ordering, consumer lag, saga semantics, and the resilience extras are out.
3. **Yes:** flows in impact analysis and simulation.
4. **Yes:** a 3D drill-down from the flow to its services, built with React Three Fiber.

Specify all three, build Milestone 11 only. Decisions: ADR-023 (sections 9–10), ADR-024 (section 11), ADR-025 (section 12), ADR-026 (section 13). Where this revision differs from sections 1, 3, and 7, it wins.

## 9. The flow board as swimlanes (Milestone 11)

**Why.** The transit metaphor pays off when many lines share stations, which is the inside of one service. A flow is one process with branches, so on the tilted multi-flow map:
- the perspective wastes width and squeezes the upper lanes;
- band captions collide with step labels;
- lines cross lanes to reach far-away termini;
- other flows' steps appear as unexplained faded stations.

**Layout** (pure, `transit/flows/swimlane.ts`, computed once per flow):
- **Lanes** are services. Their order is the first time each service is reached on a breadth-first walk from the start step, so the start's service comes first. An **outcomes** lane comes last.
- **Columns** are step rank (`flowRanks`, longest path from the start). Several steps of one lane in the same column stack inside the lane, and the lane grows to fit them.
- **Step nodes** are cards showing:
  - the step name;
  - the service and entry point;
  - a kind glyph: diamond for a decision, ring for a wait, dashed for a compensation, a hand for a manual step;
  - a deadline chip when the step has one.

  **Outcomes** are pills with a shape and the outcome kind written out, never colour alone.
- **Edges** are orthogonal and routed by the layout:
  - Forward edges run through the channel between two columns. Each edge gets its own track, so vertical segments never overlap.
  - Edges that go back, to the same or an earlier column, use a return track under their source lane.
  - Compensation edges are dashed.
  - The condition and the observed share label the first segment. Policy diamonds sit along the edge near its source.
- **One flow per board.** A step that other flows also use shows an "also in Refund" marker that links to that flow. The catalog lists the flows. The tilted multi-flow map leaves the flow board; the service board keeps it.

**Renderer:** React Flow 12, already used for the topology map (ADR-009).
- Nodes are placed by the layout and are not draggable. Lanes are background nodes.
- Pan, zoom, and fit-to-view are available.
- Steps are focusable, and Enter selects one.
- Selection, search, findings focus, and replay change node and edge data only, never positions (tested).
- ELK is not used here: its layered algorithm assigns columns, but it cannot pin nodes to lanes.

**Replay** marks the transaction's current step with a status ring (`data-train`), highlights the transitions already traversed, and marks the divergence point.

**Narrow screens (≤ 760 px):** the swimlane opens fitted to the width with pan and zoom. The step strip stays the primary, accessible list.

## 10. Flows on the service board (Milestone 11)

- **Index:** a "Business flows · n" group lists the flows with a step on this service in the current environment. Each row shows the flow badge, the name, and the number of its steps here.
- **Selecting a flow** (`flow` in the URL; a page parameter of `/services/`):
  - highlights the lines its steps enter and dims the others;
  - clearing the selection or pressing Escape restores the board;
  - geometry is not rebuilt.
- **Line card:** a "Used by business flows" section lists every flow step that enters the line, with a link to `/flows/:flowId?step=…`.
- **Matching:** a step enters a line when its entry point equals the line's name or signature, ignoring case. This is the same rule retry amplification uses, written once in `transit/flows/flowModel.ts` (`lineForStep`). A step with no entry point, or with no matching line, is listed under its flow as "not mapped to a line".

## 11. One pattern catalog (Milestone 11)

- **One catalog** (`domain/patterns.ts`, pure). Each entry has:
  - an `id` and a `label`;
  - a `category`: call, messaging, process, or platform;
  - `appliesTo`: a call transition, an event transition, a step, or a service-board line or client;
  - a one-sentence description;
  - the findings that check it.

  Both boards, the tooltips, the legends, the flow form's pick-list, and the findings read labels and descriptions from it. The transit board's `PolicyType` and the flow's `FlowPolicyType` become subsets of the catalog's IDs.
- **Existing tags become catalog entries.** The service board's free-text pattern tags (mTLS, rate limit, transaction, transactional outbox, idempotent receiver, …) become catalog IDs. This types what is already shown; it adds no behaviour.
- **New in Milestone 11** (the product owner's scope: messaging reliability and polling). Each is a `FlowPolicyType`, an additive schema enumeration value:

| Pattern | Applies to | Meaning | Config |
|---|---|---|---|
| `inbox` | event transition (consumer) | The consumer records each received message in its own database, in the same transaction as handling it, and drops duplicates. This is stronger than `idempotent-consumer`, which accepts any deduplication. | `retention` |
| `polling-publisher` | event transition (producer) | A relay polls the outbox table and publishes what it finds, as the service board's `OutboxRelay` does. | `intervalMs` |
| `async-request-reply` | call transition | The callee answers 202 Accepted with a status location, and the caller polls until it is done or the deadline passes. | `pollIntervalMs`, `timeoutMs` |

- **New findings:**
  - **Outbox without a relay** (info): an event transition declares `outbox` but no `polling-publisher`.
  - **At-least-once delivery without deduplication** (warn): an event transition has `outbox` or `redelivery`, but the consumer side has neither `inbox` nor `idempotent-consumer`. Duplicates will reach the step.
  - **Polling without a deadline** (warn): `async-request-reply` has no `timeoutMs`, and the target step has no deadline.
- **Out of scope** (not selected): saga semantics (pivot, compensatable, and retriable steps), resilience extras (backoff with jitter, retry budget, rate limiting, load shedding, hedging), retry topics and parking lots, ordering keys, consumer lag, event sourcing, CQRS, anti-corruption layer, strangler fig, BFF, claim check, and scatter-gather.

## 12. Flows in impact analysis and simulation (Milestone 12; implemented 2026-10-13)

- **Pure function** `flowImpact(flow, resolved, impacts)` in `domain/`. It takes the existing propagation result (`AnalyzeImpact`, which explains every effect) and returns, for each flow:
  - the affected steps, each unavailable or degraded, with its cause chain;
  - the **first affected step on the typical path**;
  - the **likely outcome**:
    - *compensated*, when a compensation path is reachable from that step;
    - *failed* or *cancelled*, from the outcome its failure edge reaches;
    - *delayed*, when the step sits behind an event transition with redelivery or a dead-letter queue and the broker is healthy.
- **Where it shows** (all labelled *simulated*):
  - the inspector's "Business flows affected" for an impacted entity;
  - the simulation page's list of affected flows;
  - a banner on the flow board, e.g. "Simulated: Payment Service unavailable → Checkout stops at Authorize payment, likely Cancelled", with the affected steps marked in the swimlane;
  - a column in the catalog.
- **Backend (B9):** the impact response gains an optional `flows` array (additive to contract v1), ported to Go with conformance fixtures shared with TypeScript.
- **Implementation notes (2026-10-13):**
  - **Code:** `apps/web/src/domain/flowImpact.ts` and `backend/internal/domain/flowimpact.go`; fixtures `fixtures/conformance/impact/flows.json` (126 cases). `flowImpacts(index, roots, impacts)` covers every environment, environments and flows by ID.
  - **Attribution.** A step is affected when its service instance fails, unless the instance only fails over a relationship that backs one of the flow's own transitions. The flow models that call or event as a hand-off, so the failure shows at the step it enters. Example: with the card processor down, Order Service is degraded only because it calls Payment Service (the `authorize` transition), so Checkout stops at Authorize payment, not at Place order.
  - **Channels.** An *unavailable* channel affects the step its event enters (`reason: input-channel`). A degraded channel (backlog) does not, as in the propagation rules.
  - **Typical path** without observed shares (the backend has none): a step with only conditional exits takes the first declared one. `typicalPath` moved to `domain/businessFlow.ts`.
  - **Likely outcome**, checked in this order: *delayed* when the step is entered on the typical path by an event with declared redelivery or a dead-letter queue and the channel is not unavailable; else the first non-success outcome reached from the step's non-typical exits, with `compensated` when a compensation step is reachable; else *unknown*.
  - **UI:** `state/useFlowImpacts.ts`; `features/business-flows/FlowImpactPanels.tsx` and `flowImpactText.ts`; `features/simulation/AffectedFlowsPanel.tsx`. Nothing is shown while viewing history.
- **Acceptance:**
  - Parity on the shared fixtures.
  - The example scenario (the card processor unavailable) marks Checkout's Authorize payment and Refund's Refund payment as affected, with Cancelled and Rejected as the likely outcomes.
  - Nothing simulated is called live.

## 13. The 3D drill-down: the process over its services (Milestone 13; implemented 2026-10-13)

- **What it shows.** An optional "3D" view of the flow board, lazy-loaded like the galaxy:
  - The swimlane plane floats on top.
  - Under each service lane hangs that service's transit plane, using the transit layout's plane coordinates (u, v) with no new layout.
  - Light shafts drop from each step to the entry station of its line (section 10's matching).
  - Replay particles descend into the service's line and come back up.
- **Navigation.**
  - Clicking a service plane flies the camera down to it; Escape climbs back.
  - The scope is in the URL.
  - Selection is shared with the 2D views.
- **Stack:**
  - Kept: React Three Fiber and drei (`CameraControls`, `Text`/`Billboard`, `Line`, `Instances`, `Bvh`).
  - New, pinned when built: `@react-three/postprocessing` (selective `Bloom`) and `maath` (frame-local easing).
  - No other new dependency without approval.
- **Rules:** those of `3D_GALAXY_EXPERIENCE.md`:
  - motion policy and reduced motion;
  - the 2D fallback without WebGL;
  - the lists stay the accessible path;
  - colours from tokens through a palette module;
  - no Three.js objects in Zustand, and no per-frame global state.
- **Performance** is measured with `npm run bench:3d` at 12 steps × 6 service boards and recorded in `BENCHMARKS.md`.
- **Implementation notes (2026-10-13):**
  - **Code:** `apps/web/src/features/business-flows/drilldown/` — `drilldownModel.ts` (pure scene model), `drilldownCamera.ts` (poses, particle positions), `drilldownLabels.ts`, `drilldownPalette.ts`, `DrilldownScene.tsx` + `DrilldownParts.tsx` (R3F), `FlowDrilldown3D.tsx` (the lazy boundary and overlay).
  - **Opening it:** the flow board's **Swimlane | 3D** switch. URL: `scene=3d`, and `drill=<service>` for an entered service (`scope` is the galaxy's). The selected step is the shared `step` parameter.
  - **Layout:** one plane per service lane, in lane order, centred under the lane's steps; each lane is stretched over its plane on the flow plane. The planes hang at least 420 units down, more for a big flow (35% of its extent). A service without a board is an empty plane labelled "no board yet". A shaft starts at a step and ends at its line's entry station (the gate, else the first station after the caller).
  - **Labels** are drei `Html` (ADR-011 rejected runtime font fetching), decluttered by the galaxy's `LabelLayer`, now generic. Stations are labelled only inside the entered service.
  - **Camera:** CameraControls; about 45° onto a single plane, lower and to the side for the stack; instant under reduced motion.
  - **Replay particles** read the board's playback clock in the frame loop; with reduced motion they rest at the station.
  - **Bloom** only in the dark theme, and only on colours pushed above 1 (shafts and particles).
  - **Accessible path:** the overlay lists every service as a button, with the breadcrumb and "Back to the flow (Esc)"; the swimlane, strip, and card stay beside it.
- **Refinement (Milestone 13.1, 2026-10-13; these notes win over the ones above where they differ):**
  - **The flow's lines only.** A service plane shows the lines the flow's steps enter, their stations, and the policy stops on them, fitted to them at one scale for every service. Inside a service, **Show all N lines** adds the rest, dimmed, and frames the whole board.
  - **Two tiers.** The flow plane (compact lanes, caption gutter) is on top; the service planes form a row below and in front of it, each under its steps along x (entry stations under the steps' mean x), packed so they never overlap. Beams fan from the steps into their lines.
  - **No board, no plane.** A service without a board hangs nothing: its steps end in short dashed stubs with an empty ring, and its lane caption says "no transit board".
  - **Visual language of the 2D board:** line ribbons in their colours, flat white stations on dark rings, policy diamonds, flow-coloured transitions with arrowheads and step tiles, and beams in the flow colour (the selected step's beam and line bloom).
  - **Camera:** a 28° lens fitted to the canvas aspect; 40° down onto the stack, 55° onto one plane; Reset view.

## Revision 2 implementation notes (Milestone 11, 2026-10-12)
These refine sections 9–11. Where they differ, these notes win.

- **Readable first view.**
  - The swimlane fits the panel's width only when that keeps a zoom of 72% or more.
  - Otherwise it opens at 72% at the flow's start, with a minimap.
  - Lane captions sit in a frozen column that follows vertical pan and zoom.
  - During replay, and when a step is selected, the camera brings that step into view (an effect on the change; instant with reduced motion).
  - The wheel scrolls the page; zoom with the controls or a pinch.
- **Board arrangement.** The flow board's index is a bar (the "All flows" link, a flow picker, and a step search) across the top. The map takes the width beside the card (`BoardGrid wideMap`). The search highlights matching steps on the swimlane.
- **Labels.**
  - A transition's label (condition, event name, share) ends just before its target, above the entry stub.
  - Labels into the same step stack upwards.
  - Each channel reserves room for its longest label.
  - Labels of dimmed edges are not drawn.
- **Routing.**
  - Each channel is as wide as its tracks and labels need.
  - Back edges, and forward jumps whose straight run would cross a node, use the source lane's gutter.
- **Patterns.**
  - The policy and pattern labels on both boards come from the catalog.
  - The service board's existing tags (mTLS, rate limit, transaction, cache-aside, read replica, pagination, HMAC signature, saga, scheduled job, leader lock, idempotent producer) are catalog entries, typed but unchanged.
  - The example Checkout settlement hand-off declares `polling-publisher` (the `OutboxRelay`) and `inbox`.
  - "At-least-once delivery without deduplication" replaces the separate missing-policy note for a missing idempotent consumer or inbox.
- **Navigation.** A step's drill-down passes `flow`, so the service board opens with that flow highlighted. The line card's links keep the environment and window.

---

# Revision 3 — Data stores on both boards, and flows you can find (2026-10-12, Milestone 11.1)

**Source:** product owner, after Milestone 11: "the transit board is kind of a sequence diagram, and I think we need a DB, like the inbox pattern talks to the DB", and "I don't see on the transit board interactions or links to the flows". Decision: ADR-027.

**Why.** Read as a sequence diagram, a line is a conversation, and the reliability patterns talk to the database:
- the outbox writes its row in the same transaction as the state change;
- the relay polls that table;
- the inbox records each message before handling it.

The service board drew databases only as anonymous endpoints (`payments-pg`), not linked to the topology. The flow board drew no data stores at all. The links to flows were at the bottom of the line index, and absent on services without board data.

## 14. Dependencies are topology entities (service board)

- **The link.** A dependency station may name its canonical entity (`entityId`): a service definition, or a resource such as `pg-payments-prod`. The board resolves it in the current environment:
  - its name, kind, and **health from the topology** (which includes a running simulation, so a simulated `payments-db` outage shows on the board);
  - a link to the inspector.
- **Missing links.** A dependency with no `entityId`, or whose entity is not in the environment, is shown as **"not in the topology"**, and the board lists it under "Needs review" (rule `dependency-not-in-topology`). It is never matched by name.
- **Example data.** The example Payment Service board links Fraud Scoring, the card processor, Ledger, `payments-db` (both its primary and its replica station) and `payments.events`. The Redis cache is not in the topology, and says so.

## 15. Tables: where patterns meet the database (service board)

- **The model.** A board declares the **tables** of its database dependencies. Each table has:
  - a name;
  - the pattern it serves, if any (`outbox`, `inbox`; or none for plain state);
  - the lines that write it and the lines that read it.

  A table's writers and readers must reach its station on their route (tested).
- **Where tables show.** In the sequence order of a line:
  - the stop strip shows, under the database stop, what this line does there, e.g. "writes payment_outbox · Transactional outbox";
  - the line card gets a "Data" section;
  - the database station's tooltip lists its tables, with their writers and readers.
- **Example tables** on `payments-db`:
  - `payments` (state): written by Capture, the webhook, and ExpireAuthorizations;
  - `payment_outbox` (outbox): written by Capture and the webhook, polled by OutboxRelay;
  - `processed_webhooks` (inbox): written and read by the webhook, because processor callbacks are redelivered.
- **Rule `store-pattern-without-table`** (warn): a line that declares the outbox, inbox, or polling-publisher pattern has no table for it on any database on its route.

## 16. Data stores on the flow board, and flows you can find

- **Data stores on steps.** Each step shows the data stores (databases, caches, search indexes) its service uses in the environment, from the topology's relationships, with their health. The flow card gets a **"Data stores"** section listing each store and the steps that use it.

  Limit: the topology links stores to services, not to operations. The UI says "used by this step's service".
- **Patterns name their store.**
  - An outbox or polling publisher on a transition is kept in the source service's database.
  - An inbox is kept in the target service's database.

  Tooltips name the store. Rule `store-pattern-without-store` (warn): the service has no database in the topology.
- **Finding flows on the service board.**
  - A **"Used by"** row of flow chips under the header toggles a flow, the same as the index's flow group.
  - That group moves to the top of the index, after "All lines".
  - A service with no board data still lists the flows that use it, with links to their steps.

## Revision 3 implementation notes (Milestone 11.1, 2026-10-12)
- **Linked names.** A linked dependency shows its topology name (`payments-pg` became `payments-db`; Card Processor became Card Processor API) and its topology health, which includes a running simulation. Its example health is dropped. The stop strip shows a degraded or down dependency even next to its step stats.
- **No rebuilds on simulation ticks.** The linked board is rebuilt only when a link or a linked health changes (`useKeyed`).
- **The outbox rule.** The outbox pattern is satisfied by writing or polling an outbox table (the relay carries it too). The inbox must be written; the polling publisher must read.
- **Where flows show.** The flow group in the index sits right after "All lines", so the arrow keys reach it first.

---

# Revision 4 — The process view, and endpoints you can see (2026-10-12, Milestone 11.2)

**Source:** product owner: "maybe on the board we could add a process section? and a loop, with if else conditions", and "I don't see endpoints, where are they supposed to be?" Decision: ADR-028.

## 17. Process view: the line or flow as a sequence diagram

- **Where it lives.**
  - On the service board, a selected line's strip panel switches between **Stops** and **Process**.
  - On the flow board, the typical-mode strip switches between **Stages** and **Process**.
  - The choice is a page parameter (`strip=process`).
- **What it draws.**
  - **Lifelines:** the stations a line passes through (caller, entry, module, clients, dependencies), or the services a flow passes through (in lane order).
  - **Messages:** a call, an asynchronous hand-off, a reply, a table write or read, or a local step.
  - **Fragments:** the standard sequence-diagram blocks.

| Fragment | Service board (line) | Flow board |
|---|---|---|
| `alt` (if / else) | — | a step whose exits are all conditional (a decision), with observed shares |
| `opt` (if) | an alternative branch, with its condition and share (A5: cache miss · 6%) | a conditional exit beside unconditional ones; unconditional exits always run, so the flow model has no `else` |
| `loop` | a retry policy around the call it retries (retry ×3), and a line's `repeat` (OutboxRelay: every 200 ms) | retry on a call, redelivery on an event |
| `par` | branches declared `parallel` (J2 reconciles card and ledger together) | unconditional exits that run together |
| `transaction` | a line's declared transaction: the table writes it groups (Capture: `payments` + `payment_outbox`) | — |
| `compensation` | — | transitions into a compensation step |

- **Attached to messages.** Timeout, breaker, bulkhead, idempotency, and fallback appear as guards on the call ("timeout 2 s · breaker"). A missing policy says "missing". A wait step is a note ("wait ≤ 10 min"). An outcome ends its section ("⊣ Completed").
- **Rule.** Nothing is inferred. Conditions, parallelism, repetition, and transactions come from declared data (`Branch.condition`, `Branch.parallel`, `Line.repeat`, `Line.transactions` on the service board) or from the flow model. A step reached a second time says "continues at …" instead of repeating.
- **Accessibility.** The diagram is an ordered list, with fragments as nested lists headed "loop: retry ×3". It reads in order without the drawing.

## 18. Endpoints on the service board

- **Every line is one endpoint** (a gRPC method, an HTTP route, a consumed event, a schedule, or a background job).
- **The index** heads its line groups "Endpoints".
- **The map** labels the selected line's start with its code and signature ("A2 · rpc Capture(CaptureRequest) returns (Payment)").
- **The process view's first message** is the endpoint call.

---

# Revision 5 — Endpoint contracts from OpenAPI (2026-10-12, Milestone 11.3)

**Source:** product owner: "I need info on the endpoint like from swagger, that I could see what it returns, payload and response models". Answers:
- the source is **OpenAPI (Swagger) only**: HTTP endpoints, from OpenAPI documents;
- it is shown **on flow steps and on process arrows**.

Decision: ADR-029.

## 19. Contracts on flow steps and process arrows

- **Source.** One OpenAPI 3.x document per service, through `TransitRepository.getOpenApi(serviceDefinitionId)`.
  - The example documents (`apps/web/src/contracts/examples/*.openapi.json`, JSON because the frontend has no YAML parser) cover Order Service (`POST /v1/orders`, `POST /v1/orders/{id}/refunds`, `GET /v1/orders/{id}`) and Payment Service (`POST /webhooks/processor`).
  - They are labelled example specifications.
- **Matching.** An endpoint "METHOD /path" (a flow step's entry point, or a line's signature) matches the operation with that method and path template. gRPC methods, consumed events, and schedules have no OpenAPI operation; a step names its kind ("gRPC: contract in payments.proto, not shown") instead of showing nothing.
- **What a contract shows** (a pure parser, `apps/web/src/contracts/openapi.ts`, resolves `$ref`s with a cycle guard, merges `allOf`, and lists `oneOf`/`anyOf` variants):
  - the operation ID, summary, and source file;
  - parameters (path, query, header) with type, required, and description;
  - the request body: content type, and a schema tree of fields with type, format, required, enum values, constraints, and description;
  - each response by status code (`201`, `202`, `400`, `409`, …) with its description and schema tree;
  - a generated JSON example of the request and of each response (from `example`, then `default`, `enum[0]`, and type defaults).
- **Where it shows.**
  - **Flow board:** a selected step whose entry point is an HTTP operation gets a **Contract** section in its step detail.
  - **Process view:** a message into an HTTP endpoint (a line's endpoint call, or a flow transition into such a step) has a disclosure button on its label. Opening it shows the contract under the arrow. The flow's start note offers the same for its first step.
- **Accessibility.** The schema is a nested list; the examples are `<pre>` blocks with a label; the disclosure is a button with `aria-expanded` and `aria-controls`.
- **Later.** Backend import of real OpenAPI files (JSON and YAML) behind the same `getOpenApi`, then AsyncAPI and proto in the same contract view.
