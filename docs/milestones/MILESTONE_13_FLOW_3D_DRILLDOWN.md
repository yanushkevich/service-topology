# Milestone 13 — 3D drill-down from a flow into its services

**Status:** implemented 2026-10-13, then removed 2026-10-13 (Milestone 13.3; product owner: "i dont need 3d in business flows"). The code is in git history: `2dd01f4`, `c85f26a`, `b193f4a` (Milestone 13) and `cdd6f8b`, `a5b7288` (13.1); removed in `c43ea3c`.

**Read first:**
- `docs/BUSINESS_FLOWS.md` Revision 2, section 13;
- `docs/DECISIONS.md` ADR-026 and ADR-011;
- `docs/3D_GALAXY_EXPERIENCE.md`;
- `docs/CONVENTIONS.md` §3.4 (the 3D palette exception).

## Phases
1. **Scene model (pure).**
   - The swimlane plane and the service planes stacked in 3D from the existing layouts' plane coordinates.
   - Shafts from each step to its line's entry station.
   - Tested in jsdom like `sceneModel`.
2. **Scene.**
   - React Three Fiber, drei, `@react-three/postprocessing` (Bloom), and `maath`, versions pinned.
   - Instanced stations, lines, and shafts, with crisp labels.
   - Tested with `@react-three/test-renderer`.
3. **Navigation.**
   - `CameraControls` fly-down and climb-back (Escape), the scope in the URL, and selection shared with 2D.
   - Replay particles on the playback clock, never stepped from frames.
4. **Close-out.**
   - Fallback without WebGL, reduced motion, `bench:3d` timings at 12 steps × 6 boards, screenshots, and docs.

## Acceptance criteria
- The view is lazy-loaded. Without WebGL it falls back to 2D with a message. The lists remain the accessible path.
- Entering a service and climbing back is reversible and keeps the selection (tested).
- No Three.js object is stored in Zustand, and no global state is written per frame (tested by the existing frame-loop guard).
- Timings are recorded in `docs/BENCHMARKS.md`. `npm run check` passes.
