# Orrery — Service Topology & Registry — design reference

This is a design mockup created in a visual design tool, exported as
standalone pages. Treat it as a REFERENCE MOCKUP, not production code:
the markup and inline styles carry the design's precise values — colors,
font sizes, spacing, radii, shadows, layout — which an implementation
should replicate faithfully in its own components and styling system
rather than copy wholesale.

Source of truth: the "Service Topology & Registry Platform" design canvas
(https://claude.ai/artifact/S3frZdoYPtXsSCyJAvYJog), imported 2026-10-10
from version `1791677980-c71c`. If the canvas changes, re-import rather
than hand-editing these files.

## Contents

Artboards (Design Components: an `<x-dc>` template + a small logic class).
The values to replicate live in their inline `style="…"` attributes and
`<helmet><style>` blocks.

- `Main.dc.html` — interactive prototype: workbench, galaxy, registry
  (1440 wide, fluid page).
- `Foundations.dc.html` — visual direction and type language: per-resource-type
  glyphs (service, gateway, database, cache, topic, queue, external, cluster,
  namespace, instance) and status shapes (ok / warn / crit).
- `States.dc.html` — status, empty and fallback states (1440×1180).
- `canvas.json` — the canvas index (artboard titles, frames, order).

Runtime only, not part of the design: `support.js`, `vendor/react*.js`
(the top-level `react*.js` copies are duplicates of `vendor/`). The local
copies load `vendor/react*.js` before `support.js`; the canvas versions do not.

Fonts: Geist and Geist Mono via Google Fonts (network required).

## Viewing

Serve the folder (e.g. `python3 -m http.server`) and open any `*.dc.html`;
some browsers block the scripts over file://.
