import { describe, expect, it } from "vitest";

import {
  DAY2_DUPLICATE_TRACE,
  DAY2_PARTIAL_FAILURE_TRACE,
  DAY2_SUCCESS_TRACE,
  DAY2_VISUAL_FALLBACK_TRACE,
  replayDay2Trace,
} from "../harness/day2-generation";

describe("day 2 generation trace replay", () => {
  it("replays the happy path with all-or-nothing persistence", () => {
    const outcome = replayDay2Trace(DAY2_SUCCESS_TRACE);

    expect(outcome.status).toBe("stored");
    expect(outcome.persisted_graph_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(outcome.cached_graph_id).toBeNull();
    expect(outcome.store_writes).toEqual(["graphs", "nodes", "edges"]);
    expect(outcome.completed_stages).toEqual([
      "canonicalize",
      "retrieve",
      "graph",
      "lessons",
      "diagnostics",
      "visuals",
      "store",
    ]);
    expect(Object.values(outcome.render_kinds).some((kind) => kind === "interactive")).toBe(
      true,
    );
    expect(outcome.failure).toBeNull();
  });

  it("replays the fallback visual path without blocking store eligibility", () => {
    const outcome = replayDay2Trace(DAY2_VISUAL_FALLBACK_TRACE);

    expect(outcome.status).toBe("stored");
    expect(outcome.store_writes).toEqual(["graphs", "nodes", "edges"]);
    expect(Object.values(outcome.render_kinds).every((kind) => kind === "static")).toBe(true);
  });

  it("suppresses duplicate writes when a pre-store recheck finds an existing graph", () => {
    const outcome = replayDay2Trace(DAY2_DUPLICATE_TRACE);

    expect(outcome.status).toBe("duplicate");
    expect(outcome.cached_graph_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(outcome.persisted_graph_id).toBeNull();
    expect(outcome.store_writes).toEqual([]);
    expect(outcome.failure).toBeNull();
  });

  it("drops malformed runs before any persistence can happen", () => {
    const outcome = replayDay2Trace(DAY2_PARTIAL_FAILURE_TRACE);

    expect(outcome.status).toBe("aborted");
    expect(outcome.store_writes).toEqual([]);
    expect(outcome.persisted_graph_id).toBeNull();
    expect(outcome.failure).not.toBeNull();
    expect(outcome.failure?.stage).toBe("diagnostics");
  });
});
