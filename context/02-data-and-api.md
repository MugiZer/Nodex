# Data And API

This file is the authoritative lower-level reference for the Foundation data model, API contracts, auth behavior, environment variables, and retrieval rules.

If a higher-level pack file still reopens a decision covered here, this file wins until that higher-level file is rewritten to inherit these rules explicitly.

## Authoritative Baselines

### Graph Versioning

- Graphs are shared across users
- Graphs are versioned
- Each graph version is stored as its own row in `graphs`
- `graphs.id` identifies one persisted graph-version row, not a separate family table
- `graphs.version` is the version number for that topic lineage
- New learners should use the latest usable version row
- In-progress learners remain pinned to the version row they started on unless they explicitly restart

### Progress Identity

- The canonical logical identity of progress is `(user_id, node_id, graph_version)`
- There should be at most one progress record per learner per node per graph version
- `completed` is the canonical stored completion flag
- `attempts` is the canonical append-only attempt history
- Unlock state is derived from completion plus incoming hard edges and is not a separate source-of-truth field

### Retrieval

- Retrieval uses canonical `subject` as a hard pre-filter
- Retrieval uses the rendered canonicalized `description` as the semantic embedding input
- Retrieval does not cross canonical subjects
- Topic is metadata for canonicalization and generation, not part of the current retrieve route contract
- Retrieval uses a strict accept/reject threshold of `0.85`
- When multiple candidates are usable, prefer:
  1. highest similarity
  2. unflagged over flagged
  3. higher `version`
  4. newer `created_at`

### `flagged_for_review`

- `flagged_for_review` marks a graph version row as poor for new routing
- Existing pinned learners may continue using a flagged version
- New learners should not be routed to a flagged version if an unflagged usable match exists
- If only flagged candidates pass threshold, retrieval should return `{ graph_id: null }` so generation can produce a new candidate
- Restarting should route the learner to the latest usable unflagged version if one exists

## Database Schema Snapshot

### `graphs`

- `id uuid PK`
- `title text`
- `subject text`
- `topic text`
- `description text`
- `embedding vector(1536)`
- `version int`
- `flagged_for_review boolean`
- `created_at timestamp`

Notes:

- The semantic retrieval surface is `subject` plus the embedded `description`
- Versioning is stored directly on the graph row in V1

### `nodes`

- `id uuid PK`
- `graph_id uuid FK`
- `graph_version int`
- `title text`
- `lesson_text text`
- `static_diagram text` storing SVG
- `p5_code text`
- `visual_verified boolean`
- `quiz_json jsonb`
- `diagnostic_questions jsonb`
- `position int`
- `attempt_count int`
- `pass_count int`

Notes:

- Nodes belong to a specific graph version
- `attempt_count` and `pass_count` are analytics counters stored on the node
- `lesson_text`, `static_diagram`, `p5_code`, `visual_verified`, `quiz_json`, and `diagnostic_questions` are all node-level artifacts
- `static_diagram` is the SVG fallback when an interactive visual is not trustworthy
- `quiz_json` and `diagnostic_questions` remain embedded JSON arrays in V1
- Generation-time ids like `node_1` are temporary LLM ids; persisted nodes should use stable UUIDs

### `edges`

- `from_node_id uuid FK`
- `to_node_id uuid FK`
- `type text` with values `hard` or `soft`

Notes:

- `hard` edges gate progression
- `soft` edges are contextual only and do not block unlocks
- Edges are stored against persisted node UUIDs
- Unlock logic should rely only on hard edges

### `user_progress`

- `id uuid PK`
- `user_id uuid`
- `node_id uuid FK`
- `graph_version int`
- `completed boolean`
- `attempts jsonb` storing `[{ score: int, timestamp: string }]`

Notes:

- Progress is pinned to a graph version
- Anonymous sessions identify the learner
- `attempts` is an append-only history of node attempts
- `completed` is the canonical completion flag for a node

## Data Shapes

### `quiz_json`

Each node stores an array of 3 quiz items:

```ts
type QuizItem = {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  explanation: string;
};
```

Notes:

- Quiz items are per-node
- Explanations are required
- The quiz is the mastery check for that node
- Quiz content should be fully typed and machine-validatable before storage

### `diagnostic_questions`

Each node stores an array of 1 diagnostic item:

```ts
type DiagnosticQuestion = {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  difficulty_order: number;
  node_id: string;
};
```

Notes:

- Diagnostic questions are for adaptive placement, not mastery testing
- `difficulty_order` is used to order questions across the graph
- `node_id` must match the node the diagnostic question belongs to
- Diagnostic questions are intentionally short and discriminative

## API Contracts

### General API Rules

- Every API route must wrap logic in `try/catch`
- Every failure path must return a descriptive JSON error
- Never return a bare `500`
- Keep all API payloads fully typed
- Validate LLM output and apply stage-specific bounded repair before failing
- Use descriptive error messages for parse, schema, and invariant failures
- Server routes must not hardcode secrets or service keys

### `POST /api/generate/canonicalize`

- Input: `{ prompt: string }`
- Output: `{ subject: string, topic: string, description: string }`
- Error path: if the prompt is not a learning request, surface `{"error":"NOT_A_LEARNING_REQUEST"}`
- The public success payload remains `{ subject, topic, description }`
- The model does not author `description` directly in V1. It returns a structured semantic draft that the server normalizes and renders into the public `description`
- Canonicalize now uses a grounded hybrid policy:
  - inventory-covered broad or high-volume prompts may resolve directly to an approved canonical starter topic without a model call
  - medium-confidence inventory matches constrain the model to an approved candidate topic set
  - long-tail or low-confidence prompts stay model-led
- Server-side validation checks the model draft shape, normalized semantic fields, and the rendered public success shape before proceeding
- `subject` must be allowed, including `general`
- `topic` must be lowercase with underscores only
- Inventory-covered broad or underspecified prompts such as `calculus` are narrowed deterministically to the approved self-directed starter topic; prompts outside that grounded inventory still rely on the canonicalize model pass
- `description` must follow the exact four-sentence contract, but that contract is enforced on the rendered server output rather than on raw model prose
- The description is also used for semantic retrieval, so it must describe the topic boundary clearly
- Canonicalize uses deterministic local normalization first and one targeted repair call only when the semantic draft is still invalid after normalization
- Safe local canonicalize normalization is limited to trimming, whitespace collapse, trailing-punctuation stripping, topic slug normalization, empty-item dropping, and dedupe while preserving first-seen order
- Internal canonicalization metadata must include `canonicalization_source`, `inventory_candidate_topics`, `candidate_confidence_band`, and `canonicalization_version`

### `POST /api/generate/retrieve`

- Input: `{ subject: string, description: string }`
- Output: `{ graph_id: string } | { graph_id: null }`
- Retrieval first filters by `subject`, then compares embeddings
- Subject filtering happens before vector similarity ranking
- The similarity threshold is `0.85`
- Best match `>= 0.85` returns the cached `graph_id`
- Best match `< 0.85` triggers generation
- If multiple rows pass threshold, prefer highest similarity, then unflagged, then highest version, then newest creation time
- If the only threshold-passing rows are flagged, return `{ graph_id: null }` for new-learner routing

### `POST /api/generate/graph`

- Input: `{ subject: string, topic: string, description: string }`
- Output: `{ nodes: Node[], edges: Edge[] }`
- This is the four-agent graph pipeline entry point
- The response must satisfy structural invariants before later stages run
- Curriculum auditing is detached and advisory on this route; it must not block graph acceptance
- Debug mode may surface a synchronous placeholder audit state plus the request id for follow-up lookup

### `GET /api/generate/graph/audit`

- Input: `request_id` query parameter
- Output: persisted detached curriculum audit record or `null`
- This route is for operator/debug inspection of the async curriculum audit lifecycle

### `POST /api/generate/lessons`

- Input: `{ subject: string, topic: string, description: string, nodes: NodeDraft[], edges: Edge[] }`
- Output: shared stage result envelope with `stage: "lessons"` and `data: { nodes: LessonArtifact[] }`
- This route enriches nodes with `lesson_text`, `quiz_json`, and `static_diagram`
- Lesson content should remain self-contained relative to the node's hard prerequisites
- `static_diagram` is owned by this route as the non-interactive fallback artifact

### `POST /api/generate/diagnostics`

- Input: `{ subject: string, topic: string, description: string, nodes: LessonEnrichedNode[], edges: Edge[] }`
- Output: shared stage result envelope with `stage: "diagnostics"` and `data: { nodes: DiagnosticArtifact[] }`
- This route enriches nodes with `diagnostic_questions`
- Diagnostic questions are generated server-side and stored on nodes
- Diagnostic question generation is distinct from client-side diagnostic scoring

### `POST /api/generate/visuals`

- Input: `{ subject: string, topic: string, description: string, nodes: NodeDraft[] }`
- Output: shared stage result envelope with `stage: "visuals"` and `data: { nodes: VisualArtifact[] }`
- This route enriches nodes with `p5_code` and `visual_verified`
- If a faithful interactive sketch is not likely to work, return empty `p5_code` and `visual_verified: false`
- Visual fallback is a successful route outcome recorded as warnings, not a hard failure

### `POST /api/generate/store`

- Input: `{ graph: Graph, nodes: Node[], edges: Edge[] }`
- Output: shared stage result envelope with `stage: "store"` and `data: { graph_id, duplicate_of_graph_id?, write_mode, remapped_node_count, persisted_node_count, persisted_edge_count }`
- This route saves either a graph skeleton or a fully enriched graph payload to Supabase
- Skeleton writes persist nodes with `lesson_text = null`, `static_diagram = null`, `quiz_json = null`, `diagnostic_questions = null`, `p5_code = null`, `visual_verified = false`, and `lesson_status = "pending"`
- Final node updates happen after skeleton persistence against the already-remapped persisted node UUIDs and must not remap ids a second time
- The store step should use the service-role key on trusted server routes only
- Store must remap all generation-time temporary node ids such as `node_1` to persisted node UUIDs before writing final node artifacts
- Store must rewrite embedded self-references that contain node ids, including `diagnostic_questions[].node_id`, so persisted payloads never leak temporary generation ids
- Every stage result envelope must carry `request_id`, `stage`, `duration_ms`, `attempts`, `warnings`, and structured `error` details when `ok` is false

### `POST /api/generate`

- Input: `{ prompt: string }`
- Output: `{ graph_id: string, cached: boolean }`
- Master orchestrator: canonicalize -> retrieve -> generate or cache-hit return
- A cache hit must short-circuit the rest of the pipeline
- A miss must proceed through graph generation, skeleton store, early `graph_id` return, and delegated incremental enrichment for the initial node slice

### `GET /api/graph/[id]`

- Output: `{ graph: Graph, nodes: Node[], edges: Edge[], progress: UserProgress[] }`
- Graph fetch includes the learner progress view alongside graph content
- Each node payload includes `lesson_status` and may legitimately contain nullable content while `lesson_status = "pending"`
- `progress` means the current authenticated learner's progress rows for that graph version only
- The route must never return progress rows belonging to other learners

## Retrieval Snapshot

- Cosine similarity threshold is `0.85`
- Best match `>= 0.85` returns cached `graph_id`
- Best match `< 0.85` triggers generation
- Retrieval should not cross canonical subjects
- Retrieval should prefer the latest usable unflagged version row for new learners when version selection is relevant
- Graph similarity is computed from the stored `embedding` against the canonicalized description

Current SQL pattern:

```sql
SELECT id, 1 - (embedding <=> '[vector]'::vector) AS similarity
FROM graphs
WHERE subject = '[subject]'
ORDER BY similarity DESC
LIMIT 1;
```

Notes:

- OpenAI `text-embedding-3-small` is the embedding model
- The embedding dimension is 1536

## Auth Snapshot

- Use Supabase anonymous sessions
- On first visit call `supabase.auth.signInAnonymously()`
- Persist `session.user.id` as `user_id` in `user_progress`
- No email or password flow in V1
- Server-side routes use `SUPABASE_SERVICE_ROLE_KEY`
- Client-side code uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Client code must never depend on the service-role key
- The canonical V1 session transport is the Supabase cookie-backed browser session
- Next.js server routes must derive the current learner session from the incoming request cookies, not from a raw client-supplied `user_id`
- Client API payloads must never include `user_id` as a trusted field
- If no authenticated anonymous session is present, learner-scoped routes must fail clearly with a descriptive authentication error instead of returning unscoped progress

## Environment Snapshot

- `ANTHROPIC_API_KEY` is required for all Claude calls
- `OPENAI_API_KEY` is required for embeddings
- `NEXT_PUBLIC_SUPABASE_URL` is required on the client
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is required on the client
- `SUPABASE_SERVICE_ROLE_KEY` is required on the server
- Missing required environment variables should fail the relevant route clearly rather than silently degrading

## Data And API Caveats

- Graphs are shared across users, not personalized per learner
- Personalization happens through canonicalization, retrieval, and entry-point placement
- `lesson_text`, `static_diagram`, `quiz_json`, `diagnostic_questions`, `p5_code`, and `visual_verified` are node-level artifacts
- `attempt_count` and `pass_count` are counters on nodes, while `completed` and `attempts` are tracked in `user_progress`
- `flagged_for_review` is a graph-level warning and routing signal for new learners, not a forced shutdown for already-pinned learners
- Diagnostic questions are stored node artifacts, but diagnostic scoring and placement remain client-side with no API scoring call
