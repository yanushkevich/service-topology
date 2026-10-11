# Revision 3 Changelog — Claude Code Readiness

## Goal
Make the documentation package easier for Claude Code to use on a multi-step implementation without loading the entire documentation archive into every session. The structure follows the principles in Anthropic's current Claude Code documentation: concise root instructions, on-demand skills, scoped workflows, and evidence-based verification.

## Added
- Root `CLAUDE.md` with concise project-wide invariants and source-of-truth precedence.
- `docs/README_INDEX.md` with task-based navigation and conflict-resolution rules.
- `docs/AGENT_WORKFLOW.md` for explore → plan → implement → verify → closeout.
- `docs/DECISIONS.md` with current architectural direction and an ADR template.
- Five on-demand skills under `.claude/skills/`: `topology-domain`, `topology-milestone`, `topology-ui`, `topology-verify`, and `topology-docs`.
- Claude Code operating guidance in milestone prompts and the reusable phase prompt template.

## Structure and context policy
- Keep root instructions short and stable; detailed workflows load through skills.
- Read only the relevant milestone and documentation sections rather than the whole corpus.
- Treat archived Revision 1 content as historical, not active instruction.
- Explicitly distinguish proposed API direction from implemented APIs.
- Require observable evidence for tests, visual inspection, accessibility, and performance claims.

## Not claimed
- This package is still documentation, not an implemented application.
- No test suite, build, app launch, or performance benchmark was run as part of this documentation-only restructuring.
- The proposed application source tree and scripts must be confirmed in the actual implementation repository before commands or per-directory instructions are prescribed.

## External guidance consulted
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/large-codebases
