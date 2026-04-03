import { describe, expect, it } from "vitest";

import { handleLessonsRequest } from "@/app/api/generate/lessons/route";
import { ApiError } from "@/lib/errors";

import { DAY2_GRAPH_DRAFT, DAY2_LESSON_NODES } from "../harness/day2-generation";

const canonicalContext = {
  subject: "mathematics" as const,
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
};

function createLessonArtifactForNode(nodeId: string) {
  const lessonNode = DAY2_LESSON_NODES.find((node) => node.id === nodeId);
  if (!lessonNode) {
    throw new Error(`Missing fixture lesson node for ${nodeId}`);
  }

  return {
    id: lessonNode.id,
    lesson_text: lessonNode.lesson_text,
    static_diagram: lessonNode.static_diagram,
    quiz_json: lessonNode.quiz_json,
  };
}

function createTwentyFiveNodeGraph() {
  const nodes = Array.from({ length: 25 }, (_, index) => ({
    id: `node_${index + 1}`,
    title: `Topic ${index + 1}`,
    position: index,
  }));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from_node_id: node.id,
    to_node_id: nodes[index + 1]!.id,
    type: "hard" as const,
  }));

  return { nodes, edges };
}

describe("POST /api/generate/lessons", () => {
  it("returns a typed stage envelope on success using bounded per-node generation", async () => {
    let calls = 0;
    const response = await handleLessonsRequest(
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
          calls += 1;
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          return createLessonArtifactForNode(nodeId);
        },
      },
    );

    expect(calls).toBe(DAY2_GRAPH_DRAFT.nodes.length);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stage: "lessons",
      data: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "node_1" }),
        ]),
      },
      warnings: [],
      error: null,
    });
  });

  it("surfaces Anthropic SDK preflight failures as provider errors", async () => {
    const response = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async () => {
          throw new ApiError(
            "UPSTREAM_PROVIDER",
            "Streaming is required for operations that may take longer than 10 minutes.",
            502,
            {
              provider: "anthropic",
              subtype: "sdk_preflight_streaming_required",
              retryable: false,
            },
          );
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "lessons",
      error: {
        code: "LESSONS_PROVIDER_ERROR",
        category: "upstream_provider",
        retryable: false,
        details: expect.objectContaining({
          provider: "anthropic",
          subtype: "sdk_preflight_streaming_required",
        }),
      },
    });
  });

  it("surfaces parse failures as parse errors", async () => {
    const response = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async () => null as never,
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "lessons",
      error: {
        code: "LESSONS_PARSE_FAILURE",
        category: "parse_failure",
        retryable: true,
      },
    });
  });

  it("surfaces Anthropic structured-output JSON parse failures as parse errors", async () => {
    const response = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async () => {
          throw new Error(
            "Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 4388 (line 1 column 4389)",
          );
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "lessons",
      error: {
        code: "LESSONS_PARSE_FAILURE",
        category: "parse_failure",
        retryable: true,
        details: expect.objectContaining({
          provider: "anthropic",
          parse_subtype: "unterminated_string",
          node_count: DAY2_GRAPH_DRAFT.nodes.length,
          edge_count: DAY2_GRAPH_DRAFT.edges.length,
        }),
      },
    });
  });

  it("surfaces schema mismatches as schema errors", async () => {
    const response = await handleLessonsRequest(
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
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "node_1";
          return {
            id: nodeId,
            lesson_text: "Lesson text",
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
          } as never;
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "lessons",
      error: {
        code: "LESSONS_SCHEMA_INVALID",
        category: "contract_validation",
        retryable: true,
      },
    });
  });

  it("surfaces timeouts as timeout errors", async () => {
    const response = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        }),
      }),
      {
        callModel: async () => {
          throw new ApiError("UPSTREAM_TIMEOUT", "lessons timed out after 24000ms.", 504);
        },
      },
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "lessons",
      error: {
        code: "LESSONS_TIMEOUT",
        category: "upstream_timeout",
        retryable: true,
      },
    });
  });

  it("handles realistic 25-node lesson generation through bounded subcalls", async () => {
    const largeGraph = createTwentyFiveNodeGraph();
    let calls = 0;

    const response = await handleLessonsRequest(
      new Request("http://localhost/api/generate/lessons", {
        method: "POST",
        body: JSON.stringify({
          ...canonicalContext,
          topic: "calculus_foundations",
          description:
            "Calculus Foundations is the study of change and accumulation. It encompasses limits, derivatives, integrals, rates of change, and approximation. It assumes prior knowledge of algebra, functions, and graph interpretation and serves as a foundation for differential equations, multivariable calculus, optimization, and mathematical modeling. Within mathematics, it is typically encountered at the introductory level.",
          nodes: largeGraph.nodes,
          edges: largeGraph.edges,
        }),
      }),
      {
        callModel: async ({ userPrompt }) => {
          calls += 1;
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
          return {
            id: nodeId,
            lesson_text: `Lesson for ${nodeId}`,
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            quiz_json: [
              {
                question: `Question 1 for ${nodeId}`,
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "Explanation 1",
              },
              {
                question: `Question 2 for ${nodeId}`,
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "Explanation 2",
              },
              {
                question: `Question 3 for ${nodeId}`,
                options: ["A", "B", "C", "D"],
                correct_index: 2,
                explanation: "Explanation 3",
              },
            ],
          };
        },
      },
    );

    expect(calls).toBe(25);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stage: "lessons",
      data: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "node_1" }),
          expect.objectContaining({ id: "node_25" }),
        ]),
      },
    });
  });
});
