<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo must be implemented against the installed Next.js version in `package.json` and the relevant guides in `node_modules/next/dist/docs/`, not against stale assumptions from older docs or model priors.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — Foundation

## Status

This file is the root agent entrypoint for the repository.

Authoritative rule:

- `context/*` is the implementation authority for this repo.
- If this file and `context/*` ever disagree, follow `context/*`.
- Update `context/*` first when changing contracts, then update this file only as a summary shim.

This file intentionally stays short to avoid reintroducing stale duplicated contracts.

## Project Summary

Foundation is an adaptive learning platform that:

- canonicalizes a learner prompt into `{subject, topic, description}`
- retrieves an existing graph when a usable match exists
- otherwise generates a new knowledge dependency graph
- enriches nodes with lessons, diagnostics, and visuals
- persists graph content and learner progress in Supabase
- uses adaptive diagnostic placement and hard-edge mastery gating

## Non-Negotiables

- Use `claude-sonnet-4-5` for every Claude call.
- Use `text-embedding-3-small` for embeddings only.
- Every API route must use `try/catch` and return descriptive JSON errors.
- Never return a bare `500`.
- Keep all code fully typed in TypeScript with no `any`.
- Never hardcode secrets; use `process.env`.
- Log pipeline progress with `console.log` / `console.error` at each major step.
- Use the Supabase service role only on trusted server-side routes.
- Client code must use only `NEXT_PUBLIC_*` variables.
- Broken interactive visuals must never block learning; fallback must preserve learner flow.

## Authority Map

Read the narrowest file in `context/` that covers the task.

- `context/01-overview.md` — project summary, stack, high-level rules
- `context/02-data-and-api.md` — data model, API contracts, auth transport, retrieval rules
- `context/03-generation-flow.md` — pipeline order, diagnostics, unlock behavior, fallback rules
- `context/04-prompt-canonicalize-and-graph.md` — canonicalize and graph-generator contracts
- `context/05-prompt-validators-and-reconciler.md` — validator and reconciler contracts
- `context/06-prompt-visuals-and-diagnostics.md` — diagnostics and visuals prompt/output contracts
- `context/07-pack-domain-db-retrieval.md` — domain, DB/auth, retrieval pack-level rules
- `context/08-pack-orchestration-prompts-content.md` — orchestration and content-pack rules
- `context/09-pack-progress-frontend-ops.md` — progress, frontend, ops, and acceptance rules
- `context/99-known-contradictions.md` — historical contradiction ledger and regression tracker

## Implementation Notes

- Treat `GET /api/graph/[id]` progress as learner-scoped only.
- Treat temporary generation ids such as `node_1` as non-persisted and remap them before storage.
- Use the Supabase cookie-backed browser session as the V1 learner identity transport.
- Use `context/*` instead of this file for exact route, schema, and prompt contracts.
