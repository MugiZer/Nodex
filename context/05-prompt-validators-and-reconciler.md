# Prompt Contracts: Validators And Reconciler

This file is the canonical working reference for the graph validation and repair prompts in the split context.
It preserves the structure-validator, curriculum-validator, and reconciler instructions in a form that future agents can use without reopening the giant source file.

Canonicality rule:

- If `AGENTS.md` repeats the reconciler block, treat the repeated copy as historical and non-authoritative.
- This file is the single merged source of truth for validator/reconciler behavior in the split context.
- When a future edit must choose between the duplicated source block and this file, prefer this file.

## Shared Frame

All three roles operate on the same generated knowledge-graph data:

- `Subject`
- `Topic`
- `Description`
- optional boundary metadata: `prerequisites[]`, `downstream_topics[]`
- `nodes[]`
- `edges[]`

The curriculum validator is an isolated Claude call with no shared hidden context.
The structure validator contract is satisfied by deterministic server code by default, because graph mechanics and topology acceptance are server-owned truth.
If a bounded model-assisted structure audit is used later, it must remain optional and subordinate to deterministic server validation.
The reconciler receives the original graph plus both validator outputs and produces the final repaired graph.
The server validates graph proposals and reconciled graphs in layered deterministic gates:

- shape validation
- semantic graph validation
- state validation

No graph artifact may proceed to the next stage unless all three gates pass.
Node positions are a deterministic server-owned field derived from the final hard-edge DAG; model-provided positions may be recomputed locally before final graph acceptance.

MVP/demo-mode interpretation:

- The live `POST /api/generate` path should treat repairable structural defects as inputs to repair, not as automatic learner-facing failures.
- The strict graph route may still fail fast so engineering can inspect exact defects.
- If a live graph cannot be made perfect but can be made structurally solid and demo-safe, the system should prefer the solid simplified graph.
- In live mode, only shape failures remain hard blockers at the graph-generation boundary. Parsed structural defects should flow into deterministic repair, reconcile, or a final fallback DAG.

## Structure Validator

### Role

Adversarial auditor for graph mechanics.
In V1 this role is fulfilled by deterministic server code by default, not by trusting an LLM on the critical path.
Its only job is to find structural problems that would break mastery-gated progression, create cycles, strand nodes, or expose nodes before their hard prerequisites are sufficient.
If a future model-assisted audit is added, it should assume the generator made mistakes and it must never override deterministic validation.

### What It Checks

#### 1. Circular Dependencies

- Trace every path through the graph via hard edges.
- If any path returns to a node it already visited, report a cycle.
- Report every node involved in the cycle.
- Do this even if the server already ran a topological sort, because subtle transitive cycles can slip through naive checks.

#### 2. Hard Prerequisite Sufficiency

- For every node, ask whether a student who has mastered only that node's hard prerequisites and the assumed prior knowledge from the description can learn the concept.
- If the answer is no, report exactly what knowledge is missing and which node should provide it.
- Common failure patterns to catch:
  - a formula used in one node that should have been introduced in a prerequisite node
  - a concept that exists in the graph but is only connected through soft edges
  - a node that depends on two prerequisite branches but only receives one hard edge

#### 3. Edge Misclassification

- For every hard edge, ask whether the dependent node is truly impossible to understand without the prerequisite.
- If the prerequisite is helpful but not strictly required, the edge should be soft.
- For every soft edge, ask whether the prerequisite is actually blocking understanding.
- If the prerequisite is blocking, the edge must be hard.
- Common misclassification patterns:
  - history or context edges marked hard when they should be soft
  - definition-to-application edges marked soft when they should be hard
  - parallel concepts incorrectly connected by hard edges when they are independently teachable

#### 4. Redundant Edges

- If `A -> B` and `B -> C` both exist as hard edges, then a hard `A -> C` edge is redundant because the transitive dependency is already enforced.
- Report redundant hard edges.
- Soft `A -> C` edges are allowed only when they give direct context that is not already present through `B`.
- If the soft edge adds no value, report it.

#### 5. Position Consistency

- For every hard edge `from_node -> to_node`, `from_node.position` must be strictly less than `to_node.position`.
- If two nodes share a position but have a dependency relationship in either direction, one of their positions is wrong.

#### 6. Orphaned Subgraphs

- Every node must be reachable from at least one position-0 node by following hard edges forward.
- If a cluster of nodes is disconnected from root nodes via hard edges, report it as an orphaned subgraph.

### What It Does Not Check

- It does not judge whether the graph matches curricula.
- It does not judge whether titles are good.
- It does not judge whether the topic scope is right.
- It only cares about internal graph structure.
- It does not produce corrected nodes or edges.
- It does not suggest adding nodes.
- It does not suggest removing nodes.
- It does not rewrite the graph.

### Output Contract

The accepted structure validator output is always raw JSON only, regardless of whether it was produced entirely by deterministic code or merged with an optional bounded model-assisted audit.

If issues are found:

```json
{
  "valid": false,
  "issues": [
    {
      "type": "circular_dependency | missing_hard_edge | edge_misclassification | redundant_edge | position_inconsistency | orphaned_subgraph",
      "severity": "critical | major | minor",
      "nodes_involved": ["node_X", "node_Y"],
      "description": "Clear one-sentence explanation of the problem.",
      "suggested_fix": "Clear one-sentence fix instruction."
    }
  ]
}
```

If the graph is structurally sound:

```json
{
  "valid": true,
  "issues": []
}
```

### Severity Meaning

- `critical`: the graph is broken and will cause students to get stuck
- `major`: the graph will work, but students may be unprepared or unnecessarily blocked
- `minor`: the graph works, but has inefficiencies such as redundant edges or position quirks

### Rules

- Be adversarial.
- Assume the generator made mistakes.
- Be specific about the exact nodes and edges involved in each issue.
- Vague statements such as "some edges might be wrong" are not acceptable.
- Keep descriptions to one sentence.
- Keep suggested fixes to one sentence.
- Set `valid` to `true` only when `issues` is empty; set `valid` to `false` whenever `issues` is non-empty.
- Do not suggest adding nodes.
- Do not suggest removing nodes.
- Do not rewrite the graph.
- If the graph is genuinely sound, say so instead of inventing issues.

### Inputs

The structure validation stage receives:

- `Subject`
- `Topic`
- `Description`
- `nodes[]`
- `edges[]`

### Server-Side Validation of Validator Output

The server accepts the structure validator output only if:

1. JSON parses
2. `valid` is a boolean
3. `issues` is an array
4. the server derives the accepted `valid` value from `issues.length`:
   - `issues.length = 0` -> accepted result uses `valid: true`
   - `issues.length > 0` -> accepted result uses `valid: false`
5. a mismatched model-emitted `valid` flag may be normalized locally instead of forcing a retry
6. every issue includes:
   - `type`
   - `severity`
   - `nodes_involved`
   - `description`
   - `suggested_fix`
7. `type` must be one of:
   - `circular_dependency`
   - `missing_hard_edge`
   - `edge_misclassification`
   - `redundant_edge`
   - `position_inconsistency`
   - `orphaned_subgraph`
8. `severity` must be one of:
   - `critical`
   - `major`
   - `minor`
9. `nodes_involved` must be a non-empty array of strings
10. every node id in `nodes_involved` must reference a valid input node
11. `description` must be non-empty
12. `suggested_fix` must be non-empty
13. deterministic graph checks may emit accepted issues directly without calling a model
14. if an optional model-assisted audit is used, its output must still satisfy this schema and may be merged with deterministic findings
15. if any optional model-assisted check fails schema validation, retry once with the same input
16. if the second optional model-assisted attempt fails, raise a descriptive error listing the violated invariants

## Curriculum Validator

### Role

Adversarial auditor for curriculum alignment.
It proposes curriculum findings when the model can do so within budget, but it is not the source of truth for graph acceptance.
It checks whether the graph teaches the right things in the right order for the canonical topic and level.
It should be conservative and only flag issues with strong curriculum justification.
In the current route implementation this audit may be launched as a detached best-effort task after the synchronous graph path is already accepted, so curriculum never blocks graph delivery.
When detached, the validator receives a compact payload containing only `subject`, `topic`, `description`, the ordered `{id,title,position}` node list, and the hard-edge list.
Detached curriculum uses a single attempt by default and does not inherit the generic multi-attempt retry policy for malformed JSON.
If this bounded audit times out or fails contract validation, the server records `skipped_timeout` or `skipped_contract_failure`, continues with a synchronous placeholder state for the graph route, and persists the detached audit separately.

### Curriculum Frame

This validator operates on topic-scoped mastery graphs, not full courses.
The intended graph size is 4 to 25 nodes, roughly comparable to a tight textbook chapter or unit.

### Research Protocol

- If web search or retrieval tools are available, use them selectively when needed.
- Prefer consensus-bearing sources:
  - open textbooks
  - university or college course outlines
  - national or regional curriculum frameworks
  - reputable educational platforms
  - subject-matter reference materials
- Use multiple sources for unfamiliar, disputed, or level-sensitive topics.
- Do not anchor to a single quirky syllabus or one instructor's personal ordering.
- If tools are unavailable, rely on stable mainstream curriculum knowledge and be conservative.
- Do not hallucinate authority.

### What It Checks

#### 1. Missing Core Concepts

- Ask whether any core concepts are missing that are normally required for a student to say they have covered the topic at this level.
- Flag a missing concept only if it is:
  - clearly within the topic boundary
  - normally expected in standard curricula for this topic and level
  - important enough that its absence materially weakens the graph
- Do not flag:
  - assumed prior knowledge from Sentence 3
  - downstream topics from Sentence 3
  - optional enrichments
  - niche subcases
  - advanced extensions unless the stated level requires them

#### 2. Incorrect Pedagogical Ordering

- Ask whether the learning sequence diverges from how the topic is normally taught in a way that would confuse or weaken understanding.
- Examples of ordering problems:
  - applications before foundations
  - advanced manipulations before definitions
  - special-case theorems before the general framework
  - capstone concepts before the concepts they synthesize
- This is about pedagogy, not graph-cycle logic.

#### 3. Out-of-Scope Concepts

- Ask whether the graph includes concepts that do not belong inside the canonical topic boundary.
- Flag concepts that are:
  - from a different topic
  - too remedial relative to assumed prior knowledge
  - too advanced relative to the stated level
  - downstream applications that belong after this topic, not inside it
- Do not flag a concept simply because another curriculum omits it.
- Flag it only if it genuinely does not belong.

#### 4. Pedagogical Misalignment

- Ask whether the graph's overall decomposition misrepresents how the topic is usually framed or learned.
- Examples:
  - the graph overemphasizes a side branch and underrepresents the core spine
  - it frames the topic around tricks instead of foundations
  - it treats a capstone as if it were a foundational entry point
  - it decomposes the topic in a way that distorts the mental model

#### 5. Level Mismatch

- Ask whether the graph matches the level implied by the description.
- Examples:
  - introductory graph includes graduate-level abstractions
  - intermediate graph stays at purely remedial vocabulary
  - advanced graph omits conceptual depth expected at that level
- Level mismatch can apply to the whole graph or to specific nodes.

### What It Does Not Check

- It does not focus on circular dependencies.
- It does not focus on duplicate edges.
- It does not focus on hard-vs-soft correctness unless that directly creates a curriculum problem.
- It does not focus on topological validity or isolated nodes.
- Those belong primarily to the structure validator.
- It does not nitpick title wording, acceptable sequencing variants, institutional style differences, or optional enrichments.
- It does not rewrite the graph.
- It does not produce corrected nodes or edges.
- It does not suggest exact edge types.
- It does not invent sources or claim certainty where curricula vary.

### Topic-Boundary Rules

- The canonical description is the main contract.
- Sentence 2 defines the in-scope core.
- Sentence 3 defines assumed prior knowledge and downstream topics.
- Sentence 4 defines the level.
- When orchestration supplies explicit `prerequisites[]` and `downstream_topics[]`, boundary validation must use those structured fields directly; it must not depend on reparsing the rendered description string.
- The validator prompt should not re-expand prerequisite summaries into prose unless a future test proves that it materially improves findings.
- Do not ask for assumed prior knowledge as if it were new graph content.
- Do not ask for downstream topics as if they were core content.
- Do not treat optional applications as missing concepts.
- Do not ask whether the graph should cover an entire semester or full course.
- Do not flag one of several broadly acceptable sequences just because another source orders it differently.

### Source Self-Check

Before answering, silently ask yourself:

1. Is this really in scope for the stated topic?
2. Is this actually expected at the stated level?
3. Is this a consensus issue or just a stylistic preference?
4. Would this materially affect learning?

### Output Contract

The curriculum validator must return raw JSON only.

If issues are found:

```json
{
  "valid": false,
  "issues": [
    {
      "type": "missing_concept | incorrect_ordering | out_of_scope_concept | pedagogical_misalignment | level_mismatch",
      "severity": "critical | major | minor",
      "nodes_involved": ["node_X", "node_Y"],
      "missing_concept_title": "string or null",
      "description": "Clear one-sentence explanation of the curriculum problem.",
      "suggested_fix": "Clear one-sentence correction instruction.",
      "curriculum_basis": "One-sentence statement of the consensus curriculum reasoning behind this issue."
    }
  ]
}
```

If the graph is curriculum-sound:

```json
{
  "valid": true,
  "issues": []
}
```

If the bounded curriculum audit fails or times out, the server does not invent replacement issues.
It records that no curriculum findings were accepted for that request and continues with the accepted empty result:

```json
{
  "valid": true,
  "issues": []
}
```

### Field Rules

- `nodes_involved`
  - use existing node ids when the issue concerns present nodes
  - use `[]` only when the issue is a truly missing concept not represented by any node
- `missing_concept_title`
  - required and non-null only when `type = "missing_concept"`
  - otherwise must be `null`
- The graph route response may mark curriculum as a synchronous placeholder while the detached audit continues in the background.
- `description`
  - one sentence
  - specific
  - concrete
  - no vague complaints
- `suggested_fix`
  - one sentence
  - must tell the reconciler what to change
  - may suggest adding, removing, repositioning, or reframing concepts
- `curriculum_basis`
  - one sentence
  - state the mainstream curricular logic
  - do not quote sources
  - do not include URLs

### Severity Meaning

- `critical`: materially broken or misleading coverage
- `major`: usable but pedagogically weakened
- `minor`: broadly sound but has non-fatal imperfections

### Rules

- Be adversarial but not performative.
- Find real issues, not cosmetic ones.
- Be conservative.
- Judge against broad consensus, not personal preference.
- Respect topic scope and level exactly.
- Set `valid` to `true` only when `issues` is empty; set `valid` to `false` whenever `issues` is non-empty.
- Do not rewrite the graph.
- Do not produce corrected nodes or edges.
- Do not suggest exact edge types.
- Do not invent sources or claim certainty where curricula vary.
- If multiple sequences are broadly acceptable, do not flag them.
- If the graph is genuinely curriculum-aligned, return `valid: true` and an empty issues array.

### User Prompt Inputs

The validator receives:

- `Subject`
- `Topic`
- `Description`
- `nodes[]`
- `edges[]`

### Server-Side Validation of Validator Output

The server accepts the curriculum validator output only if:

1. JSON parses
2. `valid` is a boolean
3. `issues` is an array
4. the server derives the accepted `valid` value from `issues.length`:
   - `issues.length = 0` -> accepted result uses `valid: true`
   - `issues.length > 0` -> accepted result uses `valid: false`
5. a mismatched model-emitted `valid` flag may be normalized locally instead of forcing a retry
6. every issue includes:
   - `type`
   - `severity`
   - `nodes_involved`
   - `missing_concept_title`
   - `description`
   - `suggested_fix`
   - `curriculum_basis`
7. `type` must be one of:
   - `missing_concept`
   - `incorrect_ordering`
   - `out_of_scope_concept`
   - `pedagogical_misalignment`
   - `level_mismatch`
8. `severity` must be one of:
   - `critical`
   - `major`
   - `minor`
9. if `type = "missing_concept"`:
   - `missing_concept_title` must be a non-empty string
   - `nodes_involved` may be empty
10. if `type != "missing_concept"`:
    - `missing_concept_title` must be `null`
    - `nodes_involved` must be non-empty
    - every node id in `nodes_involved` must reference a valid input node
11. `description` must be non-empty
12. `suggested_fix` must be non-empty
13. `curriculum_basis` must be non-empty
14. if any check fails, retry once with the same input
15. if the second attempt fails, raise a descriptive error listing the violated invariants

## Reconciler

### Role

Independent repair pass that receives the original graph plus the two validator outputs and produces the final corrected graph.
This is a repair pass, not a regeneration pass.

### Primary Objective

Resolve the validators' findings with the smallest possible graph drift while producing a graph that is both:

- structurally sound for mastery-gated progression
- curriculum-aligned for the stated topic, scope, and level

### Reconciliation Policy

#### 1. Treat Validators as Strong Signals, Not Absolute Commands

- The validator reports are high-value inputs.
- They may overlap.
- They may partially conflict.
- They may overstate a problem.
- They may describe the same issue in different language.
- Reconcile them intelligently.
- If two issues are duplicates, fix the underlying problem once.
- If two issues conflict, choose the correction that best satisfies:
  1. topic boundary
  2. curriculum correctness
  3. structural soundness
  4. minimal change
- The server may apply deterministic local repair for exact, repeatable mechanical defects before any LLM reconcile call; when that repair fully resolves the issue set, the result is `deterministic_only_repaired` rather than a model-driven reconcile.

#### 2. Minimal-Change Principle

Prefer fixes in this order:

1. changing an edge type
2. adding or removing an edge
3. moving a node's position
4. renaming a node slightly for precision
5. adding a missing node
6. removing an out-of-scope node
7. splitting or substantially reframing a node only if absolutely necessary

- Do not add or remove nodes unless the issues genuinely require it.
- Do not do a creative rewrite of the topic.

#### 3. Preserve Stable IDs

- Keep all existing node ids for nodes that remain in the graph.
- If you add a new node, assign the next available id using the same pattern: `node_N`.
- Do not renumber existing nodes just to make the sequence prettier.
- If you remove a node, do not reuse its id in the output.

#### 4. Recompute Positions Globally

- After all fixes, recompute node positions so they reflect the final prerequisite ordering and pedagogical flow.
- Positions must be non-negative integers.
- At least one node must be position 0.
- Every hard edge must go from lower position to higher position.
- Nodes sharing a position must be genuinely independent at that stage.
- Positions should reflect both dependency order and standard pedagogy.
- Compress positions if appropriate.
- Do not preserve arbitrary original numeric gaps.

#### 5. Topic Boundary Supremacy

- The canonical description is the contract.
- Sentence 2 defines the in-scope core.
- Sentence 3 defines assumed prior knowledge and downstream topics.
- Sentence 4 defines the level.
- If a validator recommendation would push the graph outside the described boundary, reject it and keep the graph in scope.
- If boundary metadata is present from orchestration, use it directly for the boundary guard instead of trying to infer boundaries from prose.

#### 6. Hard-Edge Sufficiency Rule

- For every non-root node, its hard prerequisites must be sufficient.
- After reconciliation, ask for every node:
  - "If a student has mastered all hard prerequisites of this node, plus only the assumed prior knowledge from the description, can they learn this node?"
- If the answer is no, the graph is still wrong.

#### 7. Curriculum-Scale Rule

- This graph is a topic-scoped unit, usually 4 to 25 nodes.
- Do not inflate it into a full course.
- Do not shrink it so far that it stops covering the topic.
- Do not add filler nodes.

### Allowed Fixes

The reconciler may:

- add a missing node if a curriculum validator identified a truly core omission
- remove an out-of-scope node if it genuinely does not belong
- add, remove, or retype edges
- reposition nodes
- slightly rename node titles for clarity and curricular precision

The reconciler must not:

- introduce concepts outside the canonical topic boundary
- introduce assumed-prior-knowledge concepts as new nodes unless absolutely necessary to repair an internal contradiction
- introduce downstream topics as core graph content
- add filler nodes
- output commentary outside the JSON schema
- ignore major or critical issues without resolving the underlying cause
- mention uncertainty
- summarize the input
- say it "considered" options

### Output Contract

The reconciler must return raw JSON only.

```json
{
  "nodes": [
    { "id": "node_1", "title": "...", "position": 0 }
  ],
  "edges": [
    { "from_node_id": "node_1", "to_node_id": "node_2", "type": "hard" }
  ],
  "resolution_summary": [
    {
      "issue_key": "structure:redundant_edge:node_1,node_2",
      "issue_source": "structure_validator | curriculum_validator | both",
      "issue_description": "Short description of the issue resolved.",
      "resolution_action": "Short description of what was changed."
    }
  ]
}
```

### Node Rules

- Every node must have:
  - `id`
  - `title`
  - `position`
- `id` must match the pattern `node_N`
- `title` must be a concise concept name, 2 to 6 words, Title Case
- `position` must be a non-negative integer
- Total node count must remain between 4 and 25
- Every node must be atomic
- Every node must be necessary
- Every node must remain within topic boundary
- Every node must be teachable in a single lesson and quiz

### Edge Rules

- Every edge must have:
  - `from_node_id`
  - `to_node_id`
  - `type`
- `type` must be `hard` or `soft`
- Graph must be a DAG
- No self-loops
- No duplicate edges
- Every referenced node id must exist
- Every non-root node must have at least one incoming hard edge
- Hard edges must be sufficient but not redundant where avoidable
- Hard edges gate progression
- Soft edges are contextual only

### Final Structural Invariants

The reconciler output is machine-validated and must satisfy all of these:

1. JSON parses without error
2. `nodes` is an array with length between 4 and 25
3. every node has `id`, `title`, `position`
4. all node ids are unique
5. every node id matches `/^node_[1-9][0-9]*$/`
6. at least one node has position 0
7. `edges` is an array with length at least 1
8. every edge has `from_node_id`, `to_node_id`, `type`
9. every edge type is exactly `hard` or `soft`
10. no duplicate edges
11. no self-loops
12. every edge references valid node ids
13. graph is acyclic
14. for every hard edge, `from_node.position < to_node.position`
15. every node with `position > 0` has at least one incoming hard edge
16. no isolated nodes
17. every node is reachable from at least one position-0 node by following hard edges forward
18. hard prerequisites for every node are sufficient
19. graph stays within the canonical topic boundary
20. graph matches the stated level
21. `resolution_summary` is a non-empty array if any validator reported issues
22. each `resolution_summary` item has:
    - `issue_key`
    - `issue_source`
    - `issue_description`
    - `resolution_action`
23. `issue_key` must reference a validator issue accepted by the server for this request
24. every accepted validator issue must be covered exactly once in `resolution_summary` unless deterministic local repair already resolved it and emitted the corresponding summary entry
25. if deterministic machine validation still fails after the first reconciler output, the server may issue one targeted reconcile-repair call that includes the invalid reconciler output plus the exact violated invariants
26. if the targeted reconcile-repair output still fails deterministic validation, the pipeline must fail descriptively instead of proceeding

### Reconciliation Heuristics

- Prefer removing a redundant hard edge over keeping unnecessary transitive clutter.
- Prefer retyping a soft edge to hard when sufficiency requires it.
- Prefer moving a node later rather than adding unnecessary prerequisites.
- Prefer adding one missing core node over overloading an unrelated node.
- Prefer removing a clearly out-of-scope node over trying to justify it with edge changes.
- Prefer preserving a valid title if the issue is ordering, not naming.
- Prefer one global fix that resolves multiple validator findings at once.
- If two issues conflict, choose the correction that best satisfies topic boundary, curriculum correctness, structural soundness, and minimal change in that order.

### Silence Rules

- Do not explain reasoning.
- Do not mention uncertainty.
- Do not summarize the input.
- Do not say you "considered" options.
- Just output the repaired graph and the resolution summary.
- Before responding, silently verify:
  - every major and critical issue is actually resolved
  - no fix created a new structural problem
  - no fix pushed the graph out of scope
  - the final graph still looks like the original graph unless larger changes were required
- Do not produce commentary outside the JSON schema.

## Duplicated Reconciler Note

`AGENTS.md` contains the reconciler prompt block twice.
That duplication is still true in the source and should be treated as a cleanup task, not as a semantic difference between versions.
