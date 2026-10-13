# Milestone 11.6 — UI polish: defects, quick search, and layout refinements

**Status:** implemented 2026-10-13 (closeout in `docs/IMPLEMENTATION_PLAN.md`).

**Source:** a real-browser review of all 30 audited pages at 1440, 768, and 390 px, both themes (2026-10-13). The product owner asked to "implement these recommendations": the defects found, a quick search across everything, the empty inspector, the map's opening zoom, the phone layout, flows on the Overview, clearer flow targets, and stale docs.

**Read first:** `docs/CONVENTIONS.md`; `docs/DECISIONS.md` ADR-033; `docs/ARCHITECTURE.md` (state ownership).

## Scope

### Defects (seen in screenshots)
1. **Events page:** the data-source badge is wider than the list column at 1440 px and runs into the detail. Badges wrap instead of overflowing.
2. **Flow board:** the zoom controls float over the swimlane and hide a step. They move to a toolbar above the canvas, so they never cover a step.
3. **Transit board, phone layout:** dependency labels are cut off at the right edge of the map. Labels are placed only inside the map, and the flat (phone) map reserves room on the right for dependency names.
4. **3D view:** labels pile up where entities cluster. Labels that overlap a more important label are hidden while they overlap (selected and hovered first, then unhealthy, then containers, then the rest). The check runs only when the camera moves.
5. **Truncated text:** names cut off with "…" get the full text as a tooltip, everywhere, from one shared mechanism.
6. **Header:** the disabled account placeholder is removed.

### Refinements
7. **Quick search (ADR-033).** The header's search button opens a search dialog (the design reference's command palette) that finds services and resources in the environment, business flows, event types, transit-board endpoints, and pages. It is a combobox with grouped results, operated by keyboard. Choosing a result opens it: an entity is selected (on the map or registry when you are there, else in the registry), a flow opens its board, an event type opens the catalog, an endpoint opens its line on the service board. **⌘K / Ctrl+K** opens it from anywhere. The last option filters the registry by the text. On phones the button is an icon. Typing never navigates by itself.
8. **Inspector only when useful.** On Overview, Dependencies, Infrastructure, Events, and Simulation, the inspector is hidden while nothing is selected. The map and registry keep the "Nothing selected" hint.
9. **Map opens at the selection.** When the map opens with a selected entity, it fits the entity and its direct neighbours, not the whole graph.
10. **Phone layout.** The header takes two rows instead of three: the search becomes an icon button, and the account placeholder is gone (built with item 7, in phase 3).
11. **Overview: business flows.** A card lists the environment's business flows with their warnings, linking to each flow board.
12. **Flow targets say what they measure.** The response-time target (p95) and its budget cover the synchronous steps. The completion target and completion times are end to end. The flow card labels each one that way.

### Housekeeping
13. **Stale docs:** `DEVELOPER_GUIDE.md` §8 (export) and `PRODUCT_SPEC.md` Q.2a (Milestone 11.1 "in progress").
14. **Test timeouts:** a 15 s default test timeout, so the full suite does not fail on a busy machine.
15. **Not fixable here:** the `THREE.Clock` deprecation warning in the 3D view comes from React Three Fiber 9.8.1, the latest stable release. It is documented, not suppressed.

## Out of scope
- Milestones 12–14.
- A visual flow editor, undo, merge import.
- Changing the swimlane's readable zoom (a 12-step flow still pans).

## Phases (each committed on its own; scope `m11.6`)
1. **Defects:** items 1–6 and 14.
2. **Layout:** items 8, 9, and 12.
3. **Quick search and the phone header:** items 7 and 10.
4. **Overview flows:** item 11.
5. **Close-out:** accessibility (jsdom and real browser), screenshots at 1440 and 390 px in both themes, docs (items 13 and 15).

## Acceptance criteria
- No element overflows its column on the Events page at 1440, 768, or 390 px. The flow board's controls do not overlap any step. No transit-map label extends past the map at 390 px.
- 3D labels do not overlap one another in the overview (checked by screenshot), and the declutter never writes global state.
- A truncated name shows its full text as a tooltip (unit-tested).
- Quick search finds an entity, a flow, an event type, an endpoint, and a page by name; Arrow keys, Enter, and Escape work; ⌘K / Ctrl+K opens it; results open the right page (tested).
- With nothing selected, the five section pages show no inspector; the map and registry show the hint.
- Opening `/map?sel=…` fits the selection's neighbourhood (tested).
- The header is two rows at 390 px (screenshot).
- The Overview lists flows with their warning counts and links (tested).
- axe passes in jsdom and the real browser in both themes. `npm run check` passes.
