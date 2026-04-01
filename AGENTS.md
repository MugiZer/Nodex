<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — Foundation

## Project Summary
Foundation is an adaptive learning platform. It takes any concept, 
builds a knowledge dependency graph, diagnoses where a student's 
foundation breaks, and routes them to their exact entry point.
Generate once, serve forever. Zero marginal cost per student.

## Stack
- Next.js 14, App Router, TypeScript, Tailwind
- Supabase (PostgreSQL + pgvector)
- Anthropic claude-sonnet-4-5 for ALL LLM calls
- OpenAI text-embedding-3-small for embeddings only
- React Flow for graph visualization
- p5.js for interactive visuals

## Absolute Rules
- Use claude-sonnet-4-5 for every Claude call, no exceptions
- Every API route must have try/catch with descriptive error messages
- Never return a 500 without a descriptive JSON error message
- All code must be fully typed with TypeScript, no `any`
- Never hardcode API keys — always use process.env
- Console.log progress at every pipeline step for debugging

## File Structure
/lib/supabase.ts        — Supabase client (service role for server)
/lib/anthropic.ts       — Anthropic client
/lib/openai.ts          — OpenAI client
/lib/types.ts           — All TypeScript interfaces

/app/api/generate/route.ts                — Master orchestrator
/app/api/generate/canonicalize/route.ts  — Prompt → {subject, topic, description}
/app/api/generate/retrieve/route.ts      — Vector search → graph_id or null
/app/api/generate/graph/route.ts         — Four-agent pipeline → validated graph
/app/api/generate/lessons/route.ts       — Nodes → enriched nodes with lessons
/app/api/generate/visuals/route.ts       — Nodes → p5.js code + visual_verified
/app/api/generate/store/route.ts         — Save everything to Supabase

/app/page.tsx                            — Landing page with prompt input
/app/graph/[id]/page.tsx                 — Graph view with React Flow
/app/graph/[id]/diagnostic/page.tsx      — Adaptive diagnostic flow
/components/GraphCanvas.tsx              — React Flow graph component
/components/NodePanel.tsx                — Lesson + quiz slide-in panel
/components/DiagnosticFlow.tsx           — 5-8 question adaptive assessment
/components/P5Sketch.tsx                 — p5.js embed component

## Database Schema

### graphs
id uuid PK | title text | subject text | topic text | description text
embedding vector(1536) | version int | flagged_for_review boolean | created_at timestamp

### nodes  
id uuid PK | graph_id uuid FK | graph_version int | title text
lesson_text text | static_diagram text (SVG string) | p5_code text
visual_verified boolean | quiz_json jsonb | diagnostic_questions jsonb
position int | attempt_count int | pass_count int

### edges
from_node_id uuid FK | to_node_id uuid FK | type text (hard|soft)

### user_progress
id uuid PK | user_id uuid | node_id uuid FK | graph_version int
completed boolean | attempts jsonb [{score: int, timestamp: string}]

## Data Shapes

### quiz_json (per node, array of 3)
[{
  question: string,
  options: string[4],
  correct_index: number,
  explanation: string
}]

### diagnostic_questions (per node, array of 1)
[{
  question: string,
  options: string[4],
  correct_index: number,
  difficulty_order: number,
  node_id: string
}]

## Pipeline Order (master orchestrator)
1. POST /api/generate/canonicalize → {subject, topic, description}
2. POST /api/generate/retrieve → {graph_id} or {graph_id: null}
3. If graph_id exists → return {graph_id, cached: true}
4. If null → POST /api/generate/graph → {nodes, edges}
5. → POST /api/generate/lessons → enriched nodes
6. → POST /api/generate/visuals → nodes with p5_code + visual_verified
7. → POST /api/generate/store → {graph_id}
8. Return {graph_id, cached: false}

## Four-Agent Graph Pipeline
Agent 1 — Generator: produce nodes[] and edges[] from concept description
Agent 2 — Structure Validator: check circular deps, misclassified edges → {issues[]}
Agent 3 — Curriculum Validator: check against real curricula → {issues[]}
Agent 4 — Reconciler: takes original graph + both issue arrays → final graph

Each agent is a separate Claude call with no shared context.

## Adaptive Diagnostic Logic
- Start at mid-graph node (position = Math.floor(totalNodes / 2))
- Correct answer → jump up 2 positions
- Wrong answer → drop down 2 positions  
- After 8 questions → entry point = highest position where student was correct
- Score client-side, no API call needed

## Node Unlock Logic
A node unlocks when ALL of its hard-edge prerequisites are completed.
Soft-edge prerequisites do not block unlocking.

## Visual Fallback
If visual_verified is false → show static_diagram (SVG string)
If visual_verified is true → show p5_code in P5Sketch component
Never block a student due to a broken visual.

## Demo Flow (what judges will see)
1. Student types "I want to learn calculus"
2. System canonicalizes → retrieves or generates trig graph
3. Adaptive diagnostic runs → graph illuminates with entry point
4. Student clicks available node → lesson + visual appears
5. Student passes quiz → node turns green → next node unlocks
6. Pitch: "This cost $2 to generate and now serves unlimited students for free"

## Environment Variables
ANTHROPIC_API_KEY
OPENAI_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

Use SUPABASE_SERVICE_ROLE_KEY for all server-side routes.
Use NEXT_PUBLIC_ vars for client-side only.

## API Response Contracts

POST /api/generate/canonicalize
Input:  { prompt: string }
Output: { subject: string, topic: string, description: string }

POST /api/generate/retrieve
Input:  { subject: string, description: string }
Output: { graph_id: string } | { graph_id: null }

POST /api/generate/graph
Input:  { subject: string, topic: string, description: string }
Output: { nodes: Node[], edges: Edge[] }

POST /api/generate/lessons
Input:  { nodes: Node[] }
Output: { nodes: Node[] }

POST /api/generate/visuals
Input:  { nodes: Node[] }
Output: { nodes: Node[] }

POST /api/generate/store
Input:  { graph: Graph, nodes: Node[], edges: Edge[] }
Output: { graph_id: string }

POST /api/generate
Input:  { prompt: string }
Output: { graph_id: string, cached: boolean }

GET /api/graph/[id]
Output: { graph: Graph, nodes: Node[], edges: Edge[], progress: UserProgress[] }

## Retrieval Threshold
Cosine similarity threshold: 0.85
If best match >= 0.85 → return existing graph_id
If best match < 0.85 → return null → trigger generation

## Node Unlock Algorithm
A node is AVAILABLE if all edges WHERE to_node_id = this node 
AND type = 'hard' have their from_node_id in the completed set.

Soft edges never block — display only as dashed lines.

On quiz pass:
1. Insert {score, timestamp} into user_progress.attempts
2. Set user_progress.completed = true
3. Increment node.pass_count and node.attempt_count
4. Check all downstream nodes, unlock any with all hard prereqs complete
5. If attempt_count > 10 AND pass_count/attempt_count < 0.4
   → set graphs.flagged_for_review = true

On quiz fail:
1. Insert {score, timestamp} into user_progress.attempts
2. Increment node.attempt_count only
3. Do not change completed

## Auth
Use Supabase anonymous sessions.
On first visit call supabase.auth.signInAnonymously()
Store session user.id as user_id in all user_progress records.
No email or password required.

## pgvector Query Pattern
SELECT id, 1 - (embedding <=> '[vector]'::vector) AS similarity
FROM graphs
WHERE subject = '[subject]'
ORDER BY similarity DESC
LIMIT 1;

If similarity >= 0.85 → use this graph_id
