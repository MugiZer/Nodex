# Prompt Contracts: Canonicalize And Graph Generation

This file captures the earliest model contracts from `AGENTS.md` in a single place so agents can load the full prompt behavior without reading the giant source file.

## Canonicalize Prompt

### Purpose

Turn a raw learner request into a canonical `{ subject, topic, description }` object, or return exactly `{"error":"NOT_A_LEARNING_REQUEST"}` when the input is not a learning request.

### System Behavior

The model acts as a concept canonicalizer for an adaptive learning platform. It extracts a precise, structured representation of what the student wants to learn. It must output only raw JSON, with no markdown, no preamble, no explanation, and no trailing text.

The source contract says the model must produce exactly three fields on success and must return the exact `{"error":"NOT_A_LEARNING_REQUEST"}` object when the input is not a learning request.

### Required Output Fields On Success

- `subject`
- `topic`
- `description`

### Supported Subject Set

The broad academic discipline must be exactly one of:

- `mathematics`
- `physics`
- `chemistry`
- `biology`
- `computer_science`
- `economics`
- `financial_literacy`
- `statistics`
- `engineering`
- `philosophy`
- `general`

If the prompt does not fit any domain-specific subject above, use `general`.

### Topic Rules

- Must be lowercase
- Must use underscores only
- Must contain no spaces, no hyphens, and no capitals
- Must be scoped to a knowledge graph of roughly 10 to 25 nodes
- Must not be so granular that it becomes a single formula
- Must not be so broad that it becomes an entire discipline

Examples:

- `trigonometry`
- `classical_mechanics`
- `sorting_algorithms`
- `compound_interest`

### Description Rules

The description is a canonical concept definition that will be embedded as a vector for semantic retrieval. It must follow this exact four-sentence structure with no deviation:

1. `"{Topic} is the study of [what it covers at the highest level]."`
2. `"It encompasses [list of 4-8 core subtopics or concepts, comma-separated]."`
3. `"It assumes prior knowledge of [prerequisite topics] and serves as a foundation for [downstream topics]."`
4. `"Within [subject], it is typically encountered at the [introductory|intermediate|advanced] level."`

Additional rules:

- Exactly four sentences, no more and no less
- Sentence 1 must start with the topic name followed by `is the study of`
- Sentence 2 must start with `It encompasses`
- Sentence 3 must start with `It assumes prior knowledge of` and must contain `and serves as a foundation for`
- Sentence 4 must start with `Within` and must end with one of:
  - `introductory level.`
  - `intermediate level.`
  - `advanced level.`
- No opinions
- No motivational language
- No student-facing phrasing
- No markdown
- Total length must be 50 to 120 words

### Interpretation Rules

- If the prompt is vague, map it to the most precise topic you can confidently infer
  - Example: `I want to learn calculus` → `differential_calculus`
- If the prompt is a sub-skill of a broader topic, zoom out to the topic level
  - Example: `Integration by parts` → `integral_calculus`
- If the prompt is too broad, narrow to the most likely starting topic for a self-directed learner
  - `math` → `algebra`
  - `physics` → `classical_mechanics`
  - `computer science` → `programming_fundamentals`
  - `chemistry` → `general_chemistry`
  - `biology` → `cell_biology`
  - `economics` → `microeconomics`
  - `financial literacy` → `personal_finance_fundamentals`
  - `statistics` → `descriptive_statistics`
  - `engineering` → `statics`
  - `philosophy` → `formal_logic`
- If the prompt is nonsensical, off-topic, or not a learning request, return exactly `{"error":"NOT_A_LEARNING_REQUEST"}`
- Never invent subjects or topics that do not correspond to real academic content

### User Prompt Contract

The student input is passed as:

```text
The student typed: "{prompt}"
```

The model is instructed to extract the canonical subject, topic, and description from that prompt.

### Output Format

Respond with only a raw JSON object. No code fences. No preamble. No explanation.

Success example:

```json
{"subject":"mathematics","topic":"trigonometry","description":"Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, and tangent functions, their reciprocals, trigonometric identities, angle addition and subtraction formulas, the laws of sines and cosines, radian measure, and the graphing of periodic functions. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and classical mechanics. Within mathematics, it is typically encountered at the intermediate level."}
```

Failure example:

```json
{"error":"NOT_A_LEARNING_REQUEST"}
```

### Server-Side Validation

The current validation contract in `AGENTS.md` is:

1. JSON parses without error
2. If `error` exists, it must equal exactly `{"error":"NOT_A_LEARNING_REQUEST"}`
3. `subject` must be a non-empty string from the allowed list:
   - `mathematics`
   - `physics`
   - `chemistry`
   - `biology`
   - `computer_science`
   - `economics`
   - `financial_literacy`
   - `statistics`
   - `engineering`
   - `philosophy`
   - `general`
4. `topic` must match `/^[a-z][a-z0-9_]*$/`
5. `description` must have exactly 4 sentences, checked by splitting on `. `
6. Sentence 1 must start with a capital letter and contain `is the study of`
7. Sentence 2 must start with `It encompasses`
8. Sentence 3 must start with `It assumes prior knowledge of` and contain `and serves as a foundation for`
9. Sentence 4 must start with `Within` and end with one of the allowed level phrases
10. `description` word count must be between 50 and 120
11. If any check fails, retry once with identical input, then fail with a descriptive error

Additional source caveat:

- If the `error` key exists, the server must surface the error to the student and must not proceed to later generation stages.

### Important Canonicalize Caveats

- `general` is a first-class allowed subject and serves as the fallback when no domain-specific subject fits
- The description is also used for semantic retrieval, so it must describe the topic boundary clearly enough to support vector matching
- The canonicalizer should prefer the most specific confident topic, but not force arbitrary precision if the prompt is vague

## Graph Generator Prompt

### Purpose

Generate a complete topic-scoped knowledge dependency graph as a DAG with atomic concepts and prerequisite edges.

### System Behavior

The model receives a canonicalized concept definition and produces two arrays: `nodes` and `edges`. It must output only raw JSON, with no markdown, no preamble, no explanation, and no trailing text.

### Node Contract

Each node represents one atomic concept that can be taught in a single lesson and tested with a short quiz.

Required node fields:

- `id`: temporary string identifier in the form `node_1`, `node_2`, etc., sequential starting at 1
- `title`: concise concept name, 2 to 6 words, Title Case
- `position`: integer topological order, where 0 is the most foundational layer

### Node Rules

- The graph must contain between 10 and 25 nodes
- Every node must be atomic
- If a concept contains two distinct ideas, split it into two nodes
- Every node must be necessary
  - either it is a real prerequisite for at least one downstream node
  - or it is a terminal capstone concept of the topic
- Every node must be self-contained at its position
  - a student who has mastered all hard prerequisites should have everything needed to learn the node
  - if outside knowledge is needed that is not in the graph and not in assumed prior knowledge, a node is missing
- Nodes must stay within the topic boundary defined by the description
  - do not add prerequisites from other topics
  - do not import assumed prior knowledge topics into the graph as if they are new content
- Position 0 nodes are entry points
  - they require only the prior knowledge stated in the description
- The highest-position nodes are capstones
- No two nodes share a position unless they are genuinely independent at that layer

### Edge Contract

Each edge represents a prerequisite relationship between two nodes.

Required edge fields:

- `from_node_id`: the prerequisite node id
- `to_node_id`: the dependent node id
- `type`: either `hard` or `soft`

### Edge Semantics

- `hard`
  - the dependent node cannot be understood without mastering the prerequisite
  - the prerequisite provides knowledge directly used in the dependent node
  - hard edges gate student progression
  - the student cannot attempt the dependent node until the prerequisite is completed
- `soft`
  - the prerequisite provides helpful context or motivation but is not strictly required
  - the student could still learn the dependent node without it
  - soft edges do not gate progression
  - they are only visual/contextual

Examples from the source:

- Hard edge: `Sine Function` → `Law of Sines`
- Hard edge: `Radian Measure` → `Arc Length Formula`
- Soft edge: `History of Trigonometry` → `Unit Circle Definition`
- Soft edge: `Graphing Sine` → `Graphing Cosine` when cosine is independently teachable from the cosine definition

### Edge Rules

- The graph must be a DAG
- No cycles of any length
- No node can be its own prerequisite, directly or transitively
- Every non-root node must have at least one incoming hard edge
- A node with no hard prerequisites is a missing dependency
- Hard prerequisites must be sufficient
  - a student who completed all hard prerequisites must be able to learn the node without extra knowledge beyond the description’s assumed prior knowledge
- Do not over-connect
  - if `A` is a hard prerequisite of `B` and `B` is a hard prerequisite of `C`, do not add hard edge `A` → `C`
  - add `A` → `C` as a soft edge only if it provides direct context beyond `B`
- Prefer fewer edges
  - every edge must be justifiable
  - if removing an edge does not break the graph, remove it
- Hard edge ordering must respect positions
  - a hard edge from position `X` to position `Y` requires `X < Y`
  - nothing may depend on something that comes after it

### Structural Invariants

The model output is machine-validated against these invariants:

1. Node count is between 10 and 25
2. All node ids are unique
3. All node positions are non-negative integers
4. At least one node has position 0
5. No duplicate edges by `(from_node_id, to_node_id)`
6. Every edge endpoint references a valid node id
7. No self-loops
8. The graph is acyclic
9. Every edge type is exactly `hard` or `soft`
10. For every hard edge, source position is less than target position
11. Every non-root node has at least one incoming hard edge
12. No isolated nodes

### Output Format

Return only a raw JSON object:

```json
{
  "nodes": [
    {"id":"node_1","title":"...","position":0},
    {"id":"node_2","title":"...","position":0},
    {"id":"node_3","title":"...","position":1}
  ],
  "edges": [
    {"from_node_id":"node_1","to_node_id":"node_3","type":"hard"},
    {"from_node_id":"node_2","to_node_id":"node_3","type":"soft"}
  ]
}
```

### User Prompt Contract

The model is asked to:

```text
Generate a knowledge dependency graph for the following concept:

Subject: {subject}
Topic: {topic}
Description: {description}

Produce the complete node and edge arrays.
```

### Example Graph Snippet

The source file includes a full trigonometry example graph with nodes such as:

- `Angle Measurement`
- `Right Triangle Ratios`
- `Sine Function`
- `Cosine Function`
- `Tangent Function`
- `Reciprocal Functions`
- `Radian Measure`
- `Unit Circle Definition`
- `Pythagorean Identity`
- `Graphing Sine`
- `Graphing Cosine`
- `Graphing Tangent`
- `Angle Addition Formulas`
- `Angle Subtraction Formulas`
- `Double Angle Formulas`
- `Law of Sines`
- `Law of Cosines`
- `Inverse Trigonometric Functions`
- `Trigonometric Equations`

The example is useful because it shows:

- mixed root nodes at position 0
- hard and soft prerequisite edges
- multiple later capstones
- no redundant transitive hard edges

### Graph Generator Validation

The current server-side validation contract is:

1. JSON parses without error
2. `nodes` is an array with length between 10 and 25
3. Every node has `id`, `title`, and `position`
4. All node ids are unique
5. At least one node has position 0
6. `edges` is an array with length at least 1
7. Every edge has `from_node_id`, `to_node_id`, and `type`
8. No duplicate edges
9. Every edge endpoint references a valid node id
10. No self-loops
11. Every hard edge must go from lower position to higher position
12. Every node with position `> 0` must have at least one incoming hard edge
13. No isolated nodes
14. DAG check succeeds
15. If any check fails, retry once with the same input, then fail with a descriptive error listing violated invariants

### Graph Generator Caveats

- The graph generator should not invent content outside the topic boundary
- It should prefer fewer, cleaner edges over dense over-connection
- It must not rely on downstream fixes to make the graph structurally valid
- It must not output prose or commentary
- If it cannot satisfy all 12 structural invariants, it should stop and rethink the graph before outputting anything

### Additional Source Notes

- The graph generator handles the atomic decomposition itself; it is not allowed to assume later steps will split nodes for it.
- The description's assumed-prior-knowledge clause is the out-of-scope boundary for what should not be reintroduced as new graph content.
- The example trigonometry graph demonstrates mixed root nodes, hard and soft edges, multiple capstones, and the absence of redundant transitive hard edges.
