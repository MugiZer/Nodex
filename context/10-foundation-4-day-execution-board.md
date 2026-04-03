# Foundation 4-Day Execution Board With Context File Tags

## Summary

Build Foundation in two lanes:

- **Deterministic app lane**: contracts, DB, retrieval primitives, graph reads/writes, frontend, tests
- **Controlled generation lane**: canonicalize, retrieve orchestration, graph generation, validators, reconciler, lesson/diagnostic/visual generation, store eligibility

Use a **thin orchestrator** only for generation. Keep **4 stable specialists** for the full build:

1. **Platform / Contracts**
2. **Data / Persistence**
3. **Generation Pipeline**
4. **Frontend / Integration / Tests**

Core execution rules:
- Build the **golden path first**, then harden edge cases
- Every round has **one integration owner**
- Every round ends with a **smoke test**
- **Day 3 is blocked unless Round 4 smoke passes**
- The generation subsystem operates on one typed **`GenerationRunState`**
- **No contract drift after Day 1 PM** without coordinated updates to types, schemas, fixtures, tests, and consumers
- If behind schedule, cut polish and edge sophistication before touching core flow integrity

## Global Context Loading Rules

Use the narrowest set that fully covers the task.

**Always load first**
- `context/01-overview.md`
- `context/README.md`

**Load by concern**
- Data model, API contracts, auth, retrieval, persistence: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`
- Pipeline sequencing and ownership: `context/03-generation-flow.md`, `context/08-pack-orchestration-prompts-content.md`
- Canonicalize and graph generator: `context/04-prompt-canonicalize-and-graph.md`
- Structure validator, curriculum validator, reconciler: `context/05-prompt-validators-and-reconciler.md`
- Diagnostics and visuals: `context/06-prompt-visuals-and-diagnostics.md`
- Progress, frontend, ops, testing, acceptance: `context/09-pack-progress-frontend-ops.md`
- Only if something appears inconsistent: `context/99-known-contradictions.md`

## Team Structure

### Agent 1: Platform / Contracts
Owns:
- `lib/types.ts`
- shared schemas/validators
- env guards
- provider wrappers
- request IDs, logging helpers
- shared error contracts

Default context files:
- `context/01-overview.md`
- `context/02-data-and-api.md`
- `context/07-pack-domain-db-retrieval.md`
- `context/08-pack-orchestration-prompts-content.md`
- `context/09-pack-progress-frontend-ops.md`

Done when:
- all shared payloads and domain types compile from one canonical source
- runtime validation exists for route and stage contracts
- logging/error helpers are reusable by all routes and stages

### Agent 2: Data / Persistence
Owns:
- Supabase plumbing
- SQL migrations
- indexes and pgvector setup
- retrieval data primitives
- graph/node/edge persistence
- progress persistence
- RLS baseline

Default context files:
- `context/01-overview.md`
- `context/02-data-and-api.md`
- `context/07-pack-domain-db-retrieval.md`
- `context/03-generation-flow.md`
- `context/09-pack-progress-frontend-ops.md`

Done when:
- local/dev DB schema is stable
- retrieval primitives return ranked candidates correctly
- graph/progress persistence works without contract ambiguity

### Agent 3: Generation Pipeline
Owns:
- canonicalize orchestration
- retrieve orchestration
- generation orchestrator
- graph generator
- validators
- reconciler
- lessons/diagnostics/visual stage contracts
- retry/repair behavior

Default context files:
- `context/01-overview.md`
- `context/02-data-and-api.md`
- `context/03-generation-flow.md`
- `context/04-prompt-canonicalize-and-graph.md`
- `context/05-prompt-validators-and-reconciler.md`
- `context/06-prompt-visuals-and-diagnostics.md`
- `context/08-pack-orchestration-prompts-content.md`

Done when:
- orchestrator runs the fixed stage order locally
- stage outputs validate against schemas
- retry and abort behavior are deterministic and logged

### Agent 4: Frontend / Integration / Tests
Owns:
- landing flow
- diagnostic flow
- graph page
- node panel
- visual rendering boundary
- integration tests
- E2E smoke path
- round handoff docs when acting as integration owner

Default context files:
- `context/01-overview.md`
- `context/02-data-and-api.md`
- `context/03-generation-flow.md`
- `context/06-prompt-visuals-and-diagnostics.md`
- `context/09-pack-progress-frontend-ops.md`

Done when:
- user-facing routes consume only shared contracts
- golden path UI works against real route behavior
- round smoke checks pass and are documented

## Contract Freeze

After **Day 1 PM**:
- no payload shape changes without integration-owner approval
- any approved contract change must update:
  - shared type
  - runtime schema
  - fixtures
  - integration tests
  - route/stage consumers

This freeze applies to:
- graph payload
- progress payload
- stage contracts
- generation state shape
- route response envelopes

Context files governing freeze:
- `context/02-data-and-api.md`
- `context/07-pack-domain-db-retrieval.md`
- `context/08-pack-orchestration-prompts-content.md`
- `context/09-pack-progress-frontend-ops.md`

## Generation State Contract

All generation stages read/write a single typed `GenerationRunState` object.

Minimum state fields:
- request metadata and correlation IDs
- raw prompt
- canonicalized subject/topic/description plus canonical semantic metadata, canonicalization source, candidate-confidence metadata, and canonicalization version
- retrieval candidates and retrieval decision
- selected execution path: cache hit or generate
- generated graph draft
- validator outputs
- reconciled graph
- lesson bundle
- diagnostic bundle
- visual bundle
- store eligibility decision
- final graph ID when stored
- structured error/log trail

Rule:
- stage-local payloads may exist, but the orchestrator truth is the single typed `GenerationRunState`

Context files:
- `context/03-generation-flow.md`
- `context/08-pack-orchestration-prompts-content.md`
- `context/02-data-and-api.md`

## Retry Policy

### Retryable
- malformed JSON
- schema mismatch
- incomplete required fields
- validator-repairable graph/content issue
- short transient upstream/provider failure within bounded retry budget

### Terminal / Non-retryable
- invalid user input after canonicalization
- missing required env/tool dependency
- DB/store failure after allowed retry budget
- duplicate conflict after final recheck resolution
- provider unavailable beyond threshold
- second failed schema/content repair attempt
- any condition that would require partial persistence

Rule:
- one repair retry for normal schema/content failures
- canonicalize uses a grounded hybrid lane, then deterministic normalization, and then one targeted repair call if the semantic draft is still invalid
- no infinite loops
- no silent retries
- each retry logs why it happened
- Live canary acceptance should key off stable public outputs (`subject`, `topic`, rendered `description`) or semantic-equivalent normalized metadata, not raw byte identity of the pre-render draft
- Canonicalize logs should truncate invalid draft payloads and validation details to bounded structured summaries rather than dumping arbitrarily large raw content

Context files:
- `context/02-data-and-api.md`
- `context/04-prompt-canonicalize-and-graph.md`
- `context/05-prompt-validators-and-reconciler.md`
- `context/06-prompt-visuals-and-diagnostics.md`
- `context/08-pack-orchestration-prompts-content.md`

## De-scope Ladder

If behind schedule, cut in this order:
1. advanced responsive polish
2. resume/restart sophistication
3. version-pinning extras beyond required baseline
4. richer interactive visuals beyond static fallback
5. fancy loading/progress UX
6. non-essential retry nuance

Never cut:
- contract integrity
- graph read/write correctness
- progress persistence
- unlock logic
- generation validation
- no-partial-store guarantee
- end-to-end demo golden path

Context files:
- `context/03-generation-flow.md`
- `context/07-pack-domain-db-retrieval.md`
- `context/08-pack-orchestration-prompts-content.md`
- `context/09-pack-progress-frontend-ops.md`

## Day 1

### Round 1: Foundation
**Integration Owner**: Agent 1

**Files / Areas**
- `lib/types.ts`
- shared schemas/validators
- `lib/supabase.ts`
- `lib/anthropic.ts`
- `lib/openai.ts`
- logging/error helpers
- DB migrations
- pure domain helpers
- test scaffold

**Task tags by agent**
- Agent 1: contracts, schemas, env guards, logging
  - Context: `context/01-overview.md`, `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 2: migrations, Supabase clients, retrieval DB helpers
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: pure helpers for retrieval ranking, unlocks, diagnostic movement, quiz scoring
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 4: fixture layout, mocks, test harness
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Canonical types and DTOs
- Runtime schemas for graph/node/edge/content/progress payloads
- Request ID and timing utilities
- Provider wrappers with env checks
- Supabase migration baseline for `graphs`, `nodes`, `edges`, `user_progress`
- Pure helpers for retrieval ranking, unlock logic, diagnostic movement, quiz scoring
- Fixture and mock test harness

**Smoke Test**
- run unit tests for schemas and pure helpers

**Merge Gate**
- single source of truth for contracts
- no duplicated schema definitions
- pure helper tests passing
- migration plan stable enough for route work

### Round 2: Retrieval and runtime backbone
**Integration Owner**: Agent 2

**Files / Areas**
- `app/api/generate/canonicalize/route.ts`
- `app/api/generate/retrieve/route.ts`
- `app/api/graph/[id]/route.ts`
- progress write route(s)
- integration tests

**Task tags by agent**
- Agent 1: route payload schemas and error envelopes
  - Context: `context/02-data-and-api.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 2: retrieval data primitives, graph read path, progress persistence path
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: canonicalize-to-retrieve orchestration, threshold policy, flagged handling
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: integration coverage for hit/miss, reads, writes
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Canonicalize route with strict validation and descriptive errors
- Retrieval split clearly:
  - Agent 2 owns retrieval data primitives
  - Agent 3 owns retrieval orchestration
- Graph read route returning `{ graph, nodes, edges, progress }`
- Progress write semantics for pass/fail, attempts, counters, completion
- Integration coverage for retrieve hit/miss, graph payload, unlock updates

**Smoke Test**
- create/read graph plus write progress in local/dev DB

**Merge Gate**
- existing graphs can be retrieved
- graph payload reads are stable
- progress writes persist correctly
- unlock behavior works without generation path

## Day 2

### Round 3: Controlled generation workflow
**Integration Owner**: Agent 3

**Files / Areas**
- shared generation modules
- graph pipeline stage modules
- lesson/diagnostic/visual stage modules
- stage validators

**Task tags by agent**
- Agent 1: `GenerationRunState`, stage schemas, orchestrator typing
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 2: retrieval/store prerequisites callable from orchestrator
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 3: graph generator, structure validator, curriculum validator, reconciler, orchestration logic
  - Context: `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: diagnostics/visual contracts and fallback validation tests
  - Context: `context/03-generation-flow.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Thin orchestrator using internal functions, not route-to-route HTTP
- Fixed stage runner:
  1. canonicalize
  2. retrieve
  3. graph generate
  4. structure validate
  5. curriculum validate
  6. reconcile
  7. lessons
  8. diagnostics
  9. visuals
  10. final eligibility check
- Structure and curriculum validators run in parallel
- Reflection only on invalid/malformed high-risk outputs
- Validated lesson, quiz, static diagram, diagnostic, and visual outputs
- All stages read/write `GenerationRunState`

**Smoke Test**
- run fixture-backed in-memory generation pipeline

**Merge Gate**
- full in-memory generation succeeds
- malformed stage output fails cleanly
- retry reasons are logged
- no stage improvises outside its schema contract

### Round 4: Persistence and duplicate safety
**Integration Owner**: Agent 2

**Files / Areas**
- `app/api/generate/store/route.ts`
- `app/api/generate/route.ts`
- persistence/remap helpers
- duplicate/idempotency tests
- smoke harness utilities

**Task tags by agent**
- Agent 1: route envelopes and schema-safe state transitions
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 2: store path, UUID remap, duplicate recheck, DB guarantees
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/03-generation-flow.md`
- Agent 3: top-level generate orchestration and cache/store/failure routing
  - Context: `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: duplicate/no-partial-store tests and replayable traces
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Temp node ID to persisted UUID remap
- Graph/node/edge storage flow
- Pre-store duplicate recheck
- Generate route that chooses:
  - cached return
  - fresh generation
  - retryable failure
  - terminal failure
- No partial persistence on failed generation
- Replayable provider-mock traces

**Smoke Test**
- submit prompt and get either cached graph or newly stored graph

**Merge Gate**
- prompt returns either cached graph or newly stored graph
- duplicate-safe store behavior is working
- failed runs persist nothing
- top-level logging and failure taxonomy are wired through

**Hard Gate**
- **Day 3 cannot begin unless Round 4 smoke passes**

## Day 3

### Round 5: Entry flow and diagnostic experience
**Integration Owner**: Agent 4

**Files / Areas**
- `app/page.tsx`
- auth bootstrap code
- `app/graph/[id]/diagnostic/page.tsx`
- `components/DiagnosticFlow.tsx`
- diagnostic tests

**Task tags by agent**
- Agent 1: frontend-facing contracts stay frozen and valid
  - Context: `context/02-data-and-api.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 2: anonymous auth/session plumbing
  - Context: `context/02-data-and-api.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: generated diagnostic content remains consumable by UI
  - Context: `context/03-generation-flow.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 4: landing flow and diagnostic UX
  - Context: `context/01-overview.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Landing page prompt submission and loading states
- Anonymous Supabase auth bootstrap
- Diagnostic page using exact adaptive movement rules
- Deterministic recommended entry-point result
- Tests for start node, movement, stop conditions, and entry-point selection

**Smoke Test**
- anonymous user lands in diagnostic and gets recommended entry node

**Merge Gate**
- new anonymous learner can submit prompt
- system retrieves or generates graph
- diagnostic runs correctly
- learner gets a stable recommended entry point

### Round 6: Core graph learning experience
**Integration Owner**: Agent 4

**Files / Areas**
- `app/graph/[id]/page.tsx`
- `components/GraphCanvas.tsx`
- `components/NodePanel.tsx`
- `components/P5Sketch.tsx`

**Task tags by agent**
- Agent 1: UI consumes only shared graph/progress contracts
  - Context: `context/02-data-and-api.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 2: progress read/write support for post-quiz refresh
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: lesson/visual content contracts are safe to render
  - Context: `context/03-generation-flow.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: graph shell, graph canvas, node panel, p5 boundary
  - Context: `context/01-overview.md`, `context/03-generation-flow.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Graph page server shell and deterministic layout prep
- React Flow graph with locked/available/completed/recommended/active states
- Hard edges solid, soft edges dashed
- Node panel with lesson, visual area, quiz, and pass/fail updates
- Verified-only p5 execution with static fallback
- Immediate recomputation of derived node state after quiz writes

**Smoke Test**
- complete one quiz and unlock one downstream node

**Merge Gate**
- learner can open available node
- lesson renders
- visual fallback is safe
- quiz writes persist
- downstream nodes unlock correctly

## Day 4

### Round 7: Hardening and observability
**Integration Owner**: Agent 1

**Files / Areas**
- all route handlers
- shared logging/error modules
- edge-case tests
- responsive UI polish

**Task tags by agent**
- Agent 1: route-wide error normalization and logging contracts
  - Context: `context/01-overview.md`, `context/02-data-and-api.md`, `context/08-pack-orchestration-prompts-content.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 2: DB/retrieval failure path handling
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: generation edge-case classification
  - Context: `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: responsive polish and degraded-state UX
  - Context: `context/01-overview.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Route-level `try/catch` everywhere
- Descriptive JSON error responses everywhere
- Structured logs for pipeline stages and progress milestones
- Coverage for flagged-for-review, resume, restart, version pinning, empty retrieval, visual verification failures
- Mobile-safe landing, diagnostic, graph, and panel layouts

**Smoke Test**
- force one failure per major category and verify logs/errors

**Merge Gate**
- major failure paths are explicit and logged
- route behavior matches context contracts
- UI is usable on desktop and mobile
- no silent failure or partial-truth path remains

### Round 8: Verification and demo lock
**Integration Owner**: Agent 4

**Files / Areas**
- test suite
- build/lint fixes
- deployment/demo checklist docs
- smoke scripts

**Task tags by agent**
- Agent 1: final contract and type regression pass
  - Context: `context/02-data-and-api.md`, `context/08-pack-orchestration-prompts-content.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 2: real env, persistence, retrieval smoke
  - Context: `context/02-data-and-api.md`, `context/07-pack-domain-db-retrieval.md`, `context/09-pack-progress-frontend-ops.md`
- Agent 3: generation path within retry/error model
  - Context: `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, `context/06-prompt-visuals-and-diagnostics.md`, `context/08-pack-orchestration-prompts-content.md`
- Agent 4: demo rehearsal, smoke docs, UX lock
  - Context: `context/01-overview.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

**Deliverables**
- Final regression pass on lint, typecheck, tests, build
- Real-env smoke against Supabase and provider keys
- Demo-path UX copy tightened
- Env checklist, smoke checklist, and demo script
- Fallback demo dataset/process only as operational backup, not fake app behavior

**Smoke Test**
- full demo rehearsal

**Merge Gate**
- MVP-complete flow works end-to-end
- demo path is stable
- real retrieval, generation, persistence, diagnostic, and unlock logic are verified

## Golden Path Rule

Before prioritizing edge cases, prove one complete happy path:
- one supported subject
- one retrieval or generation success
- one diagnostic run
- one node completion
- one downstream unlock

Context files for golden path:
- `context/01-overview.md`
- `context/02-data-and-api.md`
- `context/03-generation-flow.md`
- `context/06-prompt-visuals-and-diagnostics.md`
- `context/09-pack-progress-frontend-ops.md`

Only after that harden:
- flagged-for-review behavior
- resume/restart nuance
- version edge cases
- extra retry nuance
- advanced polish

## Test Plan

- Unit tests for schema validation, retrieval ranking, unlock computation, diagnostic movement, quiz scoring
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`
- Integration tests for canonicalize, retrieve hit/miss, graph payload reads, progress writes, generate-to-store
  - Context: `context/02-data-and-api.md`, `context/03-generation-flow.md`, `context/04-prompt-canonicalize-and-graph.md`, `context/08-pack-orchestration-prompts-content.md`
- Fixture-backed pipeline tests for graph, validators, reconciler, diagnostics, visuals
  - Context: `context/04-prompt-canonicalize-and-graph.md`, `context/05-prompt-validators-and-reconciler.md`, `context/06-prompt-visuals-and-diagnostics.md`
- End-to-end smoke for prompt -> graph -> diagnostic -> quiz -> unlock
  - Context: `context/01-overview.md`, `context/03-generation-flow.md`, `context/09-pack-progress-frontend-ops.md`

## Assumptions and Defaults

- Keep the 4-day target.
- Keep 4 stable specialist agents rather than reshuffling each round.
- Use the `context/` pack as product truth and local Next.js docs as framework truth.
- Store nothing partial from failed generation runs.
- Treat the generation subsystem as the only meaningfully agentic part of the product.
- Frontend cannot invent contracts, and pipeline code cannot invent DB semantics.
- If any task hits an apparent spec conflict, load `context/99-known-contradictions.md` before changing the plan.
