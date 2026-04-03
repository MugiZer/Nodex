import { describe, expect, it } from "vitest";

import { handleDiagnosticsRequest } from "@/app/api/generate/diagnostics/route";
import { handleLessonsRequest } from "@/app/api/generate/lessons/route";
import { handleVisualsRequest } from "@/app/api/generate/visuals/route";

import {
  DAY2_DIAGNOSTIC_NODES,
  DAY2_GRAPH_DRAFT,
  DAY2_LESSON_NODES,
  DAY2_VISUAL_FALLBACK_NODES,
} from "../harness/day2-generation";

const canonicalContext = {
  subject: "mathematics" as const,
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
};

describe("POST /api/generate/visuals", () => {
  it("runs lessons, diagnostics, then visuals using the real route handoff", async () => {
    const lessonsResponse = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          const lessonNode = DAY2_LESSON_NODES.find((node) => node.id === nodeId);
          if (!lessonNode) {
            throw new Error(`Unexpected lesson node prompt: ${userPrompt}`);
          }

          return {
            id: lessonNode.id,
            lesson_text: lessonNode.lesson_text,
            static_diagram: lessonNode.static_diagram,
            quiz_json: lessonNode.quiz_json,
          };
        },
      },
    );

    expect(lessonsResponse.status).toBe(200);
    const lessonsJson = (await lessonsResponse.json()) as {
      ok: boolean;
      data: { nodes: typeof DAY2_LESSON_NODES };
    };
    expect(lessonsJson.ok).toBe(true);

    const diagnosticsResponse = await handleDiagnosticsRequest(
      new Request("http://localhost/api/generate/diagnostics", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          const diagnosticNode = DAY2_DIAGNOSTIC_NODES.find((node) => node.id === nodeId);
          if (!diagnosticNode) {
            throw new Error(`Unexpected diagnostic node prompt: ${userPrompt}`);
          }

          return {
            id: diagnosticNode.id,
            diagnostic_questions: diagnosticNode.diagnostic_questions,
          };
        },
      },
    );

    expect(diagnosticsResponse.status).toBe(200);
    const diagnosticsJson = (await diagnosticsResponse.json()) as {
      ok: boolean;
      data: { nodes: typeof DAY2_DIAGNOSTIC_NODES };
    };
    expect(diagnosticsJson.ok).toBe(true);

    const visualsResponse = await handleVisualsRequest(
      new Request("http://localhost/api/generate/visuals", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          const visualNode = DAY2_VISUAL_FALLBACK_NODES.find((node) => node.id === nodeId);
          if (!visualNode) {
            throw new Error(`Unexpected visual node prompt: ${userPrompt}`);
          }

          return {
            id: visualNode.id,
            p5_code: visualNode.p5_code,
            visual_verified: visualNode.visual_verified,
          };
        },
      },
    );

    expect(visualsResponse.status).toBe(200);
    await expect(visualsResponse.json()).resolves.toMatchObject({
      ok: true,
      stage: "visuals",
      error: null,
    });
  });

  it("rejects diagnostics-shaped nodes before visuals runs", async () => {
    const response = await handleVisualsRequest(
      new Request("http://localhost/api/generate/visuals", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_DIAGNOSTIC_NODES.map(({ id, diagnostic_questions }) => ({
            id,
            diagnostic_questions,
          })),
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_REQUEST_BODY",
      message: "Expected body with subject, topic, description, and nodes for visuals.",
      details: {
        fieldErrors: {
          nodes: expect.arrayContaining([
            expect.stringContaining("expected string"),
            expect.stringContaining("expected number"),
          ]),
        },
      },
    });
  });

  it("records fallback activation as a warning instead of a hard failure", async () => {
    const response = await handleVisualsRequest(
      new Request("http://localhost/api/generate/visuals", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          const visualNode = DAY2_VISUAL_FALLBACK_NODES.find((node) => node.id === nodeId);
          if (!visualNode) {
            throw new Error(`Unexpected visual node prompt: ${userPrompt}`);
          }

          return {
            id: visualNode.id,
            p5_code: visualNode.p5_code,
            visual_verified: visualNode.visual_verified,
          };
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stage: "visuals",
      warnings: [
        expect.objectContaining({
          code: "VISUALS_FALLBACK_ACTIVATED",
          category: "fallback_activated",
        }),
      ],
      error: null,
    });
  });

  it("returns node mismatches when the visual bundle coverage is inconsistent", async () => {
    const response = await handleVisualsRequest(
      new Request("http://localhost/api/generate/visuals", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          const visualNode = DAY2_VISUAL_FALLBACK_NODES.find((node) => node.id === nodeId);
          if (!visualNode) {
            throw new Error(`Unexpected visual node prompt: ${userPrompt}`);
          }

          return {
            id: nodeId === "node_1" ? "node_999" : visualNode.id,
            p5_code: visualNode.p5_code,
            visual_verified: visualNode.visual_verified,
          };
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "visuals",
      error: {
        code: "VISUALS_NODE_MISMATCH",
        category: "artifact_consistency",
        retryable: false,
      },
    });
  });
});
