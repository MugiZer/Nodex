import { describe, expect, it } from "vitest";

import {
  createProgressCompletionHint,
} from "@/lib/progress-session";
import {
  buildProgressWriteRequestBody,
} from "@/lib/progress-write-client";
import type { ProgressWriteResponse } from "@/lib/types";

describe("progress write client helpers", () => {
  it("builds a normalized request body and completion hint", () => {
    const requestBody = buildProgressWriteRequestBody({
      graph_id: "77777777-7777-4777-8777-777777777777",
      node_id: "88888888-8888-4888-8888-888888888888",
      score: 3,
    });

    expect(requestBody.graph_id).toBe("77777777-7777-4777-8777-777777777777");
    expect(requestBody.node_id).toBe("88888888-8888-4888-8888-888888888888");
    expect(requestBody.score).toBe(3);
    expect(requestBody.timestamp).toEqual(expect.any(String));

    const response: ProgressWriteResponse = {
      progress: {
        id: "99999999-9999-4999-8999-999999999999",
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        node_id: requestBody.node_id,
        graph_version: 1,
        completed: true,
        attempts: [{ score: 3, timestamp: requestBody.timestamp ?? "" }],
      },
      available_node_ids: [requestBody.node_id],
      flagged_for_review: false,
    };

    const hint = createProgressCompletionHint({
      graphId: requestBody.graph_id,
      response,
    });

    expect(hint).not.toBeNull();
    expect(hint?.graphId).toBe(requestBody.graph_id);
    expect(hint?.completedNodeIds).toEqual([requestBody.node_id]);
    expect(hint?.availableNodeIds).toEqual([requestBody.node_id]);
  });

  it("does not create a completion hint for incomplete progress", () => {
    const response: ProgressWriteResponse = {
      progress: {
        id: "99999999-9999-4999-8999-999999999999",
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        node_id: "88888888-8888-4888-8888-888888888888",
        graph_version: 1,
        completed: false,
        attempts: [{ score: 1, timestamp: "2026-04-01T12:00:00.000Z" }],
      },
      available_node_ids: [],
      flagged_for_review: false,
    };

    expect(
      createProgressCompletionHint({
        graphId: "77777777-7777-4777-8777-777777777777",
        response,
      }),
    ).toBeNull();
  });
});
