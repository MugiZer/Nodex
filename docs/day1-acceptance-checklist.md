# Day 1 Acceptance Checklist

This checklist is the merge gate for the Day 1 foundation and Round 2 runtime backbone.
It is intentionally implementation-oriented and should be used as the final go/no-go check before moving to generation orchestration.

## Gate

- [ ] Shared contracts compile from one source of truth in `lib/types.ts` and `lib/schemas.ts`.
- [ ] All route handlers use `try/catch` and return descriptive JSON errors.
- [ ] No route returns a bare `500`.
- [ ] Claude calls use `claude-sonnet-4-5` only.
- [ ] Embeddings use `text-embedding-3-small` only.
- [ ] Server code reads secrets from `process.env` only.

## Canonicalize

- [ ] `POST /api/generate/canonicalize` accepts `{ prompt: string }`.
- [ ] It returns either `{ subject, topic, description }` or `{ error: "NOT_A_LEARNING_REQUEST" }`.
- [ ] The subject is validated against the supported set.
- [ ] The topic is lowercase with underscores only.
- [ ] The description follows the exact four-sentence canonical contract.
- [ ] Malformed output is rejected by runtime validation before the route returns success.

## Retrieve

- [ ] `POST /api/generate/retrieve` accepts `{ subject, description }`.
- [ ] Retrieval filters by canonical subject before similarity ranking.
- [ ] Retrieval uses the canonical description as the embedding input.
- [ ] The similarity threshold is `0.85`.
- [ ] The route returns `{ graph_id }` on hit and `{ graph_id: null }` on miss.
- [ ] Flagged graphs do not win new-learner routing when an unflagged usable match exists.
- [ ] Retrieval behavior is covered by tests for hit, miss, and tie-break ordering.

## Graph Read

- [ ] `GET /api/graph/[id]` returns `{ graph, nodes, edges, progress }`.
- [ ] Progress is scoped to the authenticated learner only.
- [ ] The route never leaks another learner’s progress rows.
- [ ] Graph content and learner progress are fetched together.
- [ ] The read payload validates against the shared schema.

## Progress Write

- [ ] Progress writes persist pass and fail attempts.
- [ ] Pass writes set completion and increment node counters.
- [ ] Fail writes append attempts and do not clear completion.
- [ ] Unlock state is derived from completion plus hard prerequisites.
- [ ] Progress identity is treated as `(user_id, node_id, graph_version)`.
- [ ] The database must enforce one row per learner per node per graph version.
- [ ] In SQL terms, the `user_progress` uniqueness rule is `unique(user_id, node_id, graph_version)`.

## Database Alignment

- [ ] `graphs`, `nodes`, `edges`, and `user_progress` exist in Supabase.
- [ ] RLS is enabled on all four tables.
- [ ] The live DB matches the Day 1 migration baseline closely enough for the runtime path to work.
- [ ] The retrieval and progress paths can use the intended primary mechanism or a documented fallback without hidden behavior.
- [ ] Temporary smoke data can be created and removed cleanly.

## Smoke Checks

- [ ] Run the round 2 smoke against local/dev Supabase.
- [ ] Verify temporary graph insert and cleanup.
- [ ] Verify retrieval candidate selection.
- [ ] Verify graph readback.
- [ ] Verify progress fail path.
- [ ] Verify progress pass path.
- [ ] Verify downstream unlock visibility after a pass.
- [ ] Fail the smoke if any of the above steps rely on silent behavior.

## Repo Verification

- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run round2:smoke` passes.
- [ ] The checklist is only complete when the repo verification is green on the current tree.

## Exit Rule

- [ ] If every item above is checked, Day 1 is complete and the team can proceed to Day 2 generation workflow work.
