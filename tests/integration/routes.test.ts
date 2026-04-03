import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { graphPayloadSchema, progressWriteResponseSchema } from "@/lib/schemas";
import type {
  GraphPayload,
  ProgressWriteRequest,
  ProgressWriteResponse,
} from "@/lib/types";
import { baseGraphPayloadFixture, TEST_USER_ID } from "../harness/fixtures";

const { canonicalizePromptMock, retrieveGraphIdMock } = vi.hoisted(() => ({
  canonicalizePromptMock: vi.fn(),
  retrieveGraphIdMock: vi.fn(),
}));

vi.mock("@/lib/server/canonicalize", () => ({
  canonicalizePrompt: canonicalizePromptMock,
}));

vi.mock("@/lib/server/retrieve", () => ({
  retrieveGraphId: retrieveGraphIdMock,
}));

import { POST as canonicalizePOST } from "@/app/api/generate/canonicalize/route";
import { POST as retrievePOST } from "@/app/api/generate/retrieve/route";
import {
  handleGraphReadRequest,
} from "@/app/api/graph/[id]/route";
import {
  handleGraphCurriculumAuditReadRequest,
} from "@/app/api/generate/graph/audit/route";
import {
  handleProgressWriteRequest,
} from "@/app/api/progress/route";

const canonicalizeSuccessBody = {
  subject: "mathematics",
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
};

describe("Round 2 route integration", () => {
  beforeEach(() => {
    canonicalizePromptMock.mockReset();
    retrieveGraphIdMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("canonicalizes a prompt and returns the expected success shape", async () => {
    canonicalizePromptMock.mockResolvedValue(canonicalizeSuccessBody);

    const response = await canonicalizePOST(
      new Request("http://localhost/api/generate/canonicalize", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(canonicalizeSuccessBody);
    expect(canonicalizePromptMock).toHaveBeenCalledTimes(1);
    expect(canonicalizePromptMock.mock.calls[0]?.[0]).toBe("I want to learn trigonometry");
    expect(canonicalizePromptMock.mock.calls[0]?.[1]).toMatchObject({
      requestId: expect.any(String),
      route: "POST /api/generate/canonicalize",
    });
  });

  it("returns the non-learning canonicalize failure shape", async () => {
    canonicalizePromptMock.mockResolvedValue({ error: "NOT_A_LEARNING_REQUEST" });

    const response = await canonicalizePOST(
      new Request("http://localhost/api/generate/canonicalize", {
        method: "POST",
        body: JSON.stringify({ prompt: "Tell me a joke" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ error: "NOT_A_LEARNING_REQUEST" });
  });

  it("returns cached and miss retrieval responses", async () => {
    retrieveGraphIdMock.mockResolvedValueOnce({ graph_id: "77777777-7777-4777-8777-777777777777" });
    retrieveGraphIdMock.mockResolvedValueOnce({ graph_id: null });

    const hitResponse = await retrievePOST(
      new Request("http://localhost/api/generate/retrieve", {
        method: "POST",
        body: JSON.stringify({
          subject: "mathematics",
          description: canonicalizeSuccessBody.description,
        }),
      }),
    );

    const missResponse = await retrievePOST(
      new Request("http://localhost/api/generate/retrieve", {
        method: "POST",
        body: JSON.stringify({
          subject: "physics",
          description:
            "Mechanics is the study of motion and forces. It encompasses kinematics, dynamics, work, energy, momentum, and rotational motion. It assumes prior knowledge of algebra and geometry and serves as a foundation for thermodynamics and relativity. Within physics, it is typically encountered at the introductory level.",
        }),
      }),
    );

    expect(hitResponse.status).toBe(200);
    expect(await hitResponse.json()).toEqual({
      graph_id: "77777777-7777-4777-8777-777777777777",
    });
    expect(missResponse.status).toBe(200);
    expect(await missResponse.json()).toEqual({ graph_id: null });
  });

  it("returns a graph payload and filters progress to the authenticated learner", async () => {
    const payload: GraphPayload = baseGraphPayloadFixture;
    const response = await handleGraphReadRequest(
      new Request("http://localhost/api/graph/22222222-2222-4222-8222-222222222222"),
      { params: Promise.resolve({ id: payload.graph.id }) },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        fetchGraphPayload: async () => payload,
      },
    );

    expect(response.status).toBe(200);
    expect(graphPayloadSchema.parse(await response.json())).toEqual(payload);
  });

  it("returns a persisted curriculum audit record by request id", async () => {
    const response = await handleGraphCurriculumAuditReadRequest(
      new Request("http://localhost/api/generate/graph/audit?request_id=day2-success-trace"),
      {
        curriculumAuditDependencies: {
          fetchAuditResult: async () => ({
            request_id: "day2-success-trace",
            request_fingerprint: "fingerprint-1",
            subject: "mathematics",
            topic: "trigonometry",
            audit_status: "accepted",
            outcome_bucket: "accepted_clean",
            attempt_count: 1,
            failure_category: null,
            parse_error_summary: null,
            duration_ms: 1234,
            issue_count: 0,
            async_audit: true,
            created_at: "2026-04-01T12:00:00.000Z",
            updated_at: "2026-04-01T12:00:01.000Z",
          }),
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request_id: "day2-success-trace",
      audit: {
        request_id: "day2-success-trace",
        audit_status: "accepted",
        outcome_bucket: "accepted_clean",
      },
    });
  });

  it("applies progress pass/fail semantics and unlock updates", async () => {
    const graphPayload: GraphPayload = JSON.parse(JSON.stringify(baseGraphPayloadFixture)) as GraphPayload;
    const nodeId = graphPayload.nodes[1]?.id;
    if (!nodeId) {
      throw new Error("Fixture graph is missing the second node.");
    }

    const passResponse = await handleProgressWriteRequest(
      new Request("http://localhost/api/progress", {
        method: "POST",
        body: JSON.stringify({
          graph_id: graphPayload.graph.id,
          node_id: nodeId,
          score: 2,
          timestamp: "2026-04-01T12:20:00.000Z",
        }),
      }),
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        recordProgressAttempt: async (
          input: ProgressWriteRequest,
          userId: string,
        ): Promise<ProgressWriteResponse> => ({
          progress: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            user_id: userId,
            node_id: input.node_id,
            graph_version: 1,
            completed: true,
            attempts: [{ score: input.score, timestamp: input.timestamp ?? "2026-04-01T12:20:00.000Z" }],
          },
          available_node_ids: [graphPayload.nodes[0].id, graphPayload.nodes[1].id, graphPayload.nodes[2].id],
          flagged_for_review: false,
        }),
      },
    );

    expect(passResponse.status).toBe(200);
    expect(progressWriteResponseSchema.parse(await passResponse.json())).toMatchObject({
      progress: {
        node_id: nodeId,
        completed: true,
      },
      available_node_ids: expect.arrayContaining([graphPayload.nodes[2].id]),
    });

    const failResponse = await handleProgressWriteRequest(
      new Request("http://localhost/api/progress", {
        method: "POST",
        body: JSON.stringify({
          graph_id: graphPayload.graph.id,
          node_id: nodeId,
          score: 1,
          timestamp: "2026-04-01T12:21:00.000Z",
        }),
      }),
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        recordProgressAttempt: async (
          input: ProgressWriteRequest,
          userId: string,
        ): Promise<ProgressWriteResponse> => ({
          progress: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            user_id: userId,
            node_id: input.node_id,
            graph_version: 1,
            completed: true,
            attempts: [
              { score: 2, timestamp: "2026-04-01T12:20:00.000Z" },
              { score: input.score, timestamp: input.timestamp ?? "2026-04-01T12:21:00.000Z" },
            ],
          },
          available_node_ids: [graphPayload.nodes[0].id, graphPayload.nodes[1].id, graphPayload.nodes[2].id],
          flagged_for_review: false,
        }),
      },
    );

    expect(failResponse.status).toBe(200);
    expect(progressWriteResponseSchema.parse(await failResponse.json())).toMatchObject({
      progress: {
        node_id: nodeId,
        completed: true,
      },
      available_node_ids: expect.arrayContaining([graphPayload.nodes[2].id]),
    });
  });
});
