import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/graph/status/[requestId]/route";
import { createGenerateRequestRecord, updateGenerateRequestRecord } from "@/lib/server/generation/request-store";

describe("graph status route", () => {
  it("returns failed status for a failed background generation request", async () => {
    const requestId = "request-failed-0001";
    createGenerateRequestRecord({
      request_id: requestId,
      prompt: "learn rational functions",
      topic: "rational_functions",
    });
    updateGenerateRequestRecord(requestId, {
      status: "failed",
      graph_id: null,
      cached: false,
    });

    const response = await GET(new Request("http://localhost/api/graph/status/request-failed-0001"), {
      params: Promise.resolve({ requestId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "failed",
      graph_id: null,
      prerequisite_lessons_status: "pending",
      prerequisite_lessons: null,
    });
  });
});
