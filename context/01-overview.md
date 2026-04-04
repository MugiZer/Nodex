# Overview

## Next.js Warning

This is not stock Next.js. APIs, conventions, and file structure may differ from training data. Before writing code, read the relevant guides in `node_modules/next/dist/docs/` and heed deprecation notices.

## Project Summary

Foundation is an adaptive learning platform. It takes any concept, builds a knowledge dependency graph, diagnoses where a student's foundation breaks, and routes them to their exact entry point.

Core thesis: generate once, serve forever, with near-zero marginal cost per student.
The system should feel like a real product, not a mock demo, even though the build target is hackathon-practical.

## MVP Mode

Foundation is currently operating in MVP/demo mode.

- The immediate goal is a correct-looking, end-to-end graph and lesson flow that works reliably in live generation across multiple subjects.
- Demo reliability is prioritized over curriculum purity when those goals conflict.
- Learner-facing routes should prefer graceful degradation, deterministic fallback, and reduced failure risk over strict rejection of otherwise usable outputs.
- Internal debug paths may remain stricter so structural defects are still visible during development.
- The demo standard is practical: if the graph, lessons, diagnostics, and visuals look coherent, hold together under inspection, and do not expose visible defects, the result is acceptable for the stage demo.

Current demo UI direction:

- three screens only: prompt, graph, lesson
- prompt screen is a single centered input with a lightweight thinking state
- graph screen is a deterministic React Flow DAG with blue available nodes, green completed nodes, and gray pending nodes
- lesson screen is a full-width, distraction-free reading experience that returns the learner to the graph on completion
- the graph must visibly change when a node is completed
- no red learner-facing node state in the demo flow
- the demo flow must not introduce a separate learner-visible diagnostic screen

## Stack

- Next.js App Router, TypeScript, Tailwind
- Supabase (PostgreSQL + pgvector)
- Anthropic `claude-sonnet-4-6` for all LLM calls
- OpenAI `text-embedding-3-small` for embeddings only
- React Flow for graph visualization
- p5.js for interactive visuals

Version note:

- Follow the installed framework versions in `package.json` as the runtime truth for implementation details
- Do not rely on legacy version numbers copied into older docs or snapshots

## Absolute Rules

- Use `claude-sonnet-4-6` for every Claude call
- Every API route must have `try/catch` with descriptive error messages
- Never return a 500 without a descriptive JSON error message
- All code must be fully typed with TypeScript; no `any`
- Never hardcode API keys; always use `process.env`
- `console.log` progress at every pipeline step for debugging
- Use `claude-sonnet-4-6` for all Claude model interactions without exception
- Keep every server route defensive: descriptive JSON errors, not bare failures
- Treat broken visuals as non-blocking; fallback must always preserve the learner flow
- Use Supabase service-role credentials only on trusted server-side routes
- Client code must use only `NEXT_PUBLIC_*` environment variables

## Intended File Structure

- `lib/supabase.ts` - Supabase client using service role for server work
- `lib/anthropic.ts` - Anthropic client
- `lib/openai.ts` - OpenAI client for embeddings only
- `lib/types.ts` - shared TypeScript interfaces
- `lib/*` should remain the shared utility layer for server clients and types
- `app/api/generate/route.ts` - master orchestrator
- `app/api/generate/canonicalize/route.ts` - prompt to `{subject, topic, description}`
- `app/api/generate/retrieve/route.ts` - vector search to `graph_id | null`
- `app/api/generate/graph/route.ts` - four-agent graph pipeline
- `app/api/generate/lessons/route.ts` - lesson, quiz, and static diagram enrichment
- `app/api/generate/diagnostics/route.ts` - diagnostic question enrichment
- `app/api/generate/visuals/route.ts` - p5 generation and `visual_verified`
- `app/api/generate/store/route.ts` - persistence
- `app/page.tsx` - landing page
- `app/graph/[id]/page.tsx` - graph view
- `app/graph/[id]/lesson/[nodeId]/page.tsx` - lesson view
- `components/GraphCanvas.tsx`
- `components/NodeCard.tsx`
- `components/NodeDetailPanel.tsx`
- `components/FlagshipLesson.tsx`
- `components/renderLessonText.tsx`
- `app/api/generate/*` owns generation flow only; detailed prompt and schema contracts live in the later context files
- `app/*` owns the interactive learner experience and should stay aligned with the backend contracts

## Demo Flow

1. Student types a prompt such as "I want to learn calculus"
2. System canonicalizes the prompt and retrieves or generates a graph
3. Graph appears with an emphasized entry node and a right-side detail panel
4. Student clicks Start lesson and enters the full-screen lesson
5. Student completes the lesson, returns to the graph, and sees the node turn green
6. Demo pitch: low generation cost, unlimited reuse
7. The judge path must remain robust even if an interactive visual is omitted or falls back to the static diagram

## Environment Variables

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Server-side routes use `SUPABASE_SERVICE_ROLE_KEY`.
Client-side code uses only `NEXT_PUBLIC_*` values.
Use `SUPABASE_SERVICE_ROLE_KEY` only in trusted server-side code paths.
Never leak service-role credentials into the client bundle.

## High-Level Warnings

- This is not stock Next.js; read the relevant guides in `node_modules/next/dist/docs/` before writing code.
- Use `claude-sonnet-4-6` for every Claude call with no exceptions.
- Every API route must have `try/catch` and must return descriptive JSON errors instead of bare 500s.
- Keep all code fully typed in TypeScript; do not use `any`.
- Never hardcode secrets; always read API keys and service credentials from environment variables.
- Log pipeline progress with `console.log` at each major step so generation failures are debuggable.
- Use the Supabase service role only on trusted server-side routes; client code must stay on `NEXT_PUBLIC_*` values.
- Do not block the learner because an interactive visual failed; the static fallback exists for a reason.
- Do not assume the monolithic `AGENTS.md` is the best place to read detailed contracts; use the split context files for topic-specific work.
- If a detail is missing here, it likely lives in `context/02-data-and-api.md`, `context/03-generation-flow.md`, or the later context files.

## Reference Note

Detailed contracts for schema, API behavior, prompt stages, learner state, frontend behavior, and shipping rules live in the other files under `context/`.
