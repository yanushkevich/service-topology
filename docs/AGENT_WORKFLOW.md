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
- Follow `docs/CONVENTIONS.md`: reuse the shared components and helpers, use token-only styling, keep functions and files to one subject, and respect the layers in both stacks.
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
7. scale/performance measurement when touching topology rendering or layout;
8. the review checklist in `docs/CONVENTIONS.md` §6.

Record exact commands and outcomes. If a command is unavailable, blocked, or not configured, state that; do not substitute a guess and claim success. Fix regressions caused by the change, not unrelated pre-existing failures unless asked.

## 5. Close out
- Compare implementation against every acceptance criterion; mark each pass/fail/not-run with evidence.
- Update milestone status, architecture decisions, API contracts, or user docs only if the actual state changed.
- Report changed files, checks run, observed results, limitations, risks, and next prerequisites.
- Commit the unit of work (§6), then stop at the requested milestone. Do not begin the next milestone without instruction.

## 6. Commit
Standing instruction: make a git commit after **every completed milestone or phase**. This instruction authorizes the commit; there is no need to ask each time.

**When**
- After the unit's checks pass (`npm run check`) and status docs (`IMPLEMENTATION_PLAN.md` tables, ADRs) are updated, so the commit contains the code and its documentation together.
- If checks fail and cannot be fixed within scope, do not commit the unit as complete. Report the failure and ask.
- Do not mix two milestones or phases in one commit. Several small commits inside one unit are fine. The final one completes it.

**Where**
- Commit directly on `main` (product-owner instruction, 2026-10-11). Do not create milestone or phase branches unless asked.
- Do not push, open a PR, or rewrite `main` history unless asked.

**What to stage**
- Stage explicit paths that belong to the unit (`git add src/... docs/...`). Never `git add -A` or `git add .` blindly.
- Leave unrelated user changes (e.g. edits in `docs/ui-frontend-mock/`) unstaged. Check `git status` and `git diff --cached --stat` before committing.
- Never commit `node_modules/`, `dist/`, secrets, or local screenshots.

**Message format** ([Conventional Commits](https://www.conventionalcommits.org/))
```
<type>(<scope>): <imperative summary, ≤ 72 chars, no trailing period>

<what was delivered and why, 2–6 lines or bullets>

Acceptance: <criteria met; anything partial or not run, stated plainly>
Checks: <exact commands and observed results, e.g. "npm run check — 53 tests pass, build ok">
Refs: <milestone/phase doc, ADRs touched>
```
- `type`: `feat` (new capability), `fix`, `refactor`, `test`, `docs`, `build` (deps/tooling), `chore`.
- `scope`: `m1`–`m5` for milestones, `phase-01`–`phase-11` for phases. Use a domain area (e.g. `domain`, `registry`) for changes outside a milestone.
- Example: `feat(m1): add domain model, mock repository, registry and inspector`.
- Never amend or rewrite published commits, force-push, or skip hooks (`--no-verify`).

**After committing**
- Report the commit hash and subject. Record the subject (or hash) in the `Commit/PR` column of the status table in the next docs update, since a commit cannot contain its own hash.

## UI-specific evidence
For substantial UI changes, inspect the running app at representative viewport sizes and capture screenshots when available. Check loading, empty, error, and populated states; keyboard focus; reduced-motion behavior; and interactions between selection, filtering, URL state, and inspector. A successful build alone does not establish visual correctness.

## Performance evidence
The target is 250 visible nodes and 750 visible edges, with 1,000 total entities navigable through search/filter/grouping/neighborhood exploration rather than fully detailed at once. Report hardware/runtime conditions, dataset shape, measurement method, and actual results. Do not claim the target is met without measurement.
