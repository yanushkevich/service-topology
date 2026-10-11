# Agent Workflow and Verification Contract

This is the repeatable procedure for implementation sessions. The root `CLAUDE.md` contains only global rules; detailed procedures belong here and in skills.

## 1. Orient
- Confirm the working directory and inspect `git status` before editing.
- Inspect the real repository structure and package scripts; do not assume the proposed source tree already exists.
- Read `docs/README_INDEX.md`, then the relevant product/architecture sections and exactly one milestone prompt.
- Identify existing conventions, tests, current changes, and any conflict with the requested scope.

## 2. Plan
For changes spanning multiple files, data contracts, or user-visible behavior, summarize:
- intended behavior and out-of-scope work;
- files/modules likely to change;
- domain/state/rendering boundaries affected;
- tests and visual verification to run;
- risks, unknowns, and decisions requiring user input.

Do not spend a planning phase on a truly trivial one-line change.

## 3. Implement
- Follow existing repository patterns unless they conflict with an approved architecture decision.
- Keep changes small and cohesive; avoid unrelated refactors and unnecessary dependencies.
- Keep domain logic renderer-independent; derive renderer-specific nodes/edges through adapters.
- Treat infrastructure containment as hierarchy, not a communication edge.
- Keep mock data deterministic and label simulated data in the UI.
- For layouts, ensure deterministic results for the same input and test overlap/edge cases.
- Preserve accessibility: keyboard use, visible focus, reduced motion, and documented contrast targets.

## 4. Verify
Discover actual scripts before invoking them. Run the smallest relevant checks first, then broader checks where available:
1. focused unit/component tests;
2. type check;
3. lint/static analysis;
4. production build;
5. integration/e2e tests relevant to the change;
6. running-app visual inspection for meaningful UI changes;
7. scale/performance measurement when touching topology rendering or layout.

Record exact commands and outcomes. If a command is unavailable, blocked, or not configured, state that; do not substitute a guess and claim success. Fix regressions caused by the change, not unrelated pre-existing failures unless asked.

## 5. Close out
- Compare implementation against every acceptance criterion; mark each pass/fail/not-run with evidence.
- Update milestone status, architecture decisions, API contracts, or user docs only if the actual state changed.
- Report changed files, checks run, observed results, limitations, risks, and next prerequisites.
- Stop at the requested milestone. Do not begin the next milestone without instruction.

## UI-specific evidence
For substantial UI changes, inspect the running app at representative viewport sizes and capture screenshots when available. Check loading, empty, error, and populated states; keyboard focus; reduced-motion behavior; and interactions between selection, filtering, URL state, and inspector. A successful build alone does not establish visual correctness.

## Performance evidence
The target is 250 visible nodes and 750 visible edges, with 1,000 total entities navigable through search/filter/grouping/neighborhood exploration rather than fully detailed at once. Report hardware/runtime conditions, dataset shape, measurement method, and actual results. Do not claim the target is met without measurement.
