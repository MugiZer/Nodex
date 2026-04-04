import { describe, expect, it } from "vitest";

import { handleDiagnosticsRequest } from "@/app/api/generate/diagnostics/route";
import { buildDiagnosticsRouteRequest } from "@/lib/server/generation/stage-inputs";

import { DAY2_DIAGNOSTIC_NODES, DAY2_GRAPH_DRAFT, DAY2_LESSON_NODES } from "../harness/day2-generation";

const canonicalContext = {
  subject: "mathematics" as const,
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
};

describe("POST /api/generate/diagnostics", () => {
  it("returns diagnostics-specific node-linkage failures", async () => {
    const response = await handleDiagnosticsRequest(
      new Request("http://localhost/api/generate/diagnostics", {
        method: "POST",
        body: JSON.stringify(
          buildDiagnosticsRouteRequest({
            ...canonicalContext,
            graph: DAY2_GRAPH_DRAFT,
            lessonArtifacts: DAY2_LESSON_NODES,
          }),
        ),
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
            diagnostic_questions: [
              {
                ...diagnosticNode.diagnostic_questions[0],
                node_id: diagnosticNode.id === "node_10" ? "node_999" : diagnosticNode.id,
              },
            ],
          };
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "diagnostics",
      error: {
        code: "DIAGNOSTICS_NODE_MISMATCH",
        category: "artifact_consistency",
        retryable: false,
      },
    });
  });

  it("returns diagnostics schema failures as contract validation errors", async () => {
    const response = await handleDiagnosticsRequest(
      new Request("http://localhost/api/generate/diagnostics", {
        method: "POST",
        body: JSON.stringify(
          buildDiagnosticsRouteRequest({
            ...canonicalContext,
            graph: DAY2_GRAPH_DRAFT,
            lessonArtifacts: DAY2_LESSON_NODES,
          }),
        ),
      }),
      {
        callModel: async ({ userPrompt }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          if (nodeId === "") {
            throw new Error(`Unexpected diagnostic node prompt: ${userPrompt}`);
          }

          return {
            id: nodeId,
            diagnostic_questions: [],
          } as never;
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "diagnostics",
      error: {
        code: "DIAGNOSTICS_SCHEMA_INVALID",
        category: "contract_validation",
        retryable: true,
      },
    });
  });
});
