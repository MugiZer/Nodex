# Contract Packs: Progress, Frontend, Ops

This file is the working reference for Packs 7, 8, and 9 from the source `AGENTS.md`.

Its job is to convert those pack sections from open decision prompts into inherited implementation contracts. For this file, the authority order is:

1. `context/02-data-and-api.md`
2. `context/03-generation-flow.md`
3. `context/04-prompt-canonicalize-and-graph.md`
4. `context/05-prompt-validators-and-reconciler.md`
5. `context/06-prompt-visuals-and-diagnostics.md`
6. this file

This file must not reopen lower-level decisions that are already fixed there.

---

## Pack 7: Progress + Diagnostic + Unlock

### Purpose

Define the learner-state contract for:

- progress persistence
- adaptive diagnostic behavior
- completion semantics
- unlock semantics
- resume and restart behavior
- graph-version pinning
- `flagged_for_review` learner impact

### Inherited Lower-Level Baselines

- Progress identity is `(user_id, node_id, graph_version)`
- `completed` and `attempts` live in `user_progress`
- unlock state is derived from completion plus incoming `hard` edges
- diagnostic questions are generated server-side and stored on nodes
- diagnostic scoring and placement are client-side
- progress is pinned to the graph-version row the learner started on
- new learners and explicit restarts should prefer the latest usable unflagged version
- existing pinned learners may continue on a flagged version

### Source Of Truth Model

#### Persisted

- `user_progress.completed`
- `user_progress.attempts`
- `nodes.attempt_count`
- `nodes.pass_count`

#### Derived

- latest attempt for a node = last element of `user_progress.attempts`
- highest score for a node = max score in `user_progress.attempts`
- unlock state = all incoming `hard` prerequisites completed
- node state (`locked`, `available`, `completed`) = function of `completed` plus incoming `hard` edges
- recommended resume target = first available incomplete node, using the deterministic rule below

#### Client-Local Only In V1

- in-progress diagnostic answers
- diagnostic current step
- diagnostic local score history during the placement flow
- diagnostic result cache before the learner starts persisted node progress
- currently open node panel

#### Not Persisted In V1

- diagnostic answer-by-answer history
- a separate unlock table
- a separate current-node backend field
- a separate entry-point backend field

### Progress Source Of Truth

The canonical learner-state truth is:

- node completion truth lives in `user_progress.completed`
- node attempt history truth lives in `user_progress.attempts`
- graph progression truth is computed from completed nodes plus `hard` edges
- node analytics truth lives in `nodes.attempt_count` and `nodes.pass_count`

There is exactly one logical progress record per `(user_id, node_id, graph_version)`.

If the learner later reopens or retries a completed node:

- the node remains completed
- the new attempt is appended to `attempts`
- a failed retry does not revoke completion

### Diagnostic Persistence Contract

Diagnostic question generation is server-side, but diagnostic execution is client-side.

V1 policy:

- diagnostic answers are not written to Supabase
- diagnostic placement scoring is not handled by an API route
- diagnostic result may be cached client-side for the current learner session for UX continuity
- diagnostic result does not become a persisted backend source of truth
- persisted learner state begins when node-level `user_progress` records begin
- route and stage code that parses DB rows must preserve parse-site attribution in errors, especially for retrieval candidates, graph rows, and user progress rows; raw schema errors are too ambiguous to diagnose when timestamps drift

Practical consequences:

- a learner can leave and return to the diagnostic within the same browser/session if local UI state is still available
- cross-device diagnostic resume is not supported in V1
- once the learner has started persisted node progress on a graph version, the app should resume from persisted progress rather than rerunning diagnostic automatically
- the learner-scored prerequisite bundle for a resolved graph must also be mirrored to a server-side request record so lesson routes and graph reloads do not rely exclusively on client `sessionStorage`

### Diagnostic Entry Requirement

For a learner starting a graph version with no existing `user_progress` rows for that graph version:

- the diagnostic route is the required first interactive step
- the graph may be displayed as context, but node learning should not begin until diagnostic completes
- learner entry into a lesson route must be blocked until the target lesson resolves through the server-backed lesson resolver

For a learner with existing persisted progress on that graph version:

- skip diagnostic by default
- resume directly into the graph experience using persisted progress

### Adaptive Diagnostic Algorithm

#### Inputs

- final node list with `position`
- per-node `diagnostic_questions`
- total distinct graph positions

#### Initial Node Selection

1. Sort nodes by `position`, then by stable node id
2. Compute `startPosition = Math.floor(maxPosition / 2)`
3. Select the first node at `startPosition` in stable sorted order
4. If no node exists exactly at `startPosition`, choose the nearest position that exists, preferring lower positions before higher ones

#### Movement Rules

- correct answer -> target position = current position + 2
- wrong answer -> target position = current position - 2
- clamp target position to the valid position range

#### Repeated-Position Rule

- never ask the exact same node twice in one diagnostic run
- if the target position has another unasked node, use the first unasked node there by stable node id
- if the target position has no unasked nodes, scan outward one position at a time in the movement direction first, then in the opposite direction, until an unasked node is found
- if no unasked nodes remain anywhere, stop early

#### Question Count And Stop Conditions

Stop when the first of these happens:

1. 8 questions have been asked
2. no unasked diagnostic node remains
3. the graph contains fewer than 8 nodes and all have been used

The UI may describe the experience as a 5-8 question adaptive diagnostic, but the hard cap remains 8.

#### Entry-Point Selection

After the diagnostic ends:

- collect all correctly answered nodes
- if at least one answer was correct, entry point = the highest `position` among correctly answered nodes
- if no answers were correct, entry point = the lowest available graph position
- if all asked answers were correct and the walk reached the top boundary, entry point = highest graph position reached correctly

#### Tie-Breaking Within A Position

If multiple nodes share the entry-point position:

- the recommended entry node is the first node at that position by stable node id
- the graph should still mark all nodes at that position as available if their `hard` prerequisites are satisfied

### Completion Semantics

- completion is binary
- completion is earned from the mastery quiz, not from the diagnostic
- diagnostic success never marks a node completed
- once completed, a node remains completed for that learner on that graph version
- each node has 3 mastery quiz items
- passing requires at least 2 correct answers out of 3
- learners may reattempt incomplete nodes immediately
- learners may also reopen completed nodes and retake the quiz
- later failed retries do not unset `completed`
- completion is never revoked automatically in V1

### Unlock Semantics

- a node is `available` if and only if all incoming `hard` prerequisites are completed
- `soft` edges never block unlock
- `position` alone never blocks unlock
- recommended path may use position for UI guidance, but actual gating uses only completion plus incoming `hard` edges
- unlock truth is derived, not stored
- the same unlock algorithm must be computable on both server and client
- the client may compute availability from the fetched graph payload and `progress`
- the server may compute or validate the same logic during progress writes and graph payload generation
- if client and server disagree, the server-derived interpretation wins
- if a learner reaches an available node and completes it, that completion is valid even if it is not the UI’s recommended next node
- out-of-order relative to `position` is allowed as long as `hard` prerequisites are satisfied
- `soft` edges may inform recommendation or styling only

### Progress Write Contract

#### On Quiz Pass

1. append `{ score, timestamp }` to `user_progress.attempts`
2. set `user_progress.completed = true`
3. increment `nodes.attempt_count`
4. increment `nodes.pass_count`
5. recompute downstream availability from incoming `hard` edges
6. if `attempt_count > 10` and `pass_count / attempt_count < 0.4`, mark the owning graph version `flagged_for_review = true`

#### On Quiz Fail

1. append `{ score, timestamp }` to `user_progress.attempts`
2. increment `nodes.attempt_count`
3. do not increment `nodes.pass_count`
4. do not change `user_progress.completed`
5. do not change unlock state except through the unchanged completion set

#### Duplicate Submission Rule

- the quiz submit UI must disable repeat submission while a write is in flight
- the backend should treat an exact duplicate request payload received immediately after a successful write as a no-op if it can detect the duplicate safely
- if duplicate detection is not available, the frontend prevention rule is the primary safeguard

### Resume And Version-Pinning Rules

- a learner with existing `user_progress` on a graph version remains pinned to that version
- newer graph versions do not silently migrate in-progress learners
- explicit restart is the only path that changes the learner to a newer version
- when a learner returns to an in-progress graph version, fetch `{ graph, nodes, edges, progress }`, compute available nodes, and default-highlight the first available incomplete node by lowest `position`, then stable node id
- do not auto-open the panel in V1; highlight the recommended node and let the learner click
- restart means: stop using the currently pinned version for active learning, rerun routing against the latest usable unflagged version, rerun the diagnostic for that version, and keep old `user_progress` rows intact for history

### `flagged_for_review` Learner Rules

- existing pinned learners may continue on a flagged graph version
- new learners should not be routed to a flagged version if an unflagged usable version exists
- explicit restart should prefer the latest usable unflagged version
- if only flagged candidates qualify, retrieval should treat that as a miss and generation should produce a new candidate

### Pack 7 Invariants

- `completed` and `attempts` are the only canonical per-node learner progress fields in V1
- unlock state is never stored as separate truth
- diagnostic never grants completion
- completion never auto-revokes
- version pinning never changes silently
- restarts do not destroy prior progress history

### Pack 7 Closure

- `PACK9-01` through `PACK9-08` are resolved by the rules above

---

## Pack 8: Frontend Contract

### Purpose

Define the concrete frontend behavior for:

- routes
- page/component responsibilities
- server/client boundaries
- data fetching
- graph layout
- React Flow rendering
- node state UX
- diagnostic UX
- generation/loading/failure UX
- NodeDetailPanel behavior
- responsiveness

### Demo-Optimized UI Direction

The V1 learner experience is now simplified around a three-screen demo flow:

1. prompt screen
2. graph screen
3. lesson screen

This is the primary UI direction for the repo unless a later file explicitly overrides it.

#### Demo Story

- the learner types a prompt
- the system builds a graph
- the first node opens into a genuine lesson experience
- the learner returns to the graph after completion and sees visible progression

#### Screens

##### 1. Prompt Screen

- single centered input on a clean page
- prompt text: `What do you want to learn?`
- submit on enter
- show a subtle loading message while generation runs
- the loading state should feel like the system is thinking, not buffering
- no intermediate confirmation screen is required when the graph is ready

##### 2. Graph Screen

- render the full graph with deterministic DAG layout
- use React Flow plus a layered layout helper such as dagre
- no physics layout
- the graph should read top-to-bottom or left-to-right as a clear path
- node 1 should be visually emphasized on first arrival
- after a short pause, node 1 should auto-select and open the detail panel
- the graph should be the only navigation surface in this screen

##### 3. Lesson Screen

- full-screen lesson view
- the graph is hidden during the lesson
- lesson content is centered and scrollable
- no tabs, minimap, side navigation, or settings chrome
- completion returns the learner to the graph with visible state change

#### Visual Language

- blue = available
- green = completed
- gray = pending
- avoid red in the learner-facing demo UI
- arrows should remain visible but secondary
- the interface should feel clean, calm, and guided rather than dashboard-like

#### Demo Transition Rules

- prompt to graph: fade out the prompt and fade in the graph
- node select: slide the right-side panel in
- graph to lesson: crossfade into the lesson view
- lesson complete to graph: crossfade back and reflect the updated node state

#### Explicit Exclusions

- no minimap
- no visible zoom controls by default
- no list or grid toggle
- no tab bars in the lesson
- no settings/profile/header navigation in the demo flow
- no confetti or celebratory fireworks
- no blocking skeleton screens

#### Lesson Shape

- the lesson should be a continuous scroll, not a tabbed interface
- prediction trap first
- guided insight next
- interactive visual only if it is practical for the demo topic
- worked example next
- what-if question next
- mastery check next
- anchor and return-to-graph last

#### Node State UX

- available nodes should be clearly clickable
- completed nodes should remain clickable for review
- pending nodes should appear gray and muted
- hovered pending nodes may show `Coming soon`
- panel copy should stay friendly and non-gatekeeping

#### Completion Feedback

- completing a lesson must visibly update the graph
- the completed node should turn green
- newly unlocked downstream nodes should already appear available when the learner returns
- the product moment is the graph changing because of learner action

#### Implementation Notes

- keep the number of learner-facing states small
- favor CSS transitions over animation libraries
- preserve the real learning flow even when interactive visuals are omitted or fall back
- the demo should remain functional if the visual beat is skipped

### Route Set

The V1 route set is fixed to:

- `app/page.tsx`
- `app/graph/[id]/page.tsx`
- `app/graph/[id]/lesson/[nodeId]/page.tsx`

Do not add extra learner-visible frontend routes in V1 unless another file explicitly makes them necessary.
The demo flow has exactly three learner-visible screens: prompt, graph, and lesson.
Any adaptive placement or recommendation work must not add a fourth screen to the demo.

### Route Responsibilities

#### `app/page.tsx`

- landing page for prompt submission
- primary CTA for “what do you want to learn?”
- submits to `POST /api/generate`
- routes to the selected graph after cache hit or generation success

#### `app/graph/[id]/page.tsx`

- renders the graph learning experience
- consumes graph content plus learner progress
- computes node states from persisted progress and graph structure
- owns the graph + panel interaction shell
- auto-selects the first available node after the graph appears
- opens the right panel after a short absorb-the-graph pause
- routes the learner into the lesson screen when they click Start lesson

#### `app/graph/[id]/lesson/[nodeId]/page.tsx`

- renders the full-screen lesson experience
- hides the graph while the learner is in learning mode
- shows the node title in a subtle top bar with a back link to the graph
- renders the seven-beat lesson flow as one continuous scroll
- returns the learner to the graph after completion

### Component Responsibility Map

#### `GraphCanvas`

- renders React Flow nodes and edges
- reflects node states visually
- handles pan/zoom/click on graph nodes
- never owns canonical learner progress truth

#### `NodeCard`

- custom React Flow node renderer
- shows the colored rounded node body, title, and click target
- reflects available, completed, and pending states
- visually emphasizes node 1 on first arrival

#### `NodeDetailPanel`

- right-side panel for the graph screen
- shows the node title, learning objective, CTA, prerequisites, and unlocks
- keeps the panel content sparse and demo-focused
- does not render the full lesson

#### `FlagshipLesson`

- renders the seven-beat lesson content
- manages selection state for prediction, what-if, and mastery interactions
- optionally renders a hand-built interactive visual for the demo topic
- uses `renderLessonText` for all lesson copy

#### `renderLessonText`

- parses lesson text for `$...$`, `$$...$$`, `**...**`, `*...*`, and paragraph breaks
- returns renderable React content
- stays presentation-only and does not own lesson state

### Server / Client Boundary

#### Server-Heavy Pages

- `app/page.tsx`
- `app/graph/[id]/page.tsx`
- `app/graph/[id]/lesson/[nodeId]/page.tsx`

These pages fetch initial route data on the server and pass interactive data into client components.

#### Client Components

- `GraphCanvas`
- `NodeCard`
- `NodeDetailPanel`
- `FlagshipLesson`
- `renderLessonText`

### Data-Fetching Contract

#### Graph Content Fetch

`GET /api/graph/[id]` is the canonical frontend graph payload source and returns:

- `graph`
- `nodes`
- `edges`
- `progress`

This payload is only trustworthy when the live DB contract matches the required read surfaces:

- `graphs` rows must expose the graph read contract
- `nodes` rows must expose the node read fields needed to deterministically derive or preserve `lesson_status` in the API payload
- `edges` rows must expose the edge read contract
- `user_progress` rows must expose the progress read contract
- DB timestamps must already have been normalized through the shared DB timestamp schema before domain parsing

Incremental payload rule:

- every node includes `lesson_status`
- `pending`, `ready`, and `failed` are distinct server-truth states
- pending nodes may legally have null lesson/quiz/diagnostic/visual fields
- polling repeated `GET /api/graph/[id]` requests is the default V1 way to observe readiness transitions

V1 policy:

- fetch graph content and progress together
- do not split graph content and learner progress into separate initial-route requests in V1
- do not render the interactive graph state before both graph content and progress are available

#### Diagnostic Route Data

The adaptive placement logic remains part of the backend/frontend data contract, but it must not surface as an extra learner-visible screen in the demo flow.

`app/graph/[id]/page.tsx` should fetch the same graph payload shape or an equivalent server-prepared subset containing:

- graph metadata
- nodes with `diagnostic_questions`
- edges if needed for movement/context
- progress to detect whether the learner should skip diagnostic

The graph screen may use this data to preselect the recommended starting node, but the learner stays on the graph screen until they choose Start lesson.

#### Revalidation

- graph generation routes are dynamic
- graph view payloads should be treated as dynamic per learner because `progress` is included
- no aggressive frontend caching layer is required beyond normal route fetch behavior

### Graph Layout Policy

- the database does not store rendered XY coordinates in V1
- rendered coordinates are derived on load
- layout is deterministic for the same graph input
- `node.position` is the primary layer signal
- nodes with the same `position` share the same layer
- stable node id determines within-layer ordering
- use a deterministic layered DAG layout rather than a force layout baseline

### React Flow Contract

#### Node Identity

- React Flow node id = persisted node UUID
- do not use temporary LLM ids on the frontend

#### Node Data Contract

Each rendered graph node should at least have access to:

- `id`
- `title`
- `position`
- node state (`locked`, `available`, `completed`, `recommended`, `active`)
- visual availability signal (`visual_verified`)
- lesson/quiz presence metadata if needed

#### Edge Rendering

- `hard` edges render as solid lines
- `soft` edges render as dashed lines
- only `hard` edges affect availability

#### Clickability

- locked nodes are visible but not openable for learning
- available nodes are clickable
- completed nodes remain clickable for review
- the currently active node remains selectable as the already-open node

### Visual State Model

#### `locked`

- prerequisites not yet satisfied
- visually muted
- not openable

#### `available`

- prerequisites satisfied
- visually emphasized as learnable
- clickable

#### `recommended`

- overlay on top of `available`
- used for diagnostic entry-point highlight or resume target highlight
- still clickable like any available node

#### `active`

- currently open in `NodeDetailPanel`
- visually distinct from merely available

#### `completed`

- persisted completion achieved
- visually green per the original product direction
- remains clickable for review and reattempt

State precedence for rendering:

1. `active`
2. `completed`
3. `recommended`
4. `available`
5. `locked`

### Diagnostic UX Contract

- the demo must not introduce a separate learner-visible diagnostic screen
- placement may happen before graph entry or as hidden graph-state computation, but the demo flow remains prompt -> graph -> lesson -> graph
- the graph screen may preselect the recommended entry node on first arrival
- the graph screen may show the available node state immediately without requiring a separate diagnostic page
- same-session browser resume is allowed through client-local state
- cross-device persistence of unfinished placement is not supported in V1
- the user-facing copy should talk about finding a starting point, not about scoring or assessment mechanics

### Generation / Loading / Failure States

After the learner submits a prompt from `app/page.tsx`:

1. show a loading state immediately
2. call `POST /api/generate`
3. navigate once a real `graph_id` is returned
4. poll `GET /api/graph/[id]` for pending -> ready transitions during a miss path

Recommended stage messages:

- canonicalizing topic
- checking for an existing graph
- generating graph
- generating lessons
- generating diagnostics
- generating visuals
- storing graph

Other rules:

- cache hits should keep the loading experience brief
- cache misses should show simple sequential progress messaging
- do not fake precise percentages
- do not pretend generation is complete before store succeeds
- retryable failures should show a retry CTA
- non-retryable failures should show a descriptive error message and a path back to the landing page
- missing graph id or malformed payload is a hard failure and should not navigate

### NodeDetailPanel Contract

- panel state is client-local in V1
- clicking an available or completed node opens the panel
- closing the panel does not affect learner progress
- the panel is graph navigation, not the lesson itself
- panel content order:
  1. node title
  2. one-sentence learning objective
  3. primary CTA: Start lesson
  4. prerequisites text
  5. unlocks text
- available nodes use a primary blue CTA
- completed nodes use a secondary review CTA
- pending nodes show friendly coming-soon copy when relevant
- broken interactive visuals must never affect panel availability or route selection
- panel action should route into the lesson screen for the selected node
- the panel should stay sparse and should not grow into a dashboard

### Mobile And Responsiveness Rules

- V1 is desktop-first but must remain usable on mobile
- graph canvas supports pan/zoom
- node labels remain readable or truncate safely
- `NodeDetailPanel` becomes a bottom sheet or full-height overlay on narrow screens
- `FlagshipLesson` remains fully usable on mobile
- the landing page remains usable on mobile
- graph exploration may be less comfortable on small screens than on desktop, but must remain functional

### Pack 8 Invariants

- the route set stays limited to the named V1 routes unless another file explicitly expands it
- React Flow uses persisted node UUIDs
- only `hard` edges gate availability
- UI state must not drift from persisted/derived learner-state semantics
- graph rendering must stay deterministic for the same graph payload

### Pack 8 Closure

- `PACK9-09` through `PACK9-18` are resolved by the rules above

---

## Pack 9: Ops / Deployment / Logging / Tests / Acceptance Criteria

### Purpose

Define the V1 operational contract for:

- deployment target
- environment contract
- observability and logging
- performance and cost guardrails
- resilience expectations
- testing scope
- safety boundaries
- acceptance criteria

### Deployment Contract

- Primary deployment target: Vercel for the Next.js app plus Supabase for database/auth.
- Acceptable fallback: local demo environment using the same real external services.
- Runtime assumption: server routes run in a trusted server environment with access to `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`.
- Do not build the demo around mocked persistence, mocked retrieval, or mocked graph generation.

### Environment Variable Contract

#### Required server-only variables

- `ANTHROPIC_API_KEY`
  - purpose: all LLM generation stages
  - if missing: generation routes fail fast with descriptive server error
- `OPENAI_API_KEY`
  - purpose: embeddings for retrieval
  - if missing: retrieval/generation routes fail fast with descriptive server error
- `SUPABASE_SERVICE_ROLE_KEY`
  - purpose: trusted server reads/writes
  - if missing: graph and progress server routes fail fast with descriptive server error

#### Required public variables

- `NEXT_PUBLIC_SUPABASE_URL`
  - purpose: client-side Supabase auth bootstrap
  - if missing: app should fail clearly at startup/build
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - purpose: anonymous auth session bootstrap
  - if missing: app should fail clearly at startup/build

### Observability And Logging Contract

- Plain `console.log` / `console.error` output is sufficient for V1.
- Every request to `POST /api/generate` should log:
  - request id
  - prompt hash or other non-sensitive correlation identifier
  - stage start / stage end
  - stage durations
  - cache hit vs generation path
  - final graph id on success
  - synchronous curriculum placeholder state when the graph route detaches curriculum auditing
- Detached curriculum audits should log as their own event family with attempt count, failure category, outcome bucket, parse-error summary, and persisted request fingerprint.
- Store/write failures for detached curriculum audits should be logged separately from the audit result classification so operators can distinguish generation failure from persistence failure.
- The persisted audit record should be inspectable by `request_id` through the dedicated graph-audit read route.
- Progress updates should log:
  - request id
  - graph id
  - node id
  - user id
  - pass/fail result
- Never log:
  - raw API keys
  - full auth tokens
  - service-role credentials
  - unnecessary full prompt bodies if a shorter hash/correlation id is enough

### Performance And Cost Guardrails

- Cache-hit target latency: under 2 seconds.
- Full generation target latency: under 45 seconds.
- Maximum acceptable demo latency: 90 seconds.
- Model-call budget per generation:
  - canonicalize
  - graph generator
  - structure validator
  - curriculum validator
  - reconciler
  - lessons
  - diagnostics
  - visuals
- That is 8 primary LLM calls before retries.
- With one retry per failing stage, the system should still remain below a demo-safe cost envelope; do not introduce additional speculative LLM passes in V1.
- Detached curriculum audits should default to a single attempt and never repeat the same malformed JSON response just because the shared stage helper would otherwise retry.
- Detached curriculum audits should not use the same retry semantics as synchronous gate stages unless a dedicated repair prompt is introduced.
- Log cache hits vs misses and approximate generation path cost drivers at a coarse level.

### Resilience / Rate-Limit / Transient Failure Rules

- Retry only transient operational failures such as short upstream network failures or rate limits, and keep retries shallow.
- Do not silently retry semantic generation failures beyond the fixed one-retry contract already defined for invalid model output.
- If Anthropic, OpenAI, or Supabase transiently fails and the retry budget is exhausted, return a descriptive error and stop.
- Do not persist partial graphs after transient failure.

### Testing Contract

Minimum required test scope before calling V1 complete:

- unit tests for:
  - unlock computation
  - diagnostic movement and entry-point selection
  - retrieval threshold and tie-break behavior
- integration tests for:
  - `POST /api/generate` cache-hit path
  - `POST /api/generate` miss-to-store path with fixture-stubbed LLM responses
  - quiz pass/fail progress updates
  - `GET /api/graph/[id]` payload shape
- store-boundary regression tests should be fixture-driven and replayable:
- `app/dev-smoke-fixture.ts` owns the frozen generation-stage bundle plus the frozen exact `/api/generate/store` request fixture
- `app/dev-smoke-bridge.tsx` still derives the live store request through `buildStoreRouteRequest(...)`, validates it with `storeRouteRequestSchema`, and posts it from the dev-only window helper
- `tests/unit/dev-smoke-fixture.test.ts` protects raw-bundle invariants and fixture/transform parity
- `tests/integration/store-route.test.ts` confirms the frozen exact smoke request is accepted end to end by the route
- critical graph-read/store/retrieve tests must exercise the live DB surface probe path, not only mocked row parsing
- at least one end-to-end happy-path flow covering:
  - anonymous sign-in
  - prompt submit
  - graph retrieval or generation
  - diagnostic completion
  - opening a node
  - passing a quiz
  - unlocking downstream content

Use fixture-stubbed LLM responses in automated tests.
Do not require real Anthropic or OpenAI calls in CI.
Real Supabase may be used in local/dev verification, but automated tests should prefer controlled fixtures or isolated test instances.
Store-only manual smoke should reuse the frozen smoke bundle/request instead of regenerating lessons, diagnostics, or visuals on each run.

### Safety And Content Boundary Rules

- Reject non-learning requests using the canonicalize-stage `NOT_A_LEARNING_REQUEST` contract.
- Stay within the supported subject set already defined by the canonicalization contract.
- Do not render arbitrary unverified p5 code:
  - execute interactive code only when `visual_verified` is true
  - otherwise render `static_diagram`
- Treat stored lesson/diagram/quiz content as application content, not arbitrary user-authored HTML; do not allow raw unsafe HTML injection in learner-facing rendering.
- V1 does not add extra moderation taxonomies beyond supported-subject filtering and non-learning-request rejection, but unsafe or obviously abusive prompts should stop before generation rather than flowing through.

### Acceptance Criteria

#### MVP-complete

- learner can submit a prompt
- system canonicalizes, retrieves or generates, and stores a real graph
- learner signs in anonymously
- learner completes diagnostic
- graph renders with locked/available/completed states
- learner opens a node, reads the lesson, sees a visual fallback or interactive visual, and takes the quiz
- quiz pass writes real progress and unlocks downstream nodes

#### Demo-complete

- the happy path above works reliably in deployed or deployment-equivalent conditions
- cache-hit behavior is real
- cache-miss generation path is real
- Supabase persistence is real
- graph retrieval is real
- no critical step is mocked while presented as real

#### Allowed stubs

- fixture-based test doubles in automated tests
- simplified generation progress UI
- coarse cost logging rather than exact per-request billing

#### Prohibited fakery

- fake graph retrieval standing in for pgvector search
- fake persistence standing in for Supabase
- fake diagnostic scoring standing in for the actual client algorithm
- fake quiz progress updates standing in for real writes

### Pack 9 Invariants

- required environment variables must fail clearly when absent
- every major pipeline step logs with a request correlation id
- demo behavior must reflect real persistence and retrieval
- generated visual code must only execute through the verified fallback contract
- acceptance criteria must remain tied to real end-to-end behavior

### Pack 9 Closure

- `PACK9-19` through `PACK9-26` are resolved by the rules above

---

## Pack 7-9 Closure

The following pack-level contradiction groups are resolved by this file:

- `PACK9-01` through `PACK9-26`

This file is now the authoritative pack-level contract for learner state, frontend behavior, and ops/shipping behavior in the split context.

### Purpose

Define the concrete shipping contract for:

- deployment
- environment variables
- observability
- performance and cost
- resilience
- testing
- safety boundaries
- acceptance criteria

### Deployment Contract

#### Primary Target

- Vercel for the Next.js app
- Supabase for Postgres, pgvector, and anonymous auth

#### Acceptable Fallback

- local Next.js development server plus the same Supabase project or a local/dev Supabase environment

#### Runtime Assumptions

- server routes run in a trusted server environment with access to `SUPABASE_SERVICE_ROLE_KEY`
- client routes use only `NEXT_PUBLIC_*` Supabase variables
- LLM and embedding calls happen on server-side routes only

### Environment Variable Contract

Required variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Rules:

- `ANTHROPIC_API_KEY` is for all Claude calls and is server-only
- `OPENAI_API_KEY` is for embeddings only and is server-only
- `NEXT_PUBLIC_SUPABASE_URL` is for client Supabase initialization and is public
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is for client anonymous auth/session and is public
- `SUPABASE_SERVICE_ROLE_KEY` is for trusted server-side Supabase access and is server-only
- missing required env vars must fail clearly at the route or client bootstrap that needs them
- do not silently substitute fake behavior
- DB contract failures are distinct from env failures; missing required DB columns or RPCs must raise `DB_SCHEMA_OUT_OF_SYNC`

### Observability And Logging Contract

The project already requires `console.log` progress at every pipeline step. V1 keeps plain console logging, but makes it structured and consistent.

Required log fields:

- `request_id`
- route name
- stage name
- event type (`start`, `success`, `error`)
- duration in ms when a stage completes
- `graph_id` when known
- `graph_version` when known
- learner id only as a truncated anonymous identifier when operationally useful

Required milestones:

- incoming generate request
- canonicalize start/success/failure
- retrieve start/success/failure
- graph generation start/success/failure
- detached curriculum audit start/success/failure
- lessons start/success/failure
- diagnostics start/success/failure
- visuals start/success/failure
- store start/success/failure
- graph fetch start/success/failure
- progress write start/success/failure

What must never be logged:

- API keys
- full auth tokens
- raw secret env values
- full learner prompt if it contains sensitive or abusive content that does not need verbatim logging
- full lesson bodies or full generated code blobs unless debugging locally and intentionally

### Performance And Cost Guardrails

Target latency:

- cache-hit target: under 2 seconds end-to-end
- full-generation target: under 45 seconds on the happy path
- maximum acceptable demo latency: 90 seconds before the experience is considered degraded
- detached curriculum audits should remain best-effort and must not block graph acceptance

Batching policy:

- graph generation remains one four-agent pipeline
- lessons should be generated through bounded node-sized subcalls with a small fixed concurrency, not a single oversized whole-graph response and not an unbounded fan-out
- diagnostics should use the same bounded node-sized execution model with a small fixed concurrency
- visuals should use the same bounded node-sized execution model with a small fixed concurrency

LLM call budget:

- 1 canonicalize call
- 4 graph-pipeline calls
- 1 lessons call
- 1 diagnostics call
- 1 visuals call

That is 8 primary model calls before retries.

Retry budget:

- one retry per failed malformed-output stage
- do not allow unbounded retry loops

Cost-awareness:

- log stage count and total model-call count for each generation request
- generation should be aborted if retries would push the request into obviously abnormal call volume for V1
- do not fake “cheap generation” in the demo if the live system is not actually making the real calls

### Resilience / Rate-Limit / Transient Failure Rules

Retryable failures:

- upstream rate limits
- short-lived network failures
- transient Supabase connectivity failures
- one-off malformed model JSON that is eligible for a single retry

Non-retryable failures:

- missing required environment variables
- schema-valid but semantically invalid payloads after the allowed retry budget
- unsupported prompt category or rejected content
- persistent storage failure after retry budget is exhausted

Retry policy:

- use bounded retries only
- one retry for malformed model output
- one retry for transient network/service failures where safe
- after the retry budget is exhausted, fail clearly and do not silently continue with partial truth

### Testing Contract

Required automated coverage:

- targeted unit tests for pure unlock/progress/diagnostic helpers
- integration tests for route-level happy paths and failure paths
- at least one end-to-end happy path covering prompt -> graph -> diagnostic -> quiz pass -> unlock

High-priority flows to cover:

- canonicalize validation failure
- retrieve hit vs retrieve miss
- graph generation happy path
- malformed model output retry behavior
- progress write on quiz pass
- progress write on quiz fail
- unlock recomputation from hard edges
- flagged-for-review routing behavior for new learners vs pinned learners

External service policy in tests:

- automated tests should stub LLM calls with fixtures
- automated tests do not need live Anthropic or OpenAI access
- automated tests do not require live Supabase if repo-local or test doubles cover the route contract
- one manual pre-demo smoke test against real Supabase and real provider keys is required

### Safety And Content Boundary Rules

Rejected prompts:

- prompts that are not learning requests
- clearly abusive prompts that try to weaponize the system outside educational intent
- prompts that ask for unsupported content outside the project’s academic scope when they cannot be mapped safely

Supported subject boundary:

- the supported subject set is the canonicalized academic set from the lower-level prompt contract, including `general` only as the fallback canonical subject

Sanitization rules:

- `static_diagram` must be treated as SVG content and rendered safely
- `p5_code` must obey the prompt-contract restrictions: no imports, no network fetches, no external asset loading, no script tags
- do not execute arbitrary stored code outside the constrained p5 rendering path

Moderation rule:

- if a prompt cannot be turned into a legitimate learning graph, reject it rather than forcing generation
- do not broaden V1 into general unsafe open-ended generation

### Acceptance Criteria

#### MVP-Complete

The project is MVP-complete only if all of the following are real:

- learner can submit a prompt
- system canonicalizes and retrieves or generates a graph
- graph is stored in Supabase
- learner can sign in anonymously
- learner can run the adaptive diagnostic
- learner can open an available node
- learner can read a lesson
- learner can see either a trusted p5 visual or `static_diagram`
- learner can take the mastery quiz
- pass/fail updates persist
- hard-edge unlock logic works

#### Demo-Complete

The project is demo-complete only if all of the following are real:

- happy-path cache hit works
- happy-path cache miss works
- diagnostic highlights a believable entry point
- completed node turns green
- downstream node availability updates after a pass
- generation and retrieval use real model/API/Supabase behavior, not fake demo-only branching
- descriptive failures exist for the main broken-path cases

#### Allowed Stubs

Acceptable V1 simplifications:

- minimal admin tooling
- minimal analytics dashboards
- lightweight duplicate-submission protection without a dedicated idempotency subsystem
- simple text loading states instead of elaborate live job progress

#### Prohibited Fakery

Not acceptable in the demo:

- mocked generation pretending to be live generation
- fake retrieval pretending to be semantic search
- fake progress writes pretending to persist
- fake unlock updates that do not come from the real prerequisite model

### Pack 9 Invariants

- do not silently degrade when required env vars are missing
- do not present mocked behavior as real demo behavior
- do not execute unrestricted stored code
- do not overengineer logging or testing beyond the V1 contract
- keep operational behavior debuggable through structured console logs

### Pack 9 Closure

- `PACK9-19` through `PACK9-26` are resolved by the rules above

---

## Cross-File Alignment Notes

This file inherits and reinforces the already-resolved lower-level model:

- `context/02-data-and-api.md` owns graph versioning, progress identity, retrieval ordering, and `flagged_for_review` routing baseline
- `context/03-generation-flow.md` owns pipeline order, `lessons` ownership of `static_diagram`, `diagnostics` ownership of `diagnostic_questions`, and client-side diagnostic scoring
- `context/06-prompt-visuals-and-diagnostics.md` owns the stage-local prompt/output contracts for diagnostics and visuals

This file should not reopen those decisions.

## Residual Open Items

Within the scope of Packs 7, 8, and 9, no major decision remains intentionally open in this file.

If a later file still presents one of these areas as a prompt to choose from multiple options, this file should be treated as the inherited fixed answer unless the contradiction ledger is updated explicitly.



