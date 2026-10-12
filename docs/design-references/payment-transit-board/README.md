# Payment Service Transit Board (design reference)

A single-page concept exported from a claude.ai artifact
(https://claude.ai/artifact/BrmV6rhi3wrKXJ4CT5th5N, version `1791834848-f24b`, pulled 2026-10-12).
It is a design reference, not production code. The implementation spec is `docs/TRANSIT_BOARD.md`, which wins where they differ. The planned work is Milestone 9.

**What it shows:** one service (Payment Service) drawn as a transit network.
- Every endpoint, consumed event, scheduled job, or background worker is a "line".
- Stations are callers, entry gates, domain modules, clients, and dependencies.
- Diamonds on the client lanes are resilience policies (timeout, retry, bulkhead, breaker). Dashed diamonds mark missing ones.
- Each route is tagged with where it comes from: declared, observed, or inferred.

**Layout:**
- a searchable line index;
- a perspective SVG transit map;
- a stop-by-stop strip;
- a line card with a "Trace replay" mode that steps through example requests.

**Data:** all of it is invented example data, labelled "example data" in the header. It must never be presented as observed or live.

**Look:** dark-only, using its own palette (`--ground #05060b`, `--cy #5fe1ff`, `--ok`, `--warn`, `--fail`) and Geist / Geist Mono from Google Fonts. These are not the app's tokens. If any of it is built for real, map it onto `apps/web/src/styles/tokens.css` and pass the contrast test. Do not copy the markup or the inline runtime.

**View:** `python3 -m http.server -d docs/design-references/payment-transit-board`, then open http://localhost:8000. It needs network access for the fonts.
