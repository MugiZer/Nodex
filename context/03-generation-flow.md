# Generation Flow

This file is the authoritative lower-level reference for pipeline sequencing, stage ownership, adaptive diagnostic flow, unlock behavior, and visual fallback.

## Master Pipeline Order

1. `POST /api/generate/canonicalize`
2. `POST /api/generate/retrieve`
3. If `graph_id` exists, return `{ graph_id, cached: true }`
4. Otherwise call `POST /api/generate/graph`
5. Then `POST /api/generate/lessons`
6. Then `POST /api/generate/diagnostics`
7. Then `POST /api/generate/visuals`
8. Then `POST /api/generate/store`
9. Return `{ graph_id, cached: false }`

## Route Shape Snapshot

- `POST /api/generate/canonicalize` returns `{ subject, topic, description }`
- `POST /api/generate/retrieve` returns `{ graph_id }` or `{ graph_id: null }`
- `POST /api/generate/graph` returns `{ nodes, edges }`
- `POST /api/generate/lessons` returns nodes enriched with `lesson_text`, `quiz_json`, and `static_diagram`
- `POST /api/generate/diagnostics` returns nodes enriched with `diagnostic_questions`
- `POST /api/generate/visuals` returns nodes with `p5_code` and `visual_verified`
- `POST /api/generate/store` returns `{ graph_id }`
- `POST /api/generate` returns `{ graph_id, cached }`
- `GET /api/graph/[id]` returns `{ graph, nodes, edges, progress }`

## Four-Agent Graph Pipeline

- Agent 1: Generator
- Agent 2: Structure Validator
- Agent 3: Curriculum Validator
- Agent 4: Reconciler

Each agent is a separate Claude call with only explicitly passed input and no hidden shared context.
The validator calls are independent of each other, and the reconciler only sees the original graph plus both validator outputs.
Every stage output is machine-validated before the next stage runs.

## Stage Ownership

- `graph` owns validated `nodes[]` and `edges[]`
- `lessons` owns `lesson_text`, `quiz_json`, and `static_diagram`
- `diagnostics` owns `diagnostic_questions`
- `visuals` owns `p5_code` and `visual_verified`
- `store` persists only after all required node artifacts are present

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
4. Student clicks an available node and sees lesson plus visual
5. Student passes quiz and the node turns green
6. Next node unlocks
7. Demo pitch emphasizes low generation cost and unlimited reuse

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
