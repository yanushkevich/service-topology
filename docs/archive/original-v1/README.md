# Service Topology Agent Documentation

This bundle includes three core documents and one prompt per phase.

- `docs/PRODUCT_SPEC.md`: product vision, workflows, requirements, non-goals, acceptance criteria.
- `docs/ARCHITECTURE.md`: domain model, module boundaries, data flow, state ownership, adapters, testing.
- `docs/IMPLEMENTATION_PLAN.md`: ordered phases, dependencies, acceptance criteria, status tracking.
- `docs/PHASE_PROMPT_TEMPLATE.md`: reusable prompt template for future iterations.
- `docs/phases/PHASE_00_...md` through `PHASE_11_...md`: phase-specific copy/paste prompts.

Recommended workflow:
1. Put `docs/` into the project repository.
2. Ask the coding agent to read the three core docs and Phase 00.
3. Execute one phase at a time by providing its prompt.
4. Review the changes and actual check results before approving the next phase.
5. Keep phase status aligned with the actual repository state; prompts are not proof of completion.
