# Generation Flow

This file is the authoritative lower-level reference for pipeline sequencing, stage ownership, adaptive diagnostic flow, unlock behavior, and visual fallback.

## MVP Operating Mode

The live product path is currently optimized for demo reliability.

- `POST /api/generate` should prefer returning a usable graph skeleton plus solid lessons and visuals over failing on repairable or non-critical purity defects.
- The primary live-product risk to reduce is visible failure during generation, not minor hidden curriculum drift.
- Strict validation still matters, but strict failure should be concentrated in debug and development-oriented graph routes when possible.
- When the system can repair or safely simplify a graph without inventing misleading topic content, it should do that instead of surfacing a learner-facing error.
- A stable end-to-end graph for multiple subjects is more important than perfect topic-boundary purity in the live demo path.

## Master Pipeline Order

1. `POST /api/generate/canonicalize`
2. `POST /api/generate/retrieve`
3. If `graph_id` exists, return `{ graph_id, cached: true }`
4. Otherwise call `POST /api/generate/graph`
5. Then persist the reconciled graph skeleton through `POST /api/generate/store`
6. Return `{ graph_id, cached: false }` as soon as the skeleton is stored
7. Delegate `POST /api/generate/enrich` for the deterministic first node slice
8. Enrich the selected nodes in bounded node-sized subcalls, preserving deterministic path selection while allowing a small fixed concurrency for execution
9. Keep remaining nodes at `lesson_status = "pending"`

## Route Shape Snapshot

- `POST /api/generate/canonicalize` returns `{ subject, topic, description }`
- `POST /api/generate/retrieve` returns `{ graph_id }` or `{ graph_id: null }`
- `POST /api/generate/graph` returns `{ nodes, edges }`
- `POST /api/generate/graph?debug=1` may return `{ nodes, edges, debug }` in development/test only
- Debug output includes `request_id` plus validator issue counts, validator issue-key counts, reconciliation path telemetry, outcome buckets, curriculum audit status, an explicit synchronous placeholder marker for curriculum, and timings for graph-route troubleshooting
- `GET /api/generate/graph/audit?request_id=...` returns the persisted detached curriculum audit record when available
- Direct debug callers may provide explicit `prerequisites` and `downstream_topics` boundary fields; when present, they are used for deterministic boundary checks, and when absent the graph route does not try to reverse-engineer them from prose
- `POST /api/generate/lessons` returns a stage result envelope whose `data` carries nodes enriched with `lesson_text`, `quiz_json`, and `static_diagram`
- `POST /api/generate/diagnostics` returns a stage result envelope whose `data` carries nodes enriched with `diagnostic_questions`
- `POST /api/generate/visuals` returns a stage result envelope whose `data` carries nodes with `p5_code` and `visual_verified`
- `POST /api/generate/store` returns a stage result envelope whose `data` carries `{ graph_id, duplicate_of_graph_id?, write_mode, remapped_node_count, persisted_node_count, persisted_edge_count }`
- If the live Supabase schema cache does not resolve `public.store_generated_graph`, the store stage may fall back to direct table writes while preserving the same persisted node and edge contract
- `POST /api/generate/enrich` returns `{ graph_id, request_id, selected_node_ids, processed_node_ids, ready_node_ids, failed_node_ids, remaining_pending_node_ids }`
- `POST /api/generate` returns `{ graph_id, cached }`
- `GET /api/graph/[id]` returns `{ graph, nodes, edges, progress }`
- `POST /api/graph/status/[requestId]/diagnostic` stores the learner-scored prerequisite bundle on the server for the resolved graph
- `GET /api/graph/[id]/diagnostic` returns the server-backed prerequisite bundle for graph rehydration
- `GET /api/graph/[id]/lesson/[nodeId]` resolves persisted and prerequisite lesson nodes through one server-backed contract
- `GET /api/graph/[id]` and the store duplicate recheck / retrieval fallback paths all probe the live DB surface before parsing rows; a missing required column or function is a schema contract failure, not a content failure

## Graph Pipeline Ownership

- Stage 1: Generator proposal
- Stage 2: Deterministic structure validation
- Stage 3: Bounded curriculum audit
- Stage 4: Reconciler

The generator, curriculum validator, and reconciler are isolated Claude calls with only explicitly passed input and no hidden shared context.
Structure validation is server-owned deterministic code by default because graph mechanics, topology legality, and acceptance/rejection are truth-defining checks.
If a future implementation adds a bounded model-assisted structure audit, its findings are advisory inputs that must still pass deterministic server validation before acceptance.
The curriculum validator is an advisory audit rather than a truth-defining acceptance gate.
Both graph-generation entrypoints launch that audit as a detached best-effort task after the synchronous graph path is already on track to complete, so curriculum never blocks graph delivery.
The synchronous graph response uses a placeholder curriculum state that is explicitly marked as non-final.
The detached audit has its own completion lifecycle, persisted audit record, and follow-on log event family.
If it returns accepted findings in budget, the reconciler sees them alongside the deterministic structure output.
If it times out or fails contract validation, the detached audit still records that failure class without changing synchronous graph acceptance.
The curriculum validator and deterministic structure validation are independent, and the reconciler only sees the original graph plus both accepted validator outputs when those outputs are available synchronously.
Every stage output is machine-validated before the next stage runs.
The server may apply deterministic graph normalization and deterministic local repair before escalating to the LLM reconciler, as long as those steps remain mechanical and do not invent new topic content.
- In MVP mode, `POST /api/generate` may allow repairable generator defects to proceed into deterministic repair or reconciler stages instead of failing immediately, while `POST /api/generate/graph` remains the stricter debugging surface.
- In MVP mode, live generation may fall back to a simpler deterministic DAG when a generated graph cannot be repaired safely enough for the demo path.
- In MVP mode, parsed-but-imperfect live graph drafts should be treated as repair candidates: top-level shape failures remain fatal, but structural defects should be sanitized, validated, and repaired instead of aborting the request.
- In MVP mode, incremental enrichment is fail-soft: malformed lessons or diagnostics should persist `null` artifacts and keep the node pending, while broken visuals remain non-blocking and should fall back without interrupting learner flow.
- In MVP mode, `POST /api/generate` may also degrade canonicalization to a deterministic fallback after a bounded draft timeout plus invalid repair output, while `POST /api/generate/canonicalize` remains the strict debugging surface for canonicalize contract failures.

## Stage Ownership

- `graph` owns validated `nodes[]` and `edges[]`
- `lessons` owns `lesson_text`, `quiz_json`, and `static_diagram`
- `diagnostics` owns `diagnostic_questions`
- `visuals` owns `p5_code` and `visual_verified`
- The visuals route consumes graph draft node metadata and deterministically selects a template or fallback from that node context
- `store` persists the skeleton immediately after reconciliation and later persists per-node enrichment updates against the stored node UUIDs
- Store inputs and DB-returned rows do not share the same timestamp contract.
- Store-route request bodies and internal orchestration timestamps stay on the strict ISO-with-offset schema.
- DB-returned rows in duplicate recheck, retrieval, graph read, and curriculum audit paths use the shared DB timestamp schema, which normalizes verified Supabase/PostgREST transport shapes before those values enter domain schemas.
- The runtime DB row type source is `supabase/database.types.ts`; `lib/supabase.ts` aliases that generated contract instead of maintaining a separate handwritten table model.
- Live surface verification is centralized in `lib/server/db-contract.ts` and must be used whenever a critical route depends on a required Supabase table, column, or RPC.
- Manual smoke replay and deployment should call the shared preflight gate (`npm run db:preflight`) before graph readback or store replay starts
- Required DB surfaces now follow a latest-schema policy, but `lesson_status` is no longer part of the required live `graph_read.nodes` surface. Graph read derives `lesson_status` deterministically when the column is absent so the API payload stays stable for the demo path.
- The store duplicate recheck path must use a parse helper that adds schema name and phase details to DB-row parse failures; do not let raw Zod issues escape without parse-site context.
- Stages 7 through 10 must emit one shared typed result envelope with searchable `code`, broad `category`, `retryable`, and structured `details` on failure, plus warnings for non-blocking conditions such as visual fallback

## Retrieval and Cache Behavior

- Retrieval happens after canonicalization
- Subject filtering happens before vector similarity search
- Current cosine similarity threshold is `0.85`
- If best match `>= 0.85`, return the cached `graph_id`
- If best match `< 0.85`, return `null` and trigger generation
- If multiple candidates pass threshold, prefer highest similarity, then unflagged, then highest version, then newest row
- If only flagged candidates pass threshold for a new learner, treat retrieval as a miss and generate a new graph

Current query pattern:

```sql
SELECT id, 1 - (embedding <=> '[vector]'::vector) AS similarity
FROM graphs
WHERE subject = '[subject]'
ORDER BY similarity DESC
LIMIT 1;
```

## Adaptive Diagnostic Logic

- Start at mid-graph node using `Math.floor(totalNodes / 2)`
- Correct answer moves up 2 positions
- Wrong answer moves down 2 positions
- After 8 questions, entry point is the highest position answered correctly
- Diagnostic scoring is client-side and requires no API call
- The diagnostic flow is adaptive placement, not mastery certification
- The diagnostic flow is driven by node-linked questions rather than an API-backed scoring pass
- Diagnostic questions are generated and stored server-side as part of the content pipeline
- Diagnostic answers and scoring remain client-side and are not written back during the placement flow
- The result is used to illuminate the learner's entry point before node interaction

## Node Unlock Logic

- A node is available when all incoming `hard` prerequisites are completed
- `soft` prerequisites never block unlocking
- Unlock eligibility is based only on hard edges whose `to_node_id` is the current node
- Soft edges are contextual only and display as dashed lines
- On quiz pass, downstream nodes are re-evaluated immediately
- On quiz fail, unlock state does not change

### Quiz Pass Effects

1. Add `{score, timestamp}` to `user_progress.attempts`
2. Set `user_progress.completed = true`
3. Increment `node.pass_count` and `node.attempt_count`
4. Recompute downstream availability from hard prerequisites
5. If `attempt_count > 10` and `pass_count / attempt_count < 0.4`, set `graphs.flagged_for_review = true`

### Quiz Fail Effects

1. Add `{score, timestamp}` to `user_progress.attempts`
2. Increment `node.attempt_count`
3. Do not mark completed

## Visual Fallback

- If `visual_verified` is `true`, render `p5_code` in `P5Sketch`
- If `visual_verified` is `false`, render `static_diagram`
- Broken interactive visuals must never block learning flow
- If the interactive sketch is not trustworthy, the system should fall back rather than fake it
- `static_diagram` is owned by the lessons stage and consumed by the visuals stage as the fallback artifact

## Demo Flow

1. Student types "I want to learn calculus"
2. System canonicalizes and retrieves or generates a graph
3. Adaptive diagnostic runs and graph illuminates with an entry point
4. The client persists the prerequisite bundle server-side and blocks lesson entry until the target node resolves through the lesson resolver
5. Student clicks an available node and sees lesson plus visual
6. Student passes quiz and the node turns green
7. Next node unlocks
8. Demo pitch emphasizes low generation cost and unlimited reuse

## Auth and Progress Snapshot

- Supabase anonymous sessions are used for learner identity
- On first visit, call `supabase.auth.signInAnonymously()`
- Persist `session.user.id` as `user_id` in all `user_progress` records
- No email or password is required for V1
- Attempt history is stored on `user_progress`
- Completion is stored on `user_progress`
- Progress is pinned to the graph version the learner started on
- New learners use the latest valid graph version
- Existing pinned learners may continue on a flagged version; new learners and restarts should prefer the latest usable unflagged version
