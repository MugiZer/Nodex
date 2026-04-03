# Prompt Contracts: Visuals And Diagnostics

This file captures the two content-generation prompts that sit after graph reconciliation:

- `POST /api/generate/visuals`
- `POST /api/generate/diagnostics`

The visual stage enriches final lesson nodes with `p5_code` and `visual_verified`.
The diagnostic stage enriches final nodes with exactly one placement question each.

## Ownership Note

- The visual stage is a post-lesson enhancement stage, not a curriculum or routing stage
- The diagnostic stage is a placement-stage prompt contract that feeds the adaptive diagnostic flow, not the mastery quiz
- `static_diagram` is an upstream required fallback artifact owned by `POST /api/generate/lessons`
- `POST /api/generate/diagnostics` is the dedicated owner of `diagnostic_questions`

## Visual Generation Prompt

### Purpose

Generate an interactive p5.js sketch only when the interaction genuinely improves intuition for the node.

### Input Assumptions

- The graph is already final and validated
- The lesson content is already final
- Each node already contains:
  - `lesson_text`
  - `static_diagram`
  - `quiz_json`
- `static_diagram` is the fallback visual asset for nodes that should not receive a trustworthy interactive sketch
- This prompt does not create `static_diagram`; it only consumes it
- The visual prompt only needs the graph's subject, topic, description, and the node list with `id`, `title`, and `position`
- The visual prompt must not carry lesson bundles, diagnostic bundles, or the full edge list

### Output Shape

```ts
type VisualOutput = {
  nodes: Array<{
    id: string;
    p5_code: string;
    visual_verified: boolean;
  }>;
};
```

### Visual System Prompt Rules

- Treat the visual as an enhancement, not the primary lesson
- Prefer simple, stable, deterministic sketches
- Use interactivity only when it clarifies the node concept
- If the concept is better served by the static diagram, return no interactive sketch
- If unsure, fall back to `p5_code: ""` and `visual_verified: false`
- Never change curriculum, titles, or graph structure
- Do not build a full application around the sketch
- Do not combine multiple downstream concepts into one visual
- Do not depend on HTML controls outside the sketch unless there is no faithful alternative
- Do not hide the concept behind decorative motion
- Do not use randomness in a way that makes the idea unstable or confusing

### Visual Sketch Environment Assumptions

The sketch must:

- define `setup()` and `draw()`
- create a canvas using `createCanvas(480, 320)`
- render entirely inside the canvas
- be a complete sketch that can execute directly
- avoid external DOM dependencies
- avoid imports, exports, and asynchronous behavior
- avoid loading assets or network resources
- avoid instance mode unless explicitly required
- avoid browser APIs outside normal p5-compatible JavaScript
- avoid TypeScript syntax and JSX

Allowed patterns:

- mouse interaction
- `createSlider()` only if truly necessary
- basic shapes, text, lines, and curves
- deterministic internal state

### Visual Validation Rules

If `visual_verified` is `true`:

- `p5_code` must be non-empty
- `p5_code` must contain `function setup`
- `p5_code` must contain `function draw`
- `p5_code` must contain `createCanvas(480, 320)`

If `p5_code` contains any content:

- it must not contain `import `
- it must not contain `export `
- it must not contain `<script`
- it must not contain `fetch(`
- it must not contain `loadImage(`
- it must not contain `loadJSON(`
- it must not contain `loadFont(`

### Visual Retry Rules

- If output fails JSON parsing or schema checks, retry once with identical input
- If output still fails, surface a descriptive error listing violated invariants

## Diagnostic Question Prompt

### Purpose

Generate one diagnostic multiple-choice question per node for adaptive placement.

This is not the mastery quiz.
It is a short boundary-detection signal used to estimate the learner's entry point.

### Input Assumptions

- The graph is already final and validated
- The questions are built from the final node set and edges
- The diagnostic flow uses these questions to move up or down the graph
- The diagnostic prompt only needs the graph's subject, topic, description, node list with `id`, `title`, and `position`, plus hard prerequisite edges
- The diagnostic prompt must not carry the lesson bundle or soft edges

### Output Shape

```ts
type DiagnosticOutput = {
  nodes: Array<{
    id: string;
    diagnostic_questions: [
      {
        question: string;
        options: [string, string, string, string];
        correct_index: number;
        difficulty_order: number;
        node_id: string;
      }
    ];
  }>;
};
```

### Diagnostic System Prompt Rules

- Generate exactly one diagnostic question for each node
- Keep the question short, discriminative, and answerable quickly
- Target the node's central concept, not downstream applications
- Avoid trick wording and unnecessary computation unless the node itself is procedural
- Use the question to distinguish "understands this node" from "does not yet understand this node"
- Do not create mastery-style mini-exams
- Do not broaden the diagnostic beyond the graph itself
- Do not test assumed prior knowledge as if it were new content
- Do not test downstream topics

### Diagnostic Validation Rules

Every diagnostic question must have:

- `question`: non-empty string
- `options`: array of exactly 4 non-empty strings
- `correct_index`: integer from 0 to 3
- `difficulty_order`: integer
- `node_id`: string matching the parent node id

No extra fields are allowed inside diagnostic question objects.
Duplicate question text across nodes is not allowed unless the node titles are explicitly identical and the duplication is justified.

### Diagnostic Retry Rules

- If JSON parsing fails, retry once with identical input
- If schema validation fails, retry once with identical input
- If validation fails again, surface a descriptive error listing violated invariants

## Pipeline Implications

- Diagnostic generation happens after lesson enrichment and before visuals/storage
- Visual generation happens after lesson enrichment and before storage
- Diagnostic questions are tied to the final graph, not to raw generated nodes
- The adaptive diagnostic flow can ask 5 to 8 total questions while relying on one generated question per node
- The visual stage is an enhancement stage, not a replacement for the lesson or the static SVG
- The diagnostic stage is a placement stage, not the mastery quiz
- If the interactive visual is not trustworthy, fallback to the static diagram instead of blocking the graph

## Alignment Note

This file assumes the resolved lower-level pipeline ownership model:

- `lessons` owns `lesson_text`, `quiz_json`, and `static_diagram`
- `diagnostics` owns `diagnostic_questions`
- `visuals` owns `p5_code` and `visual_verified`
