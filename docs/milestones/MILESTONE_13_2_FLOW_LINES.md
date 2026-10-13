# Milestone 13.2 — Which lines each step uses: the step-to-service drill-down in 2D

**Status:** specified 2026-10-13.

**Source:** the product owner agreed that the 3D drill-down stays an optional "explain the flow end to end" view, and asked for the 2D alternative: "a clearer step-to-service-board drill-down and a flow overview of which lines each step uses … implement it".

## Today
- A selected step's card names its entry point and links to the service board. You must leave the flow to see what the step does inside the service.
- Nothing shows the whole flow's mapping onto lines. Unmapped steps, services without a board, and entry points that match no line are silent.

## Design
1. **Lines strip on the flow board** (`strip=lines`, beside Stages and Process): one row per step, typical path first, with:
   - the step and its service;
   - the line it enters (badge, name, and signature), or why there is none: *no board* (the service has no transit board), *no matching line* (the entry point matches no line), or *no entry point*;
   - where the line goes: the dependencies it reaches;
   - its policies (count, and how many are missing);
   - the line's p95 and error rate, for the board's window.

   A summary above the table says how many steps map to lines on how many boards. Selecting a row selects the step (the shared `step` parameter); below the table, the selected step's line is shown as the service board's stop strip (every stop, with stats).
2. **"Inside the service" in the step card.** For a mapped step, the card shows the line, its route as an ordered list (stations, and the policies on each client), and **Open line A2 on the Payment Service board**, which opens that line on the service board with the flow highlighted. For an unmapped step, the card says why and what would fix it (author a board, or align the entry point with a line's name or signature).
3. **One read model** (`transit/flows/flowLines.ts`, pure, tested) feeds both. The stop list of a line moves from the stop strip component into `transit/board.ts` (`lineStops`), so the board and the flow card share it.

## Out of scope
- New data: a step maps to a line only where its service has a board.
- Changing step-to-line matching (`lineForStep`: by name or signature).

## Phases (scope `m13.2`)
1. **Read model:** `flowLineRows`, `flowLinesSummary`, `lineStops`.
2. **UI:** the Lines strip with its table and stop strip, and the step card's Inside block.
3. **Close-out:** accessibility (jsdom and the real browser), screenshots, docs.

## Acceptance criteria
- Checkout's 12 steps are listed in typical-path order. The 4 Payment Service steps map to A1, A2, W1, and A4; the others say *no board* (tested).
- An entry point that matches no line says *no matching line* (tested).
- Selecting a row selects the step and shows its line's stop strip; the step card shows the route and the link to the line on the board (tested).
- axe passes in jsdom and the real browser, both themes; `npm run check` passes.
