# Contract Packs: Orchestration, Prompt Schema, Content Rules

This file is the working reference for Packs 4, 5, and 6 from the source `AGENTS.md`.
It keeps the instructions dense enough to use directly, but groups them by concern instead of copying one huge prompt block verbatim.

Authority rule for this file:

- The authoritative decisions in this file inherit from the already-resolved lower-level files:
  - `context/03-generation-flow.md`
  - `context/04-prompt-canonicalize-and-graph.md`
  - `context/05-prompt-validators-and-reconciler.md`
  - `context/06-prompt-visuals-and-diagnostics.md`
- Where the original source text below says "Decide" or "You MUST Make", treat those prompts as resolved by the fixed rules in this file unless a section is explicitly marked as a residual open item.
- The later `Full Decision Surface` sections are preserved for instruction depth, but they are historical source scaffolding rather than reopened authority.

## Pack 4: Generation Orchestration

### What It Defines

- `POST /api/generate` owns the end-to-end request lifecycle
- orchestration should use shared server functions, not internal HTTP calls
- the four graph agents are isolated Claude calls
- validation and repair happen before the next stage runs
- persistence happens only after the full successful pipeline
- failures must be classified and surfaced with descriptive errors
- duplicate generation needs a practical safeguard
- logging must happen at every major milestone

### Product Context

Foundation:

- receives a learner prompt
- canonicalizes it into `{subject, topic, description}`
- attempts retrieval against stored graphs
- if retrieval hits, returns a cached graph
- otherwise runs the graph-generation pipeline:
  1. graph generator
  2. structure validator
  3. curriculum validator
  4. reconciler
- then generates node lessons
- then generates diagnostic questions
- then generates visuals
- then stores the graph, nodes, edges, and associated artifacts
- returns a graph id and cache metadata

The graph-generation pipeline uses isolated LLM calls with no shared context between agents except what is explicitly passed.

### Already-Decided Constraints

Treat these as fixed unless logically impossible:

1. The route order already sketched in `AGENTS.md` is directionally correct:
   - canonicalize
   - retrieve
   - graph generation
   - lessons
   - diagnostics
   - visuals
   - store
   - return `graph_id` + `cached` flag
2. Retrieval should short-circuit generation on a valid cache hit
3. The four graph agents are separate model calls with isolated context
4. The system must validate and repair malformed model outputs before proceeding
5. The project is hackathon-grade but must be operationally real
6. Every step must have descriptive errors
7. `console.log` at each major pipeline step is already required
8. Future packs will define exact prompts and exact API schemas; this pack defines orchestration behavior

### Design Priorities

Use these priorities in order:

1. correctness and determinism of generated graph artifacts
2. avoiding silent bad data persistence
3. operational simplicity for a solo-builder hackathon
4. descriptive failure modes
5. minimizing duplicate generations
6. reasonable latency
7. future extensibility without changing core behavior

### Resolved Decision Surface

The following Pack 4 decisions are fixed in this split context and are no longer open.

#### A. Orchestration mechanism

- `POST /api/generate` orchestrates the flow by calling shared server functions directly.
- It does not call sibling API routes over internal HTTP.
- The route handlers remain the external API surface; the orchestration logic is implemented in shared server-side modules so the same behavior can be reused without loopback requests.

#### B. Sequential vs parallel execution

- The authoritative stage order is:
  1. canonicalize
  2. retrieve
  3. graph generator
  4. structure validator and curriculum validator in parallel
  5. reconciler
  6. lessons
  7. diagnostics
  8. visuals
  9. store
- Retrieval short-circuits the generation path on a valid cache hit.
- The validator calls are the only graph-stage parallelism explicitly approved here.
- Lessons, diagnostics, and visuals run after reconciliation because they operate on the final graph.
- Diagnostics runs before visuals, matching the lower-level pipeline contract.

#### C. Retry policy

- LLM-backed stages use a maximum of one retry with identical input after a parse, schema, or invariant-validation failure.
- This applies to canonicalize, graph generator, structure validator, curriculum validator, reconciler, diagnostics, and visuals because their lower-level contracts already define JSON-only validation and one retry.
- Lessons follows the same pack-level baseline: one retry with identical input after invalid JSON or contract failure.
- Retrieval and store are not given semantic regeneration retries here; operational transient retries, if any, belong to the later ops pack rather than this content/orchestration contract.

#### D. Repair policy

- Every stage output is machine-validated before the next stage runs.
- The baseline repair depth is one retry with identical input; there is no separate free-form repair prompt established in V1 for Packs 4-6.
- If the first attempt fails validation, retry once with the same input.
- If the second attempt fails validation, abort the pipeline with a descriptive error.
- Visual downgrade to `visual_verified: false` with fallback to `static_diagram` is a valid success case, not a repair failure.

#### E. Timeout policy

- This pack fixes the control-flow rule but not the numeric budget:
  - any stage timeout is a hard failure for that request
  - the orchestrator does not return partial graph state
  - no partially generated graph is persisted on timeout
- Exact numeric timeout budgets remain deferred to the ops/deployment pack.

#### F. Partial failure / fallback policy

- If canonicalize returns `{"error":"NOT_A_LEARNING_REQUEST"}`, stop immediately and do not proceed.
- If retrieval returns a usable cached graph, stop generation and return the cache hit.
- If graph generation, either validator, or reconciliation fails, abort the generation path and persist nothing.
- If lessons fails, abort and persist nothing because `lesson_text`, `quiz_json`, and `static_diagram` are required artifacts.
- If diagnostics fails, abort and persist nothing because `diagnostic_questions` are required artifacts for adaptive placement.
- If visuals succeeds by marking a node `visual_verified: false`, that node degrades gracefully to `static_diagram`; this is the normal fallback path.
- If the visuals stage fails to return a valid result at all, abort and persist nothing, because the final node payload must still include `visual_verified` / `p5_code` fields in a consistent shape.
- If store fails after generation succeeds, report a descriptive store failure and do not treat the graph as created.
- If retrieval initially misses but an equivalent graph is found on a best-effort re-check immediately before store, prefer the existing graph and do not write a duplicate.

#### G. Persistence boundary

- Persistence begins only after the final graph, lessons, diagnostics, and visuals payloads are complete and validated.
- Nothing is written to Supabase before the full required artifact set exists.
- Partially generated graphs are not stored.
- Failure artifacts are logged, not persisted as partial graph rows.

#### H. Duplicate generation safeguards

- V1 uses a best-effort duplicate safeguard:
  - run retrieval before generation
  - run a second retrieval-style existence check immediately before store
  - if a usable equivalent graph now exists, return that graph instead of inserting a duplicate
- This is not a distributed lock or queue system; it is the minimal practical safeguard for the hackathon architecture.

#### I. Error contract philosophy

- The canonical failure categories for this pack are:
  - `canonicalize_error`
  - `retrieval_error`
  - `generation_error`
  - `validation_error`
  - `repair_failure`
  - `timeout_error`
  - `store_error`
  - `unexpected_internal_error`
- Non-learning requests are surfaced as a user-facing canonicalize outcome and do not continue through the pipeline.
- Validation failures become `validation_error` on first failure and `repair_failure` when the retry path is exhausted.
- Stage failures must propagate as descriptive JSON errors and must not silently fall through to later stages.

#### Fixed cross-pack linkage

- Numeric timeout budgets and latency targets are fixed by `context/09-pack-progress-frontend-ops.md`.
- Use these V1 budgets:
  - cache-hit target: under 2 seconds
  - full generation target: under 45 seconds
  - maximum acceptable demo latency: 90 seconds
  - soft total request timeout budget for generation: 90 seconds
- Within that total budget, keep stage budgets approximately:
  - canonicalize: 8 seconds
  - retrieve: 5 seconds
  - graph generator: 20 seconds
  - validators plus reconciler combined: 25 seconds
  - lessons: 20 seconds
  - diagnostics: 10 seconds
  - visuals: 15 seconds
  - store: 8 seconds

### Output Requirements

Respond with a structured markdown document and nothing else.

Your document must contain exactly these sections in this order:

# Generation Orchestration Pack

## 1. Design Decisions
A concise list of the major orchestration choices you made.

## 2. Orchestrator Responsibility Boundary
Define exactly what `POST /api/generate` is responsible for, and what sub-functions / sub-steps are responsible for.
Be explicit about whether internal execution should use shared server functions or internal HTTP calls.

## 3. End-to-End Flow
Provide the exact numbered execution flow for:

- cache hit
- cache miss + full generation success
- each major failure path

This must be operational, not conceptual.

## 4. Step Execution Contract
For each major step:

- canonicalize
- retrieve
- graph generator
- structure validator
- curriculum validator
- reconciler
- lessons
- diagnostics
- visuals
- store

Specify:

- inputs
- outputs
- whether it is sequential or parallel
- retry count
- repair behavior
- timeout budget
- abort vs continue behavior on failure

## 5. Validation and Repair Policy
Define the exact repair strategy for malformed or schema-invalid LLM outputs.
Include:

- parse failure
- schema mismatch
- invariant violation
- conflicting validator outputs if relevant
- max retry / repair depth

Be deterministic.

## 6. Concurrency and Idempotency Policy
Define:

- how simultaneous similar generation requests are handled
- whether the system re-checks retrieval before store
- whether duplicate graphs can still happen in V1
- how later retrieval should behave if duplicates exist

Keep it practical.

## 7. Persistence Boundary
Define exactly when data is written to Supabase.
State clearly:

- what must succeed before first write
- whether partial artifacts are stored
- what is in-memory only
- what store is atomic enough for V1

## 8. Failure Taxonomy
Define the canonical failure categories and what each means.
Do not write final JSON error schemas yet.
Do define the conceptual categories and when each is raised.

## 9. Logging Contract
Define:

- which milestones must be logged
- what identifiers should be included
- what must never be logged
- how to correlate one request across steps
- whether durations should be logged

Make it implementation-oriented.

## 10. Latency and Timeout Budget
Define:

- expected happy-path latency target
- acceptable demo latency
- total timeout budget
- per-step timeout budget
- any batching assumptions

Keep it realistic.

## 11. Invariants
List the orchestration invariants future agents must preserve.

## 12. V1 vs Future Notes
Briefly distinguish:

- what is intentionally simple in V1
- what could be queued/backgrounded later
- what would require changing API behavior

## Hard Constraints

- Be decisive. Do not present multiple competing orchestration strategies.
- Do not ask follow-up questions.
- Do not write route-handler code.
- Do not write prompt templates.
- Do not write exact API JSON schemas yet.
- Do not invent background job infrastructure unless absolutely necessary.
- Keep the design operationally real for a solo-builder hackathon.
- Avoid storing silently broken or partial graph data.
- Respect the already-decided multi-agent isolation model.

## Additional Guidance

A strong answer will:

- choose one clear orchestration mechanism
- make retries/repairs deterministic
- define exactly when the pipeline aborts
- define how visuals can fail without breaking the graph
- define a practical duplicate-generation safeguard
- make later implementation almost mechanical

A weak answer will:

- say vague things like "retry if needed"
- leave partial failure behavior undefined
- mix internal HTTP orchestration with shared-function orchestration without deciding
- ignore duplicate-generation race conditions
- let broken artifacts persist accidentally
- fail to define timeout behavior

Produce the final Generation Orchestration Pack now.

## Pack 5: Prompt And Output Schema

### What It Defines

- each LLM stage must output machine-parseable JSON only
- every stage has a single purpose and a single schema contract
- inputs and outputs are stage-specific and isolated
- server-side validation sits between every stage
- retries and repairs must be deterministic

### Product Context

Foundation:

- canonicalizes a learner prompt into `{subject, topic, description}`
- retrieves or generates a shared, versioned knowledge graph
- generates the graph through a four-agent isolated pipeline:
  1. graph generator
  2. structure validator
  3. curriculum validator
  4. reconciler
- enriches nodes with lesson content
- generates diagnostic questions
- generates visual artifacts
- stores validated graph content in Supabase
- uses strict machine validation between stages
- prefers graceful fallback over brittle generation

### Already-Decided Constraints

Treat these as fixed unless logically impossible:

1. Canonicalize already exists and must remain part of the prompt set
2. The graph pipeline uses four isolated model calls with no shared hidden context between agents
3. Future implementation should use Claude Sonnet for all LLM calls and OpenAI only for embeddings, per the current `AGENTS.md` direction
4. Every stage must return machine-parseable JSON only
5. Every stage must have server-side validation before the next stage runs
6. Malformed output must be repairable or retryable under a deterministic policy
7. Lessons, diagnostics, and visuals are separate generation concerns
8. Visual generation must support fallback if the interactive output is unusable
9. The prompt contract must be practical for a solo-builder hackathon, but strict enough to prevent downstream ambiguity

### Your Goal

Define the exact prompt and schema contract for all LLM generation stages.

At minimum, cover:

1. canonicalize
2. graph generator (`Agent 1`)
3. structure validator (`Agent 2`)
4. curriculum validator (`Agent 3`)
5. reconciler (`Agent 4`)
6. lesson generator
7. diagnostic generator
8. visual generator
9. visual repair / downgrade policy if needed

You must define for each stage:

- purpose
- exact input contract
- exact output JSON schema
- exact system prompt
- exact user prompt template
- validation rules
- retry / repair rules
- model settings assumptions
- whether the stage is isolated or allowed to see prior outputs

### Design Priorities

Use these priorities in order:

1. machine-parseable deterministic outputs
2. correctness of graph/content artifacts
3. strict isolation where intended
4. minimal ambiguity for later coding agents
5. graceful degradation rather than total failure where appropriate
6. practical V1 implementation complexity

### Resolved Decision Surface

The following Pack 5 decisions are fixed in this split context and are no longer open.

#### A. Prompt set completeness

- The required V1 LLM stages are:
  1. canonicalize
  2. graph_generator
  3. structure_validator
  4. curriculum_validator
  5. reconciler
  6. lesson_generator
  7. diagnostic_generator
  8. visual_generator
- There is no separate visual-repair LLM stage in V1.
- Visual downgrade is handled inside the visual contract by returning `visual_verified: false` and a fallback-safe payload.

#### B. Model settings baseline

- Every LLM call in these packs uses `claude-sonnet-4-5`.
- OpenAI is reserved for embeddings only and does not generate pack content.
- All stage outputs are raw JSON only with no markdown fences or prose outside schema.
- Tool use is not part of the default stage contract.
- Curriculum validation may conceptually use selective web search or retrieval only if such tools are explicitly available, matching the lower-level validator contract.
- Constrained JSON output should be used when the runtime supports it, but the authoritative server-side guardrail remains explicit schema validation rather than trusting model mode alone.
- Numeric settings such as exact temperature and exact token ceilings are not specified in the lower-level files and remain implementation parameters outside the resolved content contract.

#### C. Isolation rules

- canonicalize sees only the learner prompt.
- graph_generator sees only `subject`, `topic`, and `description`.
- structure_validator sees `subject`, `topic`, `description`, `nodes`, and `edges`; it does not see generator reasoning or curriculum-validator output.
- curriculum_validator sees `subject`, `topic`, `description`, `nodes`, and `edges`; it does not see structure-validator output.
- reconciler sees the original graph plus both validator outputs.
- lesson_generator operates on the final reconciled graph and owns `lesson_text`, `quiz_json`, and `static_diagram`.
- diagnostic_generator operates on the final graph after lesson enrichment and owns `diagnostic_questions`.
- visual_generator operates on the final graph plus lesson-enriched node content, including `lesson_text`, `quiz_json`, and `static_diagram`.
- No stage receives hidden chain-of-thought or latent context from earlier stages; only explicit serialized inputs are passed.

#### D. Lesson generation scope

- The lesson stage is a graph-level enrichment pass over the reconciled node set.
- Its required output is the node array enriched with:
  - `lesson_text`
  - `quiz_json`
  - `static_diagram`
- The lower-level contracts do not require one-node-at-a-time prompting, so batching strategy is an implementation detail as long as the stage output matches the authoritative node schema.

#### E. Diagnostic generation scope

- Diagnostics are node-scoped, not graph-level freeform questions.
- Each node must receive exactly one diagnostic question.
- `difficulty_order` is a global placement ordering signal that should generally rise with graph position.
- Diagnostic questions are distinct from mastery quizzes and exist only for adaptive placement.
- Distractors are required and must remain plausible, matching the lower-level diagnostics contract.

#### F. Visual generation contract

- Visual output fields are exactly:
  - `id`
  - `p5_code`
  - `visual_verified`
- `static_diagram` is generated by the lesson stage, not by the visual stage.
- Interactive p5 output is attempted only when the concept is a good fit for a faithful, stable visual.
- A node may legitimately return `p5_code: ""` and `visual_verified: false`.
- `visual_verified: true` means the sketch is considered pedagogically aligned, syntactically plausible, and suitable for downstream automated verification.
- The visual generator sees the lesson-enriched node payload, not only the bare node title.

#### G. Repair philosophy

- The default repair path is one retry with identical input after parse or schema failure.
- No extra repair-stage prompt is introduced for V1 in this pack.
- Stages that produce required artifacts fail hard when the retry path is exhausted.
- Visual generation may degrade from interactive output to static-only fallback by returning `visual_verified: false`; that downgrade is success, not failure.
- Canonicalize may terminate early with `NOT_A_LEARNING_REQUEST`, which is also a valid terminal outcome rather than a repair failure.

#### Fixed model-settings baseline

- Use `claude-sonnet-4-5` for every LLM stage in V1.
- Use JSON-only responses and constrained decoding when available.
- Temperature baseline:
  - `0.0` for `canonicalize`, `structure_validator`, `curriculum_validator`, and `reconciler`
  - `0.2` for `graph_generator`, `lesson_generator`, `diagnostic_generator`, and `visual_generator`
- Max-token policy:
  - `canonicalize`: low output budget sized only for one JSON object
  - validators: medium output budget sized for issue arrays
  - generator / reconciler / lessons / diagnostics / visuals: medium-high output budget sized to the schema, but never "unbounded"
- Lessons run graph-wide in one stage call in V1 rather than one node per request or ad hoc batching.

### Output Requirements

Respond with a structured markdown document and nothing else.

Your document must contain exactly these sections in this order:

# Prompt / Output-Schema Pack

## 1. Design Decisions
A concise list of the major prompt-contract choices you made.

## 2. Global Prompting Rules
Define rules that apply to all stages:

- JSON-only behavior
- no markdown fences
- no prose outside schema
- no hidden chain-of-thought requirement
- schema obedience
- isolation principles
- retry/repair philosophy
- model settings baseline

## 3. Stage Inventory
List every LLM stage in V1.
For each stage, provide:

- name
- purpose
- isolated or not
- primary inputs
- primary outputs

## 4. Exact Stage Contracts
For each stage, in this exact order:

1. canonicalize
2. graph_generator
3. structure_validator
4. curriculum_validator
5. reconciler
6. lesson_generator
7. diagnostic_generator
8. visual_generator
9. no separate `visual_repair_or_downgrade` stage in V1; downgrade behavior is handled inside `visual_generator`

For each stage, provide these exact subsections:

### Stage Name

**Purpose**  
One concise paragraph.

**Inputs**  
The exact JSON input contract this stage receives.

**Output Schema**  
The exact JSON output schema in a concise but precise format.

**System Prompt**  
The full final system prompt text.

**User Prompt Template**  
The exact user prompt template with placeholders.

**Validation Rules**  
The exact server-side checks required before accepting this stage output.

**Retry / Repair Rules**  
The exact deterministic retry/repair behavior for this stage.

**Model Settings**  
The exact recommended settings policy for this stage.

## 5. Cross-Stage Data Contracts
Define the exact fields that flow from one stage to the next.
Examples:

- canonicalize -> retrieve
- graph_generator -> validators
- reconciler -> lesson/diagnostic/visual generation
- lesson_generator -> visual_generator if applicable

Be explicit and aligned with the schemas you chose.

## 6. Fallback Rules
Define all cases where the system should gracefully degrade rather than fail.
At minimum cover:

- canonicalize non-learning request
- malformed graph output
- validator disagreement
- lesson generation failure
- diagnostic generation failure
- visual generation failure

Be operational.

## 7. Invariants
List the prompt-contract invariants future agents must preserve.

## 8. V1 vs Future Notes
Briefly distinguish:

- what is intentionally simple in V1
- what could later use tools / web / stronger constrained decoding
- what would be dangerous to change without also changing validators and API contracts

## Hard Constraints

- Be decisive. Do not present multiple competing prompt strategies.
- Do not ask follow-up questions.
- Do not write route-handler code.
- Do not write SQL migrations.
- Do not write frontend code.
- Do not rely on hidden chain-of-thought.
- Do not require the model to produce anything other than machine-parseable JSON.
- Keep the design strict but practical for a solo-builder hackathon.
- Respect already-decided multi-agent isolation.

## Additional Guidance

A strong answer will:

- make every stage schema explicit
- define exactly what each stage can see
- define lessons/diagnostics/visuals as real contracts, not vague content wishes
- make retry/repair behavior deterministic
- make visual fallback practical
- normalize the whole prompt stack into one coherent system

A weak answer will:

- leave outputs underspecified
- mix stage responsibilities
- make validators non-isolated
- leave lesson/diagnostic/visual schemas vague
- say "retry if needed" without rules
- assume later agents will fill in missing prompt details

Produce the final Prompt / Output-Schema Pack now.

## Pack 6: Graph Content Rules

### What It Defines

- what counts as a complete graph in V1
- what each node artifact means
- which artifacts are required vs optional
- what can fail gracefully versus what must fail hard
- how edges carry pedagogical meaning beyond unlock gating

### Product Context

Foundation:

- generates a topic-scoped knowledge dependency graph
- validates and reconciles the graph structure/curriculum
- enriches each node with:
  - lesson text
  - static diagram
  - optional p5.js interactive visual
  - mastery quiz
  - diagnostic question(s)
- uses hard edges for unlock-gating and soft edges for contextual relationships
- places students at an entry point using adaptive diagnostic questions
- lets students progress node-by-node through mastery-gated lessons

### Already-Decided Constraints

Treat these as fixed unless logically impossible:

1. A graph is topic-scoped, not a full course
2. Graph size should stay in the rough 10-25 node range, as already established in prior prompts and the current `AGENTS.md`
3. Nodes must be atomic enough to teach in a single lesson plus quiz
4. Hard edges block progression; soft edges do not
5. Each node can contain `lesson_text`, `static_diagram`, `p5_code`, `visual_verified`, quiz content, and diagnostic question(s)
6. Visuals must have fallback behavior when interactive output is unusable
7. The diagnostic is adaptive and uses node-linked questions
8. The system should be hackathon-practical but real

### Your Goal

Define the exact content rules for a graph and its node artifacts, including:

1. graph-level completeness rules
2. node-level completeness rules
3. lesson rules
4. quiz rules
5. diagnostic rules
6. visual/static diagram rules
7. edge-semantic rules beyond simple unlock logic
8. artifact validity rules required before persistence / serving
9. what may degrade gracefully vs what must fail hard

### Design Priorities

Use these priorities in order:

1. every served node must be teachable and testable
2. students must not be blocked by missing or broken enrichment artifacts
3. graph artifacts must be internally coherent
4. future coding agents must not have to guess what "complete" means
5. keep the contract practical for V1 / hackathon scope
6. avoid overcomplicating the content model

### Resolved Decision Surface

The following Pack 6 decisions are fixed in this split context and are no longer open.

#### A. Graph completeness definition

- A graph is complete enough to store and serve only when every node has:
  - `lesson_text`
  - `quiz_json`
  - `static_diagram`
  - `diagnostic_questions`
  - `visual_verified`
  - `p5_code` (which may be an empty string when fallback is required)
- `nodes` and `edges` must already be reconciled and validated before content enrichment.
- Interactive visual success is optional; visual contract completeness is mandatory.
- Graphs missing any required non-visual-fallback artifact are not stored.

#### B. Lesson contract

- Lessons are required for every node.
- Lessons must be self-contained relative to the node's hard prerequisites and must not depend on downstream knowledge.
- Lessons are allowed to use formulas and notation when the concept requires them.
- Lessons should stay node-scoped rather than expanding into a chapter-sized unit.
- This pack does not introduce a richer formatting contract beyond the required `lesson_text` field; exact prose style remains subordinate to the lesson-generator prompt once that prompt is fully materialized.

#### C. Quiz contract

- Every node has exactly 3 mastery-quiz items in `quiz_json`.
- Each quiz item must include:
  - `question`
  - `options` with exactly 4 choices
  - `correct_index`
  - `explanation`
- Quiz questions are mastery checks for the node, not placement questions for the graph.
- Explanations are required because they are part of the stored schema.
- The lower-level files do not fix a numeric pass threshold, so that application-level threshold remains outside this pack's resolved artifact contract.

#### D. Diagnostic contract

- Every node has exactly 1 diagnostic question in `diagnostic_questions`.
- Diagnostic questions are node-linked placement artifacts, not mastery artifacts.
- `difficulty_order` is required and should broadly track graph progression.
- Diagnostic answers are scored client-side during placement and are not persisted by the placement flow.
- Diagnostic content may rely on prerequisites already guaranteed by the node's position, but it must not test downstream concepts.

#### E. Visual contract

- `static_diagram` is required for every node and is the guaranteed fallback visual.
- In the source schema, `static_diagram` is stored as an SVG string; this file inherits that SVG-string baseline.
- Interactive visual generation is eligibility-based, not mandatory for every concept.
- `visual_verified` communicates whether the interactive sketch is trustworthy enough to use instead of the static fallback.
- A node may be fully valid with lesson + quiz + `static_diagram` + diagnostic question and no usable interactive sketch, as long as `visual_verified` is `false` and the fallback path is intact.

#### F. Edge semantic contract

- `hard` edges are mastery-gating prerequisites and must be sufficient for learning the dependent node.
- `soft` edges are contextual or enrichment relationships only and never block progression.
- Soft edges may inform graph display and contextual UX, but they do not change unlock state.
- V1 edges do not encode any semantics beyond `hard` and `soft`.

#### G. Hard-fail vs graceful-degrade policy

- Missing `lesson_text` rejects the graph for storage.
- Missing `quiz_json` rejects the graph for storage.
- Missing `diagnostic_questions` rejects the graph for storage.
- Missing `static_diagram` rejects the graph for storage because the visual fallback would be broken.
- Missing or untrustworthy interactive p5 output does not reject the graph if `visual_verified: false` and `static_diagram` is present.
- Partially weak visuals across nodes are acceptable as long as the fallback path remains intact for every affected node.

#### Fixed artifact detail rules

- `lesson_text` should target roughly 150 to 300 words per node.
- Lessons may use lightweight Markdown for readability, short bullet lists, and inline formulas when needed.
- Every lesson must include at least one concrete worked example or interpretation cue for the node.
- Lessons must be self-contained relative to the node's hard prerequisites and must not require downstream concepts.
- The mastery quiz pass threshold is fixed at 2 correct answers out of 3.

### Output Requirements

Respond with a structured markdown document and nothing else.

Your document must contain exactly these sections in this order:

# Graph Content Rules Pack

## 1. Design Decisions
A concise list of the major content-contract choices you made.

## 2. Graph Completeness Contract
Define the exact minimum artifact set required for a graph to be:

- valid for storage
- valid for serving
- valid for adaptive diagnostic use

Be explicit at graph and node level.

## 3. Node Artifact Contract
For each node artifact, define:

- purpose
- whether required or optional
- minimum completeness rule
- whether it is learner-facing
- whether it participates in gating or placement

Cover:

- `lesson_text`
- `static_diagram`
- `p5_code`
- `visual_verified`
- `quiz`
- `diagnostic_questions`

## 4. Lesson Rules
Define the exact lesson contract:

- structure
- length target
- tone
- allowed formatting
- example requirements
- formula/notation policy
- self-containment relative to prerequisites
- forbidden patterns

Make it operational for future generation and validation.

## 5. Quiz Rules
Define the exact mastery-quiz contract:

- number of questions
- schema expectations
- pass threshold
- retry rules
- explanation rules
- scoring expectations
- what the quiz is allowed to test
- what it must not test

Be explicit.

## 6. Diagnostic Rules
Define the exact diagnostic-question contract:

- coverage expectations
- count expectations
- relationship to node positions
- `difficulty_order` semantics
- distinction from mastery quiz content
- how future agents should think about diagnostic usefulness

Be explicit and practical.

## 7. Visual and Diagram Rules
Define the exact contract for:

- `static_diagram`
- `p5_code`
- `visual_verified`
- visual eligibility
- fallback behavior

You must define what minimum visual experience every node guarantees.

## 8. Edge Semantics
Define exactly what hard and soft edges mean pedagogically and operationally.
Include any non-gating implications in UX / recommendation logic if you choose to include them.

## 9. Acceptance / Rejection Rules
Define which content failures:

- reject the entire graph
- reject a node
- allow graph storage but not serving
- allow graceful degradation

Be deterministic.

## 10. Invariants
List the content invariants future agents must preserve.

## 11. V1 vs Future Notes
Briefly distinguish:

- what is intentionally simplified in V1
- what could be enriched later
- what would be dangerous to change without updating prompts, validators, or UI logic

## Hard Constraints

- Be decisive. Do not present multiple competing content strategies.
- Do not ask follow-up questions.
- Do not write route handlers.
- Do not write SQL migrations.
- Do not write frontend code.
- Do not write prompt templates here.
- Keep the content contract strict enough to implement and validate.
- Keep it practical for a solo-builder hackathon.
- Do not let students be blocked by non-essential enrichment failures.
- Do not allow vague phrases like "sufficient lesson" without defining sufficiency.

## Additional Guidance

A strong answer will:

- make "graph completeness" operational
- define exact node artifact requirements
- distinguish mastery quiz from diagnostic cleanly
- define when visuals are required vs optional
- define graceful degradation rigorously
- make later validation and UI logic almost mechanical

A weak answer will:

- leave lesson / quiz / diagnostic sufficiency vague
- fail to define what can degrade gracefully
- overcomplicate the content model
- conflate mastery quizzes with diagnostics
- make every visual mandatory without fallback
- leave edge semantics underspecified

Produce the final Graph Content Rules Pack now.

---

## Pack 5: Full Decision Surface

Historical source-scaffolding note:

- The detailed Pack 5 prompt below is retained so the file does not lose instruction depth.
- Any wording below that reopens a choice is subordinate to the resolved Pack 5 rules above.
- When the copied source text conflicts with the resolved stage inventory, isolation model, or fallback contract, prefer the resolved Pack 5 section and the lower-level files.

This section preserves the detailed decision prompts and output requirements from the source Pack 5 so the context file does not lose instruction depth.

### Product Context

Foundation:

- canonicalizes a learner prompt into `{subject, topic, description}`
- retrieves or generates a shared, versioned knowledge graph
- generates the graph through a four-agent isolated pipeline:
  1. graph generator
  2. structure validator
  3. curriculum validator
  4. reconciler
- enriches nodes with lesson content
- generates diagnostic questions
- generates visual artifacts
- stores validated graph content in Supabase
- uses strict machine validation between stages
- prefers graceful fallback over brittle generation

### Already-Decided Constraints

Treat these as fixed unless logically impossible:

1. Canonicalize already exists and must remain part of the prompt set
2. The graph pipeline uses four isolated model calls with no shared hidden context between agents
3. Future implementation should use Claude Sonnet for all LLM calls and OpenAI only for embeddings, per the current `AGENTS.md` direction
4. Every stage must return machine-parseable JSON only
5. Every stage must have server-side validation before the next stage runs
6. Malformed output must be repairable or retryable under a deterministic policy
7. Lessons, diagnostics, and visuals are separate generation concerns
8. Visual generation must support fallback if the interactive output is unusable
9. The prompt contract must be practical for a solo-builder hackathon, but strict enough to prevent downstream ambiguity

### Design Priorities

Use these priorities in order:

1. machine-parseable deterministic outputs
2. correctness of graph/content artifacts
3. strict isolation where intended
4. minimal ambiguity for later coding agents
5. graceful degradation rather than total failure where appropriate
6. practical V1 implementation complexity

### Decisions You MUST Make

You must explicitly decide all of the following:

#### A. Prompt set completeness

You must decide the exact required LLM stages for V1.
At minimum include the eight listed above.
You may add a narrowly-scoped repair prompt only if it materially improves robustness and does not overcomplicate V1.

#### B. Model settings contract

You must define the exact recommended settings policy for each stage:

- model name
- temperature
- max tokens policy
- whether tool use is allowed
- whether web search is allowed conceptually for curriculum validation
- whether JSON mode or equivalent constrained output should be assumed if available

Be consistent and practical.

#### C. Isolation rules

You must define exactly what each stage may see.
Examples:

- structure validator sees graph only, not generator reasoning
- curriculum validator sees graph + canonical description, not structure validator output
- reconciler sees original graph + both validator outputs
- lessons may or may not see parent/child node context
- diagnostics may or may not see lesson text

Commit to one coherent policy.

#### D. Lesson generation scope

You must decide whether the lesson generator operates:

- one node at a time
- on the whole graph at once
- or in bounded batches

You must define the exact output shape and how examples, formulas, and diagrams are represented.

#### E. Diagnostic generation scope

You must decide:

- how many diagnostic questions per node or per graph
- whether diagnostics are node-scoped or graph-level with node mapping
- how `difficulty_order` is assigned
- whether distractors need explicit rules

Commit to one V1 policy.

#### F. Visual generation contract

You must decide:

- exact output fields for visuals
- whether static diagram prompt/content is generated by the same stage or separate
- whether p5.js code is always attempted
- what counts as a "verified-capable" output at the contract level
- whether visual generator sees the full lesson or only the node spec

Commit to one policy.

#### G. Repair philosophy

You must define:

- when to retry the original prompt
- when to use a repair prompt
- when to fail hard
- which stages may fall back to simpler content
- whether visual generation can downgrade from interactive + static to static-only

Commit to one deterministic policy.

### Output Requirements

Respond with a structured markdown document and nothing else.

Your document must contain exactly these sections in this order:

# Prompt / Output-Schema Pack

## 1. Design Decisions
A concise list of the major prompt-contract choices you made.

## 2. Global Prompting Rules
Define rules that apply to all stages:

- JSON-only behavior
- no markdown fences
- no prose outside schema
- no hidden chain-of-thought requirement
- schema obedience
- isolation principles
- retry/repair philosophy
- model settings baseline

## 3. Stage Inventory
List every LLM stage in V1.
For each stage, provide:

- name
- purpose
- isolated or not
- primary inputs
- primary outputs

## 4. Exact Stage Contracts
For each stage, in this exact order:

1. canonicalize
2. graph_generator
3. structure_validator
4. curriculum_validator
5. reconciler
6. lesson_generator
7. diagnostic_generator
8. visual_generator
9. visual_repair_or_downgrade (only if you choose to include it)

For each stage, provide these exact subsections:

### Stage Name

**Purpose**  
One concise paragraph.

**Inputs**  
The exact JSON input contract this stage receives.

**Output Schema**  
The exact JSON output schema in a concise but precise format.

**System Prompt**  
The full final system prompt text.

**User Prompt Template**  
The exact user prompt template with placeholders.

**Validation Rules**  
The exact server-side checks required before accepting this stage output.

**Retry / Repair Rules**  
The exact deterministic retry/repair behavior for this stage.

**Model Settings**  
The exact recommended settings policy for this stage.

## 5. Cross-Stage Data Contracts
Define the exact fields that flow from one stage to the next.
Examples:

- canonicalize -> retrieve
- graph_generator -> validators
- reconciler -> lesson/diagnostic/visual generation
- lesson_generator -> visual_generator if applicable

Be explicit and aligned with the schemas you chose.

## 6. Fallback Rules
Define all cases where the system should gracefully degrade rather than fail.
At minimum cover:

- canonicalize non-learning request
- malformed graph output
- validator disagreement
- lesson generation failure
- diagnostic generation failure
- visual generation failure

Be operational.

## 7. Invariants
List the prompt-contract invariants future agents must preserve.

## 8. V1 vs Future Notes
Briefly distinguish:

- what is intentionally simple in V1
- what could later use tools / web / stronger constrained decoding
- what would be dangerous to change without also changing validators and API contracts

## Hard Constraints

- Be decisive. Do not present multiple competing prompt strategies.
- Do not ask follow-up questions.
- Do not write route-handler code.
- Do not write SQL migrations.
- Do not write frontend code.
- Do not rely on hidden chain-of-thought.
- Do not require the model to produce anything other than machine-parseable JSON.
- Keep the design strict but practical for a solo-builder hackathon.
- Respect already-decided multi-agent isolation.

## Additional Guidance

A strong answer will:

- make every stage schema explicit
- define exactly what each stage can see
- define lessons/diagnostics/visuals as real contracts, not vague content wishes
- make retry/repair behavior deterministic
- make visual fallback practical
- normalize the whole prompt stack into one coherent system

A weak answer will:

- leave outputs underspecified
- mix stage responsibilities
- make validators non-isolated
- leave lesson/diagnostic/visual schemas vague
- say "retry if needed" without rules
- assume later agents will fill in missing prompt details

Produce the final Prompt / Output-Schema Pack now.

## Pack 6: Full Decision Surface

Historical source-scaffolding note:

- The detailed Pack 6 prompt below is retained so the file does not collapse the original decision space into a thin summary.
- Any wording below that reopens graph-completeness, quiz, diagnostic, visual, or graceful-degradation choices is subordinate to the resolved Pack 6 rules above.
- When the copied source text conflicts with stage ownership or fallback behavior already fixed in the lower-level files, prefer the resolved Pack 6 section and the lower-level files.

This section preserves the detailed decision prompts and output requirements from the source Pack 6 so the context file does not collapse the graph-content contract into a short summary.

### Product Context

Foundation:

- generates a topic-scoped knowledge dependency graph
- validates and reconciles the graph structure/curriculum
- enriches each node with:
  - lesson text
  - static diagram
  - optional p5.js interactive visual
  - mastery quiz
  - diagnostic question(s)
- uses hard edges for unlock-gating and soft edges for contextual relationships
- places students at an entry point using adaptive diagnostic questions
- lets students progress node-by-node through mastery-gated lessons

### Already-Decided Constraints

Treat these as fixed unless logically impossible:

1. A graph is topic-scoped, not a full course
2. Graph size should stay in the rough 10-25 node range, as already established in prior prompts and the current `AGENTS.md`
3. Nodes must be atomic enough to teach in a single lesson plus quiz
4. Hard edges block progression; soft edges do not
5. Each node can contain `lesson_text`, `static_diagram`, `p5_code`, `visual_verified`, quiz content, and diagnostic question(s)
6. Visuals must have fallback behavior when interactive output is unusable
7. The diagnostic is adaptive and uses node-linked questions
8. The system should be hackathon-practical but real

### Design Priorities

Use these priorities in order:

1. every served node must be teachable and testable
2. students must not be blocked by missing or broken enrichment artifacts
3. graph artifacts must be internally coherent
4. future coding agents must not have to guess what "complete" means
5. keep the contract practical for V1 / hackathon scope
6. avoid overcomplicating the content model

### Decisions You MUST Make

You must explicitly decide all of the following:

#### A. Graph completeness definition

Define exactly what makes a graph "complete enough to serve" in V1.
Examples:

- must every node have lesson + quiz + exactly one diagnostic question?
- must every node have a static diagram?
- must every node attempt interactive visual generation?
- can a graph be stored if some nodes lack some artifacts?

Commit to one policy.

#### B. Lesson contract

Define:

- target length / scope per node
- tone and audience assumptions
- whether lessons must include examples
- whether lessons may use formulas
- whether markdown is allowed
- whether lessons must be self-contained relative to hard prerequisites
- whether lessons may mention downstream concepts

Commit to one policy.

#### C. Quiz contract

Define consistently with earlier packs:

- quiz has 3 items per node
- question format(s)
- pass threshold
- whether explanations are required
- whether answer options are stable or shuffled client-side
- whether failed attempts may be retried immediately
- whether quiz content must only test that node or may include prerequisite recall

Commit to one policy.

#### D. Diagnostic contract

Define consistently with earlier packs:

- there is exactly 1 diagnostic question per node
- every node has diagnostic coverage
- diagnostic questions differ from mastery quiz questions
- how `difficulty_order` relates to graph position
- whether diagnostic questions may test prerequisite transfer

Commit to one policy.

#### E. Visual contract

Define:

- `static_diagram` is required for every node
- whether `static_diagram` is SVG-only or may be another format/string contract
- whether interactive visual generation is attempted for every node or only eligible nodes
- how eligibility is determined
- what `visual_verified` means at the content-contract level
- whether a node may be served with lesson + quiz + static_diagram but no interactive visual at all

Commit to one policy.

#### F. Edge semantic contract

Beyond unlock logic, define:

- what hard edges guarantee pedagogically
- what soft edges imply pedagogically
- whether soft edges affect recommendation UX
- whether edges may ever encode anything beyond hard/soft in V1

Commit to one policy.

#### G. Hard-fail vs graceful-degrade policy

Define what must cause graph rejection vs what may degrade gracefully.
Examples:

- missing lesson
- missing quiz
- missing diagnostic
- missing static diagram
- failed p5 generation
- partially weak visuals for a few nodes

Commit to one deterministic policy.

### Output Requirements

Respond with a structured markdown document and nothing else.

Your document must contain exactly these sections in this order:

# Graph Content Rules Pack

## 1. Design Decisions
A concise list of the major content-contract choices you made.

## 2. Graph Completeness Contract
Define the exact minimum artifact set required for a graph to be:

- valid for storage
- valid for serving
- valid for adaptive diagnostic use

Be explicit at graph and node level.

## 3. Node Artifact Contract
For each node artifact, define:

- purpose
- whether required or optional
- minimum completeness rule
- whether it is learner-facing
- whether it participates in gating or placement

Cover:

- `lesson_text`
- `static_diagram`
- `p5_code`
- `visual_verified`
- `quiz`
- `diagnostic_questions`

## 4. Lesson Rules
Define the exact lesson contract:

- structure
- length target
- tone
- allowed formatting
- example requirements
- formula/notation policy
- self-containment relative to prerequisites
- forbidden patterns

Make it operational for future generation and validation.

## 5. Quiz Rules
Define the exact mastery-quiz contract:

- number of questions
- schema expectations
- pass threshold
- retry rules
- explanation rules
- scoring expectations
- what the quiz is allowed to test
- what it must not test

Be explicit.

## 6. Diagnostic Rules
Define the exact diagnostic-question contract:

- coverage expectations
- count expectations
- relationship to node positions
- `difficulty_order` semantics
- distinction from mastery quiz content
- how future agents should think about diagnostic usefulness

Be explicit and practical.

## 7. Visual and Diagram Rules
Define the exact contract for:

- `static_diagram`
- `p5_code`
- `visual_verified`
- visual eligibility
- fallback behavior

You must define what minimum visual experience every node guarantees.

## 8. Edge Semantics
Define exactly what hard and soft edges mean pedagogically and operationally.
Include any non-gating implications in UX / recommendation logic if you choose to include them.

## 9. Acceptance / Rejection Rules
Define which content failures:

- reject the entire graph
- reject a node
- allow graph storage but not serving
- allow graceful degradation

Be deterministic.

## 10. Invariants
List the content invariants future agents must preserve.

## 11. V1 vs Future Notes
Briefly distinguish:

- what is intentionally simplified in V1
- what could be enriched later
- what would be dangerous to change without updating prompts, validators, or UI logic

## Hard Constraints

- Be decisive. Do not present multiple competing content strategies.
- Do not ask follow-up questions.
- Do not write route handlers.
- Do not write SQL migrations.
- Do not write frontend code.
- Do not write prompt templates here.
- Keep the content contract strict enough to implement and validate.
- Keep it practical for a solo-builder hackathon.
- Do not let students be blocked by non-essential enrichment failures.
- Do not allow vague phrases like "sufficient lesson" without defining sufficiency.

## Additional Guidance

A strong answer will:

- make "graph completeness" operational
- define exact node artifact requirements
- distinguish mastery quiz from diagnostic cleanly
- define when visuals are required vs optional
- define graceful degradation rigorously
- make later validation and UI logic almost mechanical

A weak answer will:

- leave lesson / quiz / diagnostic sufficiency vague
- fail to define what can degrade gracefully
- overcomplicate the content model
- conflate mastery quizzes with diagnostics
- make every visual mandatory without fallback
- leave edge semantics underspecified

Produce the final Graph Content Rules Pack now.
