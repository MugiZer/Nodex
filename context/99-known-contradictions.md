# Known Contradictions

This file is the contradiction ledger for the split context.

Its purpose is to show how the earlier unresolved items were grouped, resolved, and closed by owning `context` file.

## How To Use This File

- Use the checklist below as a historical record of what was resolved.
- If a contradiction reappears, reopen the specific item or add a new one under the owning file.
- Update the owning file first, then update this ledger.

## Resolution Order

1. `context/02-data-and-api.md`
2. `context/03-generation-flow.md`
3. `context/04-prompt-canonicalize-and-graph.md`
4. `context/05-prompt-validators-and-reconciler.md`
5. `context/06-prompt-visuals-and-diagnostics.md`
6. `context/07-pack-domain-db-retrieval.md`
7. `context/08-pack-orchestration-prompts-content.md`
8. `context/09-pack-progress-frontend-ops.md`
9. `context/README.md`

## Status Legend

- `[ ]` unresolved / reopened
- `[~]` partially resolved / needs follow-up
- `[x]` resolved

---

## `context/02-data-and-api.md`

- [x] `DATA-01` Graph versioning is both fixed and reopened
- [x] `DATA-02` Progress identity is both implied and reopened
- [x] `DATA-03` Retrieval is both simple and underspecified
- [x] `DATA-04` `flagged_for_review` exists without final routing policy
- [x] `DATA-05` Versioned graphs are implied per row but not fully normalized across files

---

## `context/03-generation-flow.md`

- [x] `FLOW-01` Diagnostic is client-only vs persisted
- [x] `FLOW-02` Diagnostic questions exist in schema but not in the official pipeline
- [x] `FLOW-03` Lessons route scope is ambiguous
- [x] `FLOW-04` `lessons` route scope is underspecified
- [x] `FLOW-05` `static_diagram` is required but has no clear owner
- [x] `FLOW-06` `static_diagram` has storage but not a clear generator

---

## `context/04-prompt-canonicalize-and-graph.md`

- [x] `PROMPT-01` Subject enum was split across sections
- [x] `PROMPT-02` `"general"` is allowed by validation but not cleanly in the base enum

---

## `context/05-prompt-validators-and-reconciler.md`

- [x] `VALID-01` Reconciler prompt was duplicated in source

---

## `context/06-prompt-visuals-and-diagnostics.md`

- [x] `VD-01` Diagnostic questions exist without a first-class pipeline stage
- [x] `VD-02` `static_diagram` ownership is implied by prompt assumptions, not by pipeline contract

---

## `context/07-pack-domain-db-retrieval.md`

These are pack-level contradictions and ownership gaps. They should be resolved only after the lower-level files above are made authoritative.

- [x] `PACK7-01` Prompt packs are not final contracts yet
- [x] `PACK7-02` Domain/DB/Retrieval pack sections reopen already-stated models
- [x] `PACK7-03` Pack 1 still treats graph identity as a decision point
- [x] `PACK7-04` Pack 1 still treats node identity as a decision point
- [x] `PACK7-05` Pack 1 still treats quiz/diagnostic storage as a decision point
- [x] `PACK7-06` Pack 1 still treats frontend payload model as a decision point
- [x] `PACK7-07` Pack 1 still treats progress source of truth as a decision point
- [x] `PACK7-08` Pack 2 still treats table strategy as a decision point
- [x] `PACK7-09` Pack 2 still treats graph version storage as a decision point
- [x] `PACK7-10` Pack 2 still treats node/edge SQL identity as a decision point
- [x] `PACK7-11` Pack 2 still treats progress uniqueness as a decision point
- [x] `PACK7-12` Pack 2 still treats public read model as a decision point
- [x] `PACK7-13` Pack 2 still treats RLS model as a decision point
- [x] `PACK7-14` Pack 2 still treats deletion/mutation behavior as a decision point
- [x] `PACK7-15` Pack 3 still treats embedded text contract as a decision point
- [x] `PACK7-16` Pack 3 still treats subject normalization as a decision point
- [x] `PACK7-17` Pack 3 still treats topic usage as a decision point
- [x] `PACK7-18` Pack 3 still treats threshold behavior as a decision point
- [x] `PACK7-19` Pack 3 still treats multiple-match behavior as a decision point
- [x] `PACK7-20` Pack 3 still treats `flagged_for_review` behavior as a decision point
- [x] `PACK7-21` Pack 3 still treats regeneration policy as a decision point
- [x] `PACK7-22` Pack 3 still treats duplicate policy as a decision point

---

## `context/08-pack-orchestration-prompts-content.md`

- [x] `PACK8-01` Top-level pipeline and later prompt packs disagree on authority level
- [x] `PACK8-02` Pack 4 still treats orchestration mechanism as a decision point
- [x] `PACK8-03` Pack 4 still treats sequential vs parallel execution as a decision point
- [x] `PACK8-04` Pack 4 still treats retry policy as a decision point
- [x] `PACK8-05` Pack 4 still treats repair policy as a decision point
- [x] `PACK8-06` Pack 4 still treats timeout policy as a decision point
- [x] `PACK8-07` Pack 4 still treats partial failure and fallback as a decision point
- [x] `PACK8-08` Pack 4 still treats persistence boundary as a decision point
- [x] `PACK8-09` Pack 4 still treats duplicate-generation safeguards as a decision point
- [x] `PACK8-10` Pack 4 still treats error taxonomy as a decision point
- [x] `PACK8-11` Pack 5 still treats prompt-set completeness as a decision point
- [x] `PACK8-12` Pack 5 still treats model settings as a decision point
- [x] `PACK8-13` Pack 5 still treats isolation rules as a decision point
- [x] `PACK8-14` Pack 5 still treats lesson generation scope as a decision point
- [x] `PACK8-15` Pack 5 still treats diagnostic generation scope as a decision point
- [x] `PACK8-16` Pack 5 still treats visual generation contract as a decision point
- [x] `PACK8-17` Pack 5 still treats repair philosophy as a decision point
- [x] `PACK8-18` Pack 6 still treats graph completeness definition as a decision point
- [x] `PACK8-19` Pack 6 still treats lesson contract as a decision point
- [x] `PACK8-20` Pack 6 still treats quiz contract as a decision point
- [x] `PACK8-21` Pack 6 still treats diagnostic contract as a decision point
- [x] `PACK8-22` Pack 6 still treats visual contract as a decision point
- [x] `PACK8-23` Pack 6 still treats edge semantic contract as a decision point
- [x] `PACK8-24` Pack 6 still treats hard-fail vs graceful-degrade as a decision point

---

## `context/09-pack-progress-frontend-ops.md`

- [x] `PACK9-01` Pack 7 still treats progress source of truth as a decision point
- [x] `PACK9-02` Pack 7 still treats diagnostic persistence as a decision point
- [x] `PACK9-03` Pack 7 still treats diagnostic algorithm as a decision point
- [x] `PACK9-04` Pack 7 still treats completion semantics as a decision point
- [x] `PACK9-05` Pack 7 still treats unlock semantics as a decision point
- [x] `PACK9-06` Pack 7 still treats resume/restart behavior as a decision point
- [x] `PACK9-07` Pack 7 still treats progress update behavior as a decision point
- [x] `PACK9-08` Pack 7 still treats `flagged_for_review` interaction as a decision point
- [x] `PACK9-09` Pack 8 still treats route set as a decision point
- [x] `PACK9-10` Pack 8 still treats server/client boundaries as a decision point
- [x] `PACK9-11` Pack 8 still treats data-fetching model as a decision point
- [x] `PACK9-12` Pack 8 still treats graph layout policy as a decision point
- [x] `PACK9-13` Pack 8 still treats React Flow contract as a decision point
- [x] `PACK9-14` Pack 8 still treats visual state model as a decision point
- [x] `PACK9-15` Pack 8 still treats diagnostic UX as a decision point
- [x] `PACK9-16` Pack 8 still treats generation/loading UX as a decision point
- [x] `PACK9-17` Pack 8 still treats NodePanel behavior as a decision point
- [x] `PACK9-18` Pack 8 still treats responsiveness/mobile behavior as a decision point
- [x] `PACK9-19` Pack 9 still treats deployment target as a decision point
- [x] `PACK9-20` Pack 9 still treats environment contract as a decision point
- [x] `PACK9-21` Pack 9 still treats observability contract as a decision point
- [x] `PACK9-22` Pack 9 still treats performance and latency targets as a decision point
- [x] `PACK9-23` Pack 9 still treats cost guardrails as a decision point
- [x] `PACK9-24` Pack 9 still treats testing scope as a decision point
- [x] `PACK9-25` Pack 9 still treats safety/abuse boundaries as a decision point
- [x] `PACK9-26` Pack 9 still treats acceptance criteria as a decision point

---

## `context/README.md`

- [x] `ROOT-01` Prompt packs are not final contracts yet
- [x] `ROOT-02` Top-level fixed rules vs later prompt packs still collide
- [x] `ROOT-03` The source file mixes three authority layers in one place

---

## Resolution Notes

- `DATA-01` to `DATA-05`: `context/02-data-and-api.md` now defines the authoritative lower-level baseline for graph versioning, progress identity, retrieval behavior, and `flagged_for_review` routing
- `FLOW-01` to `FLOW-06`: `context/03-generation-flow.md` now defines a dedicated `diagnostics` stage, keeps diagnostic scoring client-side but question generation server-side, and assigns `lessons` ownership of `static_diagram`, `quiz_json`, and `lesson_text`
- `PROMPT-01` and `PROMPT-02`: `context/04-prompt-canonicalize-and-graph.md` now treats `general` as an authoritative subject value in the canonical enum
- `VALID-01`: `context/05-prompt-validators-and-reconciler.md` is now the canonical reconciler reference for the split context despite source duplication
- `VD-01` and `VD-02`: `context/06-prompt-visuals-and-diagnostics.md` now inherits the resolved pipeline ownership model and no longer treats diagnostic-stage or `static_diagram` ownership as open
- `PACK7-01` to `PACK7-22`: `context/07-pack-domain-db-retrieval.md` now converts Packs 1-3 from decision prompts into resolved pack-level contracts, including graph identity, progress identity, table strategy, retrieval policy, `flagged_for_review`, and duplicate handling
- `PACK8-01` to `PACK8-24`: `context/08-pack-orchestration-prompts-content.md` now fixes orchestration, prompt/schema, and graph-content rules, and preserves the original prompt text only as historical depth beneath resolved sections
- `PACK9-01` to `PACK9-26`: `context/09-pack-progress-frontend-ops.md` now fixes learner-state, frontend, and ops/deployment behavior, including diagnostic persistence, quiz pass threshold, route/component rules, environment handling, testing scope, and demo acceptance criteria
- `ROOT-01` to `ROOT-03`: `context/README.md` now treats the split context as canonical working documentation, with this file serving as a historical closure ledger and future regression tracker

---

## Working Resolution Rule

All tracked contradiction items are currently resolved.

Current rule of use:

1. prefer the most specific owning `context` file for implementation
2. use this ledger to understand how earlier contradictions were closed
3. reopen an item here only if a new edit reintroduces ambiguity or conflicting authority

## Regression Notes

- `DB-TS-01` Timestamp parsing for DB-returned rows must remain centralized on the shared exported DB timestamp schema
- `DB-TS-01A` The shared DB timestamp schema must continue covering verified live Supabase/PostgREST transport shapes, including naive row strings like `2026-04-03T18:49:09`, before those values enter domain contracts
- `DB-TS-02` Store duplicate recheck, retrieval candidate loading, and graph readback must keep parse-phase attribution in thrown errors and logs
- `DB-TS-03` Do not reintroduce file-local `datetime()` clones for Supabase rows; that is the contract mismatch pattern that caused the store regression
- `DB-SYNC-01` Migrations, handwritten DB types, runtime `select(...)` surfaces, and context docs are not sufficient by themselves; required DB surfaces must be probed or otherwise executable against the live Supabase API surface
- `DB-SYNC-02` Missing required DB columns/functions must raise `DB_SCHEMA_OUT_OF_SYNC` with the exact failing surface name
- `DB-SYNC-03` `supabase/database.types.ts` is the runtime DB type source of truth; `lib/supabase.ts` should only alias it, not redefine the DB contract
- `DB-SYNC-04` `lib/server/db-contract.ts` owns the executable surface probes for graph read, retrieval fallback, and exact duplicate recheck
- `DB-SYNC-05` Required DB surfaces currently include `graph_read.graph`, `graph_read.nodes`, `graph_read.edges`, `graph_read.progress`, `store.duplicate_recheck.graphs`, and `retrieve.fallback.graphs`
- `DB-SYNC-06` `lesson_status` remains part of the node API contract, but live graph readback may derive it deterministically instead of requiring a persisted DB column
- `VIS-DET-01` `visual_verified` must remain a deterministic policy result, not a synonym for "template matched"
