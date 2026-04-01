# Foundation Context Index

This folder splits the large `AGENTS.md` into smaller topical files so agents can load only the context they need.
It is a working index for the split context, not a replacement for the original source dump.

## Authority Model

- `AGENTS.md` is the raw source dump that this split was derived from.
- Files in `context/` are the working split for implementation and cleanup.
- When `AGENTS.md` and `context/*` disagree, `context/*` is authoritative for implementation.
- `context/01-overview.md` through `context/06-prompt-visuals-and-diagnostics.md` are authoritative for the lower-level rules they cover.
- `context/07-pack-domain-db-retrieval.md`, `context/08-pack-orchestration-prompts-content.md`, and `context/09-pack-progress-frontend-ops.md` are now resolved pack files, not open decision prompts.
- `context/99-known-contradictions.md` is now primarily a resolution ledger showing how the earlier collisions were closed.
- If a file in `context/` disagrees with `context/99-known-contradictions.md`, treat that as a regression to fix rather than an intentional ambiguity.
- If a topic is still duplicated or ambiguous in the source, preserve that ambiguity in `context/99-known-contradictions.md` instead of silently choosing a side.
- Keep the original meaning of `AGENTS.md` visible in the relevant split file instead of compressing it away.

## How To Use

- Load the narrowest file that covers the task.
- If a task crosses boundaries, load the relevant adjacent files too.
- Prefer the most specific file for a topic over broader summary files.
- Treat `07`-`09` as authoritative pack-level references that inherit and extend the lower-level files.
- If a task touches model prompts or stage outputs, load the prompt files directly instead of inferring them from the overview.
- If a task touches schema, auth, retrieval, or persistence, load the data/API file and the relevant pack files together.
- If a task touches learner state, UI flow, or deployment/testing, load the progress/frontend/ops pack first and use the contradiction ledger only for historical closure notes.
- When in doubt, read the file closest to the concern first, then expand outward only as needed.

## Files

- `context/01-overview.md`
  - Project summary, stack, absolute rules, file map, demo flow, and top-level warnings
- `context/02-data-and-api.md`
  - Database schema, data shapes, API contracts, auth basics, retrieval threshold, and query shape
- `context/03-generation-flow.md`
  - Master pipeline order, graph pipeline roles, diagnostic logic, unlock logic, visual fallback, and demo flow
- `context/04-prompt-canonicalize-and-graph.md`
  - Canonicalize prompt and graph generator prompt, including validation and example graph behavior
- `context/05-prompt-validators-and-reconciler.md`
  - Structure validator, curriculum validator, reconciler prompts, output schemas, and repair rules
- `context/06-prompt-visuals-and-diagnostics.md`
  - Visual generation prompt and diagnostic question prompt, plus validation and retry rules
- `context/07-pack-domain-db-retrieval.md`
  - Domain Contract Pack, Database + Auth Pack, Retrieval + Caching + Regeneration Pack
- `context/08-pack-orchestration-prompts-content.md`
  - Generation Orchestration Pack, Prompt / Output-Schema Pack, Graph Content Rules Pack
- `context/09-pack-progress-frontend-ops.md`
  - Progress + Diagnostic + Unlock Pack, Frontend Contract Pack, Ops / Deployment / Logging / Tests / Acceptance Criteria Pack
- `context/99-known-contradictions.md`
  - Current unresolved conflicts, duplicated authority, and policy gaps extracted from the source file

## Load Order

- Start with `context/01-overview.md` for global project rules and non-negotiables.
- Use `context/02-data-and-api.md` for schema, API, auth, retrieval, and data-shape contracts.
- Use `context/03-generation-flow.md` for pipeline sequencing, diagnostic flow, unlock flow, and visual fallback behavior.
- Use `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, and `context/06-prompt-visuals-and-diagnostics.md` for prompt-stage contracts and stage outputs.
- Use `context/07-pack-domain-db-retrieval.md`, `context/08-pack-orchestration-prompts-content.md`, and `context/09-pack-progress-frontend-ops.md` for the larger spec packs and implementation-facing decisions.
- Use `context/99-known-contradictions.md` to understand how prior collisions were resolved and to spot any regressions.
- If a task spans multiple concerns, load all affected files together instead of assuming one file is enough.

## Editing Rule

- When updating the split, keep the original meaning of `AGENTS.md` visible in the relevant file.
- Do not compress away important caveats, examples, or validation rules just because a file is an index or summary.
- If a section becomes ambiguous again, add it back to `context/99-known-contradictions.md` rather than silently choosing a side.
- Prefer adding explicit notes over deleting source intent when a split file is still carrying contradictory instructions.
- Treat the split as the working canonical context for implementation, with `context/99-known-contradictions.md` kept as the historical contradiction ledger and future regression tracker.
