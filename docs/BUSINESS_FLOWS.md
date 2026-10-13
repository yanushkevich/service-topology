# Business flows on the transit board — specification

**Source:** product owner, 2026-10-12. The transit board should be a business flow, showing the steps of a business process while keeping its model of policies, retries, and so on. Decisions on the proposal:
1. **Option B:** the flow level goes on top, and today's per-service board becomes the drill-down of a step.
2. **Both sources:** flows are authored in the app *and* imported from workflow definitions.
3. **Replay included:** replaying a business transaction by its business key is part of the first release.

**Status:** implemented on example observed data (Milestone 10 and B8, 2026-10-12; closeouts in `docs/IMPLEMENTATION_PLAN.md` and `docs/backend/IMPLEMENTATION_PLAN.md`). The section "Implementation notes" at the end records the decisions made while building it. Decision: ADR-022, which amends ADR-021. This spec extends `docs/TRANSIT_BOARD.md` and supersedes its "out of scope: cross-service business flows".

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
- **Flow budget:** each synchronous step on the typical path counts its incoming call timeout × retry attempts, else its own deadline. Waits are excluded.
- **Findings:**
  - Retry amplification reads the inner retries from the step's service transit board: the clients of the line that implements the step.
  - Missing compensation flags any step that can still reach both a success outcome and a non-success outcome, has no compensation, and is not the start, a decision, a wait, or a compensation step.
- **Example observed data:** `apps/web/src/transit/flows/exampleFlows.ts`, behind `TransitRepository` (`getFlowStats`, `getTransactions`, `getTransaction`). It includes 8 Checkout and 3 Refund transactions. Waits, and any step longer than 6 s, are compressed to at most 1.5 s on the replay clock, with their real duration labelled.
