# Nodex

An adaptive learning platform that diagnoses the exact gaps in your foundation and builds a personalized path to mastery.

Built solo, as a high schooler, at the Claude Builders Club × McGill Hackathon, competing against teams of McGill university students.

## The Problem

Self-learners don't fail because the material is too hard. They fail because they have holes in their prerequisites and no way to find them.

Structured curricula can't diagnose your specific gaps. You end up grinding through entire courses for the three concepts you actually need.

Tutors solve this perfectly. They know the full dependency chain, spot exactly where you break down, and route you through the minimum path. But they cost $50-100/hr and don't scale.

## The Thesis

Every concept has a dependency chain, a directed acyclic graph of prerequisites. If you map that graph and diagnose where a learner breaks down, you can generate a minimal, personalized learning path from their gaps to their goal, skipping everything they already know.

Each node teaches exactly what's needed to unlock the next. Mastery is enforced through quizzes so no one advances on shaky ground.

Once a graph is generated, it's stored. One generation cost, unlimited distribution. You explain a concept the way a tutor would, then distribute a personalized version of it to anyone for nearly free.

## How It Works

1. **Prompt.** The learner types what they want to learn: "I want to learn calculus", "teach me differential equations", etc.

2. **Canonicalization.** The system normalizes the request into a structured `{ subject, topic, description }` triple, so different phrasings of the same topic resolve to the same stored graph.

3. **Graph retrieval or generation.** Supabase is checked for an existing graph. If none exists, Claude generates a new DAG of concept nodes and prerequisite edges, then stores it for all future learners.

4. **Adaptive diagnostic.** A diagnostic assessment identifies which prerequisites the learner already knows and which they don't, placing them at the right starting point.

5. **Node-by-node progression.** Each node contains a lesson. Advancement requires passing the quiz. Downstream nodes stay locked until prerequisites are proven.

6. **Background enrichment.** Lessons, quizzes, diagrams, and interactive visuals are generated asynchronously. The learner can start immediately while deeper content is still being built.

## Architecture

### Canonicalization Layer

User prompts are freeform and messy. The canonicalization layer normalizes them into a deterministic `{ subject, topic, description }` triple so that "teach me calc", "I want to learn calculus", and "help me with introductory calculus" all resolve to the same graph.

### Graph Engine

The core data structure is a directed acyclic graph where each node is a concept (e.g. "limits", "chain rule"), each edge is a hard prerequisite dependency, and the graph is topologically sorted to guarantee a valid learning order.

Graphs are generated via Claude when no match exists in the database, then persisted to Supabase. The generation pipeline is fail-soft: partial graphs are repairable rather than discarded.

Layout is handled by Dagre (automatic DAG layout) and React Flow (interactive graph visualization), giving learners a zoomable, pannable view of their learning path with clear visual state for locked, available, and completed nodes.

### Adaptive Diagnostic System

The diagnostic isn't a generic placement test. It's generated from the prerequisite structure of the specific graph the learner is entering. Questions target prerequisite nodes to find the exact frontier of the learner's knowledge.

Diagnostic state is preserved across sessions so returning learners don't retake it.

### Node Enrichment Pipeline

Each node can carry:
- Lesson text written in the context of its prerequisites
- A quiz that gates progression to dependent nodes
- A static diagram or p5.js interactive visualization
- Prerequisite-specific supplementary content

Enrichment runs asynchronously after graph creation. The learner flow stays intact even if a visual or enrichment step hasn't finished or fails.

### Progress and State

Progress is keyed by `{ user_id, node_id, graph_version }` and stored in Supabase. Progress survives browser refreshes and device switches. Graph versioning lets the underlying graph evolve without breaking existing learner state. Prerequisite node IDs are normalized consistently across URLs, client state, and server resolvers.

### Route Architecture

Lesson pages are server-resolvable. The client doesn't need to reconstruct which lesson to display from client-side state. Route handlers are typed and wrapped in try/catch with structured error responses. Early iterations used client-side lesson resolution from URL params, but encoded prerequisite node IDs would break navigation in edge cases, so I moved it server-side.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| UI | React, Tailwind CSS |
| Language | TypeScript |
| Database | Supabase |
| Graph layout | Dagre |
| Graph rendering | React Flow |
| AI generation | Claude API |
| Interactive visuals | p5.js |

## Repository Structure

```
app/            → Next.js routes and pages
components/     → UI for landing, graph, diagnostic, and lesson views
lib/            → Shared logic, schemas, server helpers, session utilities
context/        → Contract documentation (source of truth)
tests/          → Regression and integration tests
scripts/        → Preflight, smoke, and maintenance scripts
```

## Key Design Decisions

**Why a DAG and not a linear curriculum?**
Learning isn't linear. A single concept can have multiple independent prerequisites, and one prerequisite can unlock multiple downstream concepts. A DAG captures this naturally and lets learners skip branches they already know.

**Why enforce mastery at each node?**
The whole thesis breaks if learners advance without understanding. Quizzes are the mechanism that prevents the same prerequisite gaps the product exists to solve.

**Why store graphs?**
Graph generation is the most expensive operation (multiple Claude API calls). Storing the result means every subsequent learner who wants the same topic gets it instantly.

**Why server-resolved lessons?**
Client-side lesson resolution from URL params was fragile. Encoded prerequisite node IDs would break navigation. Moving it to the server eliminated an entire class of bugs.

## Development

```bash
npm install
npm run dev
npm test
```

Check `package.json` and `scripts/` for additional commands.

