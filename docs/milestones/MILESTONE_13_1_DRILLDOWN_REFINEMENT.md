# Milestone 13.1 — 3D drill-down refinement: show the flow, not every board

**Status:** specified 2026-10-13.

**Source:** product owner, with a screenshot of the Checkout drill-down: "transit board and flows 3d needs refinement, it does not look good … transit board shows everything in this view". Refines ADR-026 (Milestone 13).

## What is wrong today (analysis of the screenshot and our own at 1440 px, both themes)
1. **Every board shows everything.** Payment Service draws all 11 lines and 31 stations; Checkout enters 4 of them (Authorize, Capture, Void, the settlement webhook). At overview scale the plane is a knot of colour, and the flow's own path through the service is not visible.
2. **No hierarchy on the flow plane.** Lane strips are nearly invisible, steps are grey slivers, transitions are grey hairlines, and every label has the same weight. Lane captions run off the left edge ("…ER SERVICE").
3. **Empty planes dominate.** Five of six services have no board. Each still gets a full-width slab with "no board yet", and their name labels stack in the middle of the view.
4. **Shafts read as noise:** thin dashed diagonals across the scene, because each plane is centred under its lane, not under the steps that enter it.
5. **It looks worse than the 2D board.** The 2D map has thick ribbon lines, white station capsules with dark rings, and policy diamonds; the 3D planes have hairlines and coloured dots.
6. **The overlay covers the scene:** the open services list takes a fifth of the canvas.

## Design
- **D1. The flow's lines only.** A service plane shows the lines this flow's steps enter (all their branches), their stations, the policy diamonds on them, and the dependencies they reach. Other lines are hidden. Inside an entered service, **Show all N lines** adds them, thin and dimmed. The plane is fitted to what it shows, at one scale for every service.
- **D2. Planes under their steps.** A plane is placed so that its flow lines' entry stations sit under the steps that enter them (mean x), so shafts drop almost vertically.
- **D3. Pads for services without a board.** A compact tile instead of a slab ("No transit board yet"), with a short dashed stub from each of its steps. The flow plane gets correspondingly shallower.
- **D4. A readable flow plane.** A caption gutter on the left of the plane, so lane names never collide with steps or leave the view. Alternating lane strips. Steps are raised tiles in the flow's colour; transitions are lines in the flow's colour with arrowheads.
- **D5. Shafts as beams** in the flow's colour, solid. The selected step's beam is bright (bloom in the dark theme); the others are quieter.
- **D6. The 2D board's language.** Flow lines are thick ribbons in their line colours; stations are white discs with dark rings (`--transit-station`, `--transit-station-ring`); policy diamonds in `--transit-policy-*`; a faint grid on each plane.
- **D7. Focus.** Selecting a step brightens its line on its plane and dims the other flow lines. Entering a service fades the flow plane and the other planes, and lists the flow's steps there, with their line codes.
- **D8. Quieter chrome.** The services list starts collapsed. Plane names sit on the plane's front edge, left-aligned, with "4 of 11 lines". A Reset view button.
- **D9. Labels by importance** (declutter): selected step, steps, plane names, then stations. Stations are labelled only inside the entered service, and only those on the shown lines.

## Out of scope
- New data: services still need an authored or observed board to show lines.
- A different layout algorithm for boards: planes keep the transit layout's (u, v) positions.

## Phases (scope `m13.1`)
1. **Model:** flow lines, fitted planes, pads and stubs, under-step placement, policy stops, caption gutter.
2. **Scene:** visual language (ribbons, discs, diamonds, beams, tiles, arrows, grid), focus and fading.
3. **Overlay:** collapsed services list, the entered service's steps, Show all lines, Reset view.
4. **Close-out:** tests, screenshots at 1440 and 390 px in both themes, real-browser audit, benchmark, docs.

## Acceptance criteria
- A plane shows only its flow lines by default; Show all lines adds the rest, dimmed (tested on the model and the scene).
- Services without a board are pads, with stubs from their steps (tested).
- Every shaft ends at its line's entry station, and planes are placed under their steps (tested).
- No lane caption leaves the plane; labels do not overlap (declutter); screenshots reviewed in both themes.
- The real-browser audit passes; `npm run check` passes; benchmark re-run and recorded.
