import { describe, expect, it } from "vitest";

import {
  handleGraphDiagnosticRequest,
} from "@/app/api/graph/[id]/diagnostic/route";
import { GET as getLessonResolver } from "@/app/api/graph/[id]/lesson/[nodeId]/route";
import { POST as postGraphDiagnostic } from "@/app/api/graph/status/[requestId]/diagnostic/route";
import type { StoredGraphDiagnosticResult } from "@/lib/diagnostic-session";
import { getPrerequisiteNodeId } from "@/lib/prerequisite-lessons";
import {
  createGenerateRequestRecord,
} from "@/lib/server/generation/request-store";

import { TEST_GRAPH_ID, TEST_USER_ID, baseGraphPayloadFixture } from "../harness/fixtures";

const REQUEST_ID = "graph-diagnostic-request-0001";

function buildStoredGraphDiagnosticResult(): StoredGraphDiagnosticResult {
  return {
    requestId: REQUEST_ID,
    graphId: TEST_GRAPH_ID,
    topic: "probability",
    gapNames: ["basic probability theory"],
    gapPrerequisites: [
      {
        name: "basic probability theory",
        questions: [
          {
            question: "Q1",
            options: ["A", "B", "C", "D"],
            correctIndex: 0,
            explanation: "Because.",
          },
          {
            question: "Q2",
            options: ["A", "B", "C", "D"],
            correctIndex: 1,
            explanation: "Because.",
          },
        ] as const as StoredGraphDiagnosticResult["gapPrerequisites"][number]["questions"],
      },
    ],
    gapPrerequisiteLessons: [],
    completedGapNodeIds: [],
  };
}

describe("graph diagnostic routes", () => {
  it("stores and serves the server-backed graph diagnostic bundle", async () => {
    createGenerateRequestRecord({
      request_id: REQUEST_ID,
      prompt: "learn probability",
      topic: "probability",
      graph_id: TEST_GRAPH_ID,
      status: "ready",
    });

    const storedResult = buildStoredGraphDiagnosticResult();

    const postResponse = await postGraphDiagnostic(
      new Request(`http://localhost/api/graph/status/${REQUEST_ID}/diagnostic`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(storedResult),
      }),
      {
        params: Promise.resolve({ requestId: REQUEST_ID }),
      },
    );

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      graphId: TEST_GRAPH_ID,
      gapNames: ["basic probability theory"],
    });

    const getResponse = await handleGraphDiagnosticRequest(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}/diagnostic`),
      {
        params: Promise.resolve({ id: TEST_GRAPH_ID }),
      },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
      },
    );

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      requestId: REQUEST_ID,
      graphId: TEST_GRAPH_ID,
      gapNames: ["basic probability theory"],
    });
  });

  it("resolves a prerequisite lesson node from the server-backed bundle", async () => {
    createGenerateRequestRecord({
      request_id: "graph-diagnostic-request-0002",
      prompt: "learn probability",
      topic: "probability",
      graph_id: TEST_GRAPH_ID,
      status: "ready",
      graph_diagnostic_result: buildStoredGraphDiagnosticResult(),
    });

    const nodeId = getPrerequisiteNodeId("basic probability theory", 0);
    const response = await getLessonResolver(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}/lesson/${nodeId}`),
      {
        params: Promise.resolve({ id: TEST_GRAPH_ID, nodeId }),
      },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        fetchGraphPayload: async () => baseGraphPayloadFixture,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ready: true,
      source: "prerequisite",
      node: {
        id: nodeId,
        title: "basic probability theory",
        isPrerequisite: true,
      },
      graph_diagnostic_result: {
        graphId: TEST_GRAPH_ID,
      },
    });
  });
});
