# Contract Packs: Domain, Database, Retrieval

This file is the working reference for Packs 1, 2, and 3. It is intentionally dense so implementation agents can load the domain, storage, and retrieval context without reopening the monolithic source text.

## Resolution Status

This file now inherits fixed lower-level rules from:

- `context/02-data-and-api.md`
- `context/03-generation-flow.md`
- `context/04-prompt-canonicalize-and-graph.md`
- `context/05-prompt-validators-and-reconciler.md`
- `context/06-prompt-visuals-and-diagnostics.md`

For Pack 1 and Pack 3 topics, the lower-level rules now replace the original "decide this" prompt language.

For Pack 2 topics, this file now locks the V1 baseline for table strategy, identity model, and lifecycle behavior, while clearly marking the remaining DB/auth items that still need a final explicit policy.

## Pack 1: Domain Contract Pack

### What It Defines

- The canonical domain model for `Graph`, `Node`, `Edge`, `UserProgress`, `QuizItem`, and `DiagnosticQuestion`
- The exact JSON contracts used by generation stages, API payloads, and frontend payloads
- The boundary between DB rows, domain objects, generation-time objects, and frontend DTOs
- The transformation path from LLM-generated temporary ids to persisted UUIDs
- The operational model for graph versions and how learner progress pins to them

### Product Context Captured In The Source

- Learners submit a topic request that is canonicalized first
- The system retrieves an existing graph if semantic similarity is high enough; otherwise it generates one
- Each node may carry lesson text, a static diagram, p5 code, verification state, quiz data, and diagnostic questions
- Graphs are shared across users and versioned
- Progress is pinned to a graph version once the learner starts
- Hard edges gate unlocks; soft edges are contextual only
- The implementation must stay hackathon-practical but real

### Already-Decided Architecture Constraints

Treat the following as fixed unless logically impossible:

1. Knowledge graphs are shared across users.
2. Personalization happens at the routing / entry-point layer, not by generating custom graphs per user.
3. Graphs are versioned.
4. New learners start on the latest version.
5. In-progress learners remain pinned to the graph version they started on unless they explicitly restart.
6. Nodes belong to a specific graph version.
7. Hard edges block progression; soft edges do not.
8. Each node can have:
   - `lesson_text`
   - `static_diagram`
   - `p5_code`
   - `visual_verified`
   - `quiz content`
   - `diagnostic questions`
9. `user_progress` stores attempt history and completion state per user per node per graph version.
10. IDs should be stable and machine-safe.
11. Output must be practical for a hackathon-grade but real implementation.

### Inherited Fixed Rules For Pack 1

The lower-level contracts already fix the main Pack 1 decisions:

- Graph identity model
  - Each graph version is its own persisted row in `graphs`
  - `graphs.id` identifies one graph-version row, not a graph-family container
  - `graphs.version` is the lineage-local version number for that topic
  - There is no separate graph-family table, graph-lineage table, or indirection layer in V1
- Node identity model
  - LLM output ids such as `node_1` are temporary generation-only ids
  - Persisted nodes use stable UUIDs
  - A persisted node UUID belongs to one graph version row
  - Edges reference persisted node UUIDs only
  - `user_progress` is logically pinned by `(user_id, node_id, graph_version)`
  - Persisted node UUIDs are also the stable frontend node ids on read payloads; temporary `node_N` ids never survive persistence
  - Store-time id remapping must also rewrite embedded node references inside node artifacts, especially `diagnostic_questions[].node_id`
- Storage model for quizzes and diagnostics
  - `quiz_json` remains embedded on nodes as a JSON array in V1
  - `diagnostic_questions` remains embedded on nodes as a JSON array in V1
  - This is a deliberate V1 simplification, not an unresolved modeling choice
  - There is no separate `quiz_items`, `diagnostic_items`, or `diagnostic_results` table in V1
- Frontend payload model
  - The frontend-facing graph read contract is a dedicated graph payload shape from `GET /api/graph/[id]`
  - That payload is `{ graph, nodes, edges, progress }`
  - The frontend should not treat raw table rows from multiple tables as its canonical read contract
- Progress source of truth
  - `completed` is the canonical stored completion flag
  - `attempts` is the canonical append-only attempt history
  - Unlock state is derived from completion plus incoming hard edges
  - Diagnostic questions are stored on nodes, but diagnostic scoring and entry-point calculation remain client-side in V1
  - Diagnostic answers and computed entry-point state are not persisted in V1

### Fields And Type Rules The Pack Wants Clarified

- Exact field names and types for all final entities
- Enum values and string literal unions
- Required versus nullable versus derived versus server-only fields
- Which ids are DB-generated, client-generated, or temporary generation-only ids
- How temporary `node_1`-style ids map to persisted UUIDs
- Whether any JSONB fields should remain nested
- Which fields the frontend can treat as canonical

### Type-System Principles The Source Emphasizes

1. One concept should map to one contract unless a second contract is genuinely needed.
2. Internal ids and generation ids should stay separate.
3. Version semantics must be unambiguous.
4. Field status should be explicit for every final field.
5. Operational clarity is preferred over clever abstractions.

### Pack 1 Output Expectations

The source explicitly expects:

- A type taxonomy for `lib/types.ts`
- Exact TypeScript definitions with no `any` and no pseudo-code
- A field-classification matrix for `Graph`, `Node`, `Edge`, and `UserProgress`
- Operational graph version semantics
- Explicit id-generation and transformation rules
- Supabase mapping rules
- Canonical JSON shapes for the main pipeline outputs
- Retrieval and generation intermediate contracts, if they differ from final DTOs
- Invariants and V1-versus-future notes

### Pack 1 Locked Decision Areas

#### A. Graph Identity Model

- The graph identity model is already fixed.
- Each version is a separate graph row with its own `id` and `version`.
- There is no separate graph-family table in the current V1 baseline.

#### B. Node Identity Model

- Node UUIDs are persisted identifiers for nodes in a specific graph version.
- Progress is pinned by `node_id` plus `graph_version` and scoped to `user_id`.
- Edges point directly to persisted node UUIDs only.

#### C. Storage Model For Quizzes And Diagnostics

- Quiz items and diagnostic questions stay embedded in nodes as JSON arrays in V1.
- This is a deliberate V1 simplification.

#### D. Frontend Payload Model

- The frontend uses a dedicated graph payload read shape from `GET /api/graph/[id]`.
- The canonical payload is `{ graph, nodes, edges, progress }`.

#### E. Progress Source Of Truth

- `completed` and `attempts` are the stored source of truth.
- Unlock state is derived.
- Node analytics counters such as `attempt_count` and `pass_count` live on `nodes`, but they are not the learner-progress source of truth.
- Diagnostic placement result is client-side in V1 unless a later contract explicitly persists it.

### Pack 1 Design Principles To Preserve

- One concept, one contract.
- Separate internal ids from generation-time ids.
- Make version semantics unambiguous.
- Define field status explicitly.
- Prefer operational clarity over cleverness.

### Pack 1 Output Sections

The output contract for Pack 1 is itself highly structured:

1. `Design Decisions`
2. `Type Taxonomy`
3. `Exact TypeScript Types`
4. `Field Classification Matrix`
5. `Graph Versioning Semantics`
6. `ID Generation and Transformation Rules`
7. `Supabase Mapping Rules`
8. `Canonical JSON Contracts`
9. `Invariants`
10. `V1 vs Future Notes`

### Pack 1 Hard Constraints

- Be decisive.
- Do not present multiple options in the final answer.
- Do not ask follow-up questions.
- Do not defer key decisions.
- Do not write SQL migrations yet.
- Do not write API route handlers yet.
- Do not write frontend code yet.
- Do not write prompts for other agents.
- Do not contradict the product constraints above.
- Keep the model minimal but complete.
- Optimize for implementation correctness.

### Pack 1 Additional Guidance

A strong answer should:

- eliminate ambiguity around graph families versus graph versions
- make `user_progress` impossible to misinterpret
- distinguish temporary LLM node ids from persisted UUIDs cleanly
- define a frontend payload that avoids leaking raw DB concerns where unnecessary
- make later DB, API, and frontend packs almost mechanical to write

A weak answer will:

- mix DB rows and app models carelessly
- leave version semantics fuzzy
- leave derived versus stored fields ambiguous
- fail to define id transformation rules
- force later packs to invent missing behavior

## Pack 2: Database + Auth Pack

### What It Defines

- The exact V1 persistence contract for graphs, nodes, edges, and learner progress
- Postgres schema details, indexes, constraints, and migration SQL
- Supabase RLS and access rules
- Anonymous auth behavior and how user identity maps to `user_progress`
- Which reads and writes happen directly through Supabase versus through server routes

### Product Context Captured In The Source

- The app stores graphs, nodes, edges, and user progress in Supabase Postgres
- pgvector powers graph retrieval
- Anonymous Supabase auth identifies learners
- Node attempts and completion state are recorded
- Learner progress is pinned to a graph version
- Hard edges are unlocking dependencies; soft edges are contextual

### Platform Constraints The Pack Assumes

- Supabase Postgres is the storage layer
- pgvector is enabled
- Anonymous auth is required
- Service-role keys are used for trusted server-side writes
- Public anon keys are used client-side
- Next.js route handlers are the app integration point
- V1 should stay minimal, but real
- Over-normalization should be avoided unless it materially improves correctness

### Inputs The Pack Assumes Exist

The pack assumes Pack 1 already established:

- exact `Graph` / `Node` / `Edge` / `UserProgress` semantics
- graph versioning model
- temporary LLM ids vs persisted UUIDs
- frontend payload strategy
- JSON field contracts where relevant

### Inherited Fixed Rules For Pack 2

The lower-level contracts already fix most Pack 2 storage-shape questions:

- Exact V1 table set baseline
  - `graphs`
  - `nodes`
  - `edges`
  - `user_progress`
  - No additional canonical V1 tables exist for graph families, node versions, quiz rows, diagnostic rows, or diagnostic attempts
- Graph version storage model
  - Each graph version is a separate row in `graphs`
  - `graphs.version` is stored directly on that row
- Node and edge identity
  - Nodes use UUID primary keys
  - `nodes.graph_id` points to the graph-version row
  - `nodes.graph_version` is duplicated on nodes in the current snapshot
  - `edges` reference node UUIDs only through `from_node_id` and `to_node_id`
  - The current lower-level schema snapshot does not add a separate `graph_version` column on `edges`
- Progress uniqueness
  - Progress is logically unique per `(user_id, node_id, graph_version)`
  - `attempts` lives inside the progress row as JSONB
  - `completed` is stored, not derived
  - The DB contract should enforce that logical uniqueness with a unique constraint
- Public read and auth assumptions
  - Supabase anonymous auth establishes learner identity on first visit
  - Next.js server routes are the canonical read and write boundary for app data in V1
- The browser does not directly read or write `graphs`, `nodes`, `edges`, or `user_progress`
- The server derives `user_id` from the authenticated anonymous session and never trusts a raw client-supplied id
- Service-role access is used by trusted server routes for generation, storage, graph reads, and progress reads/writes
- The canonical V1 transport for learner identity is the Supabase cookie-backed browser session carried on the Next.js request
- Trusted server routes read the current learner from the incoming session cookies and reject learner-scoped requests with no valid session

### Pack 2 Locked Decision Areas

The Pack 2 contract is now fixed in this split context:

- Exact V1 table set
  - `graphs`
  - `nodes`
  - `edges`
  - `user_progress`
- Graph version storage model
  - Each version is a separate persisted row in `graphs`
  - `graphs.id` identifies one graph-version row
  - `graphs.version` is stored directly on that row
  - There is no separate family table in V1
- Node and edge identity in SQL
  - `nodes.id` is a UUID primary key
  - `nodes.graph_id` points to the graph-version row
  - `nodes.graph_version` is duplicated on nodes for lookup and pinning clarity
  - `edges.from_node_id` and `edges.to_node_id` reference node UUIDs only
  - `edges` do not add a separate `graph_version` column in V1
- Progress identity and uniqueness
  - Exactly one progress row exists per `(user_id, node_id, graph_version)`
  - `attempts` lives inside `user_progress` as JSONB
  - `completed` is stored, not derived
- Public read model
- Graph, node, edge, and progress reads are served through Next.js routes in V1, especially `GET /api/graph/[id]`
- The browser uses Supabase anonymous auth for identity and session continuity only
- Direct Supabase table reads are not part of the canonical browser contract in V1
- `GET /api/graph/[id]` returns the shared graph content plus only the current learner's `user_progress` rows for that graph version
- Returning another learner's progress rows is a contract violation
- RLS model
  - RLS is enabled on all four canonical tables
- Service role access is used for trusted server-side generation, storage, graph reads, and progress reads/writes
- Anonymous client sessions do not directly read or write the canonical tables in V1
- The server derives `user_id` from the authenticated anonymous session and never trusts a raw client-supplied id
- The practical V1 RLS baseline is deny-by-default for direct anon/authenticated table access, with trusted access happening through server routes using the service role
- Learner-scoped reads and writes must authenticate through the Supabase browser session carried by request cookies; raw `user_id` request parameters are never authoritative
- Deletion and mutation behavior
  - Graph versions, nodes, and edges are append-only in normal operation once a version is stored
  - Older versions remain readable after newer versions are created
  - `flagged_for_review` mutates in place on `graphs`
  - `attempt_count`, `pass_count`, and `completed` mutate in place on their owning rows
  - Hard deletes are not part of normal V1 operation
  - Removing a node in a new version means creating a different later graph-version row; it does not mutate historical rows from previous versions
  - Any future admin cleanup must preserve pinned learner history and cannot be the default operational path

The inherited safety baseline is therefore fixed:

- client-supplied `user_id` must never be trusted over session identity
- service-role access is for trusted server-side generation, storage, and read assembly
- anonymous auth is the learner identity mechanism
- pinned learner history must not be destroyed by version churn

### Inherited Lifecycle Baseline For Pack 2

- Superseded graph versions remain readable for learners already pinned to them
- New learners should route to the best usable matching graph-version row under the retrieval ranking policy, which operationally prefers the latest usable version after similarity and flagged-state checks
- `flagged_for_review` is a routing signal for new learners, not a hard shutdown for already-pinned learners
- Older learner progress must remain readable against the graph version it belongs to
- A newer version may replace routing preference without deleting the older version's learner history
- Default SQL delete behavior must preserve learner history and prevent accidental cascade deletion of canonical graph content during normal operation

### Pack 2 Output Expectations

- A concise design-decision list
- A V1 table set with purpose and rationale
- Actual SQL migrations for a fresh database
- Constraint rationale
- Indexing strategy, including pgvector and progress lookup indexes
- RLS and access rules by table
- Anonymous auth behavior
- A read/write path contract for each major operation
- Data lifecycle rules
- Bootstrap requirements, including extensions, auth setup, and any required initial SQL
- Invariants and V1-versus-future notes

### Pack 2 Locked Decision Areas

#### A. Table Strategy

- The current V1 table-set baseline is already fixed to:
  - `graphs`
  - `nodes`
  - `edges`
  - `user_progress`
- Small supporting tables remain disallowed unless they materially improve correctness and are introduced by a later explicit DB/auth contract.

#### B. Graph Version Storage Model

- The graph version storage model is fixed.
- Each version is a separate graph row.
- There is no graph-family plus graph_versions split in the current V1 baseline.

#### C. Node And Edge Identity In SQL

- `nodes.id` is the UUID primary key in the current schema snapshot.
- Edges reference node UUIDs only.
- `graph_version` is duplicated on `nodes` in the current schema snapshot and is not currently part of the `edges` snapshot.
- Final SQL should enforce uniqueness that prevents duplicate node identities and duplicate edge pairs inside a stored graph-version snapshot.

#### D. Progress Identity And Uniqueness

- The logical progress identity is `(user_id, node_id, graph_version)`.
- There is exactly one logical progress record per user per node per graph version.
- Attempts live inside that row as JSONB.
- Completion is stored, not derived.

#### E. Public Read Model

- The lower-level API baseline exposes graph reads through `GET /api/graph/[id]`.
- Graph content is not directly read from Supabase tables by the browser in V1.
- Anonymous auth exists to establish learner identity and session continuity, not to make the Supabase client the canonical app-data access path.
- The route assembles graph content with learner-scoped progress on the server and must filter `user_progress` by the authenticated session user only.

#### F. RLS Model

- The RLS model is fixed at the contract level.
- RLS is enabled on all canonical tables.
- Direct anon/authenticated browser access to canonical tables is not part of the V1 app contract.
- Service-role access is for trusted server-side generation, storage, graph reads, and progress reads/writes.
- Learner identity comes from the anonymous Supabase session.
- Client-supplied `user_id` must not be trusted.

#### G. Deletion / Mutation Behavior

- The lifecycle baseline is fixed:
  - superseded graph versions remain readable for pinned learners
  - older learner progress remains attached to its original graph version
  - `flagged_for_review` changes new-learner routing, not pinned-learner continuity
- Graph content is append-only in normal V1 operation.
- Exact SQL should default to preserving learner history and preventing destructive cascades from normal application flows.
- New versions replace routing preference by insertion, not by mutating or deleting older versions.

### Pack 2 Output Requirements

The output contract for Pack 2 is itself highly structured:

1. `Design Decisions`
2. `Table Set`
3. `Exact SQL Migrations`
4. `Constraint Rationale`
5. `Indexing Strategy`
6. `RLS and Access Rules`
7. `Anonymous Auth Behavior`
8. `Read/Write Path Contract`
9. `Data Lifecycle Rules`
10. `Seed / Bootstrap Requirements`
11. `Invariants`
12. `V1 vs Future Notes`

### Pack 2 Hard Constraints

- Be decisive.
- Do not present multiple competing schemas.
- Do not ask follow-up questions.
- Do not defer key DB decisions.
- Do not write app-layer route handlers.
- Do not write frontend code.
- Do not write prompt templates.
- Do not invent unnecessary tables.
- Do not use unsafe RLS shortcuts that would let one learner modify another learner's progress.
- Preserve hackathon realism: minimal, solid, implementable.

### Pack 2 Additional Guidance

A strong answer should:

- make graph-version persistence impossible to misinterpret
- make progress uniqueness and ownership explicit
- define practical RLS instead of hand-wavy "secure appropriately"
- avoid destructive cascade choices that would break learner history
- give enough SQL that later agents can implement without inventing schema details

A weak answer will:

- hand-wave migrations
- leave RLS vague
- blur service-role versus client behavior
- choose cascade deletes that destroy learner history
- ignore index/query needs
- rely on trust of client-supplied `user_id`

## Pack 3: Retrieval + Caching + Regeneration Pack

### What It Defines

- How canonicalized prompts map to existing graphs or trigger generation
- How embeddings are formed and queried
- How subject and topic influence retrieval
- How thresholds, tie-breaks, duplicates, version selection, and flagged graphs should behave
- What retrieval returns on hit, miss, ambiguity, or flagged scenarios

### Product Context Captured In The Source

- Retrieval happens after canonicalization
- Subject filtering happens before vector similarity
- OpenAI `text-embedding-3-small` produces 1536-dimensional embeddings
- Graphs are shared and versioned
- New learners should land on the latest usable version
- In-progress learners stay pinned unless they restart
- `flagged_for_review` must affect retrieval policy somehow
- The current rough similarity threshold is `0.85`

### Design Priorities

Use these priorities in order:

1. Avoid false-positive cache hits that return the wrong graph
2. Still get strong cache reuse for genuinely matching concepts
3. Keep retrieval logic easy for future agents to implement correctly
4. Respect graph version semantics
5. Keep policy practical for V1 / hackathon constraints
6. Avoid hidden heuristics that later agents would misapply

### Inherited Fixed Rules For Pack 3

The lower-level contracts already fix the main retrieval decisions:

- Embedded text contract
  - Retrieval embeddings are built from the canonicalized `description` string only
  - The stored graph retrieval surface is the persisted graph `embedding`, created from that canonical description
  - The V1 embedding input template is exactly the raw canonical `description`, with no subject/topic prefix or wrapper text
- Subject normalization
  - Retrieval uses canonicalized `subject` as a hard pre-filter
  - Retrieval does not cross canonical subjects
- Topic usage
  - Topic is canonicalization and generation metadata
  - Topic is not part of the current retrieve route contract
- Threshold behavior
  - V1 uses a strict accept/reject threshold of `0.85`
  - There is no multi-band threshold policy in the current baseline
- Multiple-match behavior
  - Prefer highest similarity
  - Then prefer unflagged over flagged
  - Then prefer higher `version`
  - Then prefer newer `created_at`
  - Retrieval operates directly on graph-version rows; there is no separate graph-family resolution pass before ranking
- `flagged_for_review` behavior
  - Existing pinned learners may continue on a flagged version
  - New learners should not route to a flagged version if a usable unflagged match exists
  - If only flagged candidates pass threshold, retrieval returns `{ graph_id: null }` and generation proceeds
- Regeneration policy
  - Generate when no candidate passes threshold
  - Generate when the only threshold-passing candidates are flagged for new-learner routing
  - No extra stale-content heuristic is defined in the current baseline
- Duplicate policy
  - Retrieval operates at the graph-row level
  - Accidental duplicates are tolerated in V1
  - Selection uses the same deterministic ranking stack rather than a separate deduplication subsystem
  - There is no automatic duplicate cleanup pass in V1

### Query And Metadata Baseline For Pack 3

- Filter by canonical `subject` before similarity ranking
- Use cosine similarity from pgvector via `1 - (embedding <=> '[vector]'::vector)`
- Order usable candidates by:
  1. similarity descending
  2. unflagged before flagged
  3. version descending
  4. created_at descending
- The retrieve route currently returns `{ graph_id }` or `{ graph_id: null }`
- Additional retrieval metadata is not part of the current lower-level API contract

### Pack 3 Locked Decision Areas

#### A. Embedded Text Contract

- The embedding input is the canonicalized `description`.
- This applies to both stored graph embeddings and incoming retrieval queries.
- The retrieve route does not embed additional text fields in V1.
- Exact template: the raw four-sentence canonical description string and nothing else.

#### B. Subject Normalization

- Retrieval uses the canonical subject produced by canonicalization.
- Cross-subject retrieval is not allowed in V1.
- Subject aliases are normalized before retrieval by the canonicalization stage, not by the retrieve route.

#### C. Topic Usage

- Topic is metadata only for retrieval in the current route contract.
- Topic remains important for canonicalization and generation, but it does not directly filter or rank retrieve results.

#### D. Threshold Behavior

- V1 uses one strict threshold: `0.85`.
- Borderline multi-band handling is not part of the baseline.

#### E. Multiple-Match Behavior

- Use the deterministic ranking order already fixed in the lower-level contracts:
  1. highest similarity
  2. unflagged over flagged
  3. higher version
  4. newer creation time
- This ranking is the operational definition of the best usable candidate in V1.
- There is no extra family-aware override that bypasses the ranking stack.

#### F. `flagged_for_review` Behavior

- For new learners, flagged graphs are deprioritized behind usable unflagged matches.
- If only flagged rows pass threshold, retrieval returns miss and generation proceeds.
- For already-pinned learners, a flagged version remains usable.

#### G. Regeneration Policy

- Generation is triggered on threshold miss.
- Generation is also triggered for new-learner routing when only flagged matches are available.
- No separate stale-content or duplicate-pressure trigger is defined in V1.

#### H. Duplicate Policy

- V1 tolerates duplicate or near-duplicate rows.
- Retrieval resolves them with the standard ranking stack instead of an out-of-band dedupe workflow.
- There is no automatic duplicate cleanup pass in V1.

### Pack 3 Output Requirements

The output contract for Pack 3 is itself highly structured:

1. `Design Decisions`
2. `Canonical Retrieval Inputs`
3. `Subject and Topic Normalization Rules`
4. `Retrieval Algorithm`
5. `Threshold and Candidate Selection Policy`
6. `Cached Return Contract`
7. `Regeneration Policy`
8. `Version Selection Rules`
9. `Duplicate and Near-Duplicate Rules`
10. `Query and Index Assumptions`
11. `Invariants`
12. `V1 vs Future Notes`

### Pack 3 Hard Constraints

- Be decisive.
- Do not present multiple competing retrieval strategies.
- Do not ask follow-up questions.
- Do not write SQL migrations here.
- Do not write API handlers here.
- Do not write prompt templates here.
- Do not invent fuzzy heuristics without defining them operationally.
- Keep the policy practical for a solo-builder hackathon, but real.
- Avoid false-positive retrievals aggressively.
- Respect graph versioning and `flagged_for_review` semantics.

### Pack 3 Additional Guidance

A strong answer should:

- make it impossible to confuse graph selection with graph version selection
- define a single exact embedding input format
- make threshold behavior deterministic
- define how flagged graphs affect new learners
- explain how accidental duplicate graphs are handled without overcomplicating V1

A weak answer will:

- say vague things like "use the best match"
- leave threshold handling fuzzy
- ignore duplicate families
- ignore version semantics
- make retrieval depend on undefined intuition
- let flagged graphs silently leak into new-user routing without policy

## Working Guidance

This file is no longer a pure prompt mirror.

For Packs 1 through 3, the inherited lower-level rules above now replace the original open decision prompts. Read this file as the authoritative pack-level contract for domain, DB/auth, and retrieval behavior in the split context.

When you need one of these topics, prefer:

- `context/02-data-and-api.md` for the fixed route, schema, identity, and retrieval snapshot
- `context/03-generation-flow.md` for the current pipeline and ownership snapshot
- `context/99-known-contradictions.md` only for topics that are still unresolved outside this pack

## Pack 1-3 Closure

The following pack-level contradiction groups are resolved by this file:

- `PACK7-01` through `PACK7-22`

Only implementation-level expression remains for later packs, such as:

- the exact SQL migration syntax that enforces the fixed table strategy and uniqueness rules
- the exact RLS policy statements that implement the fixed route-only access model
- the exact foreign-key `ON DELETE` clauses that implement the fixed history-preserving lifecycle model

There are no remaining ambiguous Pack 1-3 policy decisions in this file; every former decision point is now fixed and inherited into the pack-level contract.
