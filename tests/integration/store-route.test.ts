import { describe, expect, it, vi } from "vitest";

import { handleStoreRequest } from "@/app/api/generate/store/route";

import { DAY2_GRAPH_DRAFT, DAY2_VISUAL_NODES } from "../harness/day2-generation";

const graphId = "99999999-9999-4999-8999-999999999999";

function createGraphVersionSelectBuilder(version = 0) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({
        data: version > 0 ? [{ version }] : [],
        error: null,
      });
    },
  };

  return builder;
}

function createStoreClient() {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ graph_id: graphId }],
    error: null,
  });

  return {
    client: {
      from(table: string) {
        if (table === "graphs") {
          return createGraphVersionSelectBuilder();
        }

        throw new Error(`Unexpected table access: ${table}`);
      },
      rpc,
    },
    rpc,
  };
}

const storeRequestBody = {
  graph: {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Trigonometry",
    subject: "mathematics" as const,
    topic: "trigonometry",
    description:
      "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
    version: 1,
    flagged_for_review: false,
    created_at: "2026-04-01T12:00:00.000Z",
  },
  nodes: DAY2_VISUAL_NODES.map((node) => ({
    id: node.id,
    title: node.title,
    position: node.position,
    lesson_text: node.lesson_text,
    static_diagram: node.static_diagram,
    p5_code: node.p5_code,
    visual_verified: node.visual_verified,
    quiz_json: node.quiz_json,
    diagnostic_questions: node.diagnostic_questions,
    lesson_status: node.lesson_status,
  })),
  edges: DAY2_GRAPH_DRAFT.edges,
};

describe("POST /api/generate/store", () => {
  it("returns a typed stage envelope on success", async () => {
    const store = createStoreClient();
    const response = await handleStoreRequest(
      new Request("http://localhost/api/generate/store", {
        method: "POST",
        body: JSON.stringify(storeRequestBody),
      }),
      {
        precomputedEmbedding: new Array(1536).fill(0),
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stage: "store",
      data: {
        graph_id: graphId,
        write_mode: "persisted",
        persisted_node_count: 10,
        persisted_edge_count: DAY2_GRAPH_DRAFT.edges.length,
      },
      error: null,
    });
  });

  it("surfaces remap failures without attempting persistence", async () => {
    const store = createStoreClient();
    const response = await handleStoreRequest(
      new Request("http://localhost/api/generate/store", {
        method: "POST",
        body: JSON.stringify({
          ...storeRequestBody,
          nodes: storeRequestBody.nodes.map((node) =>
            node.id === "node_10"
              ? {
                  ...node,
                  diagnostic_questions: [
                    {
                      ...node.diagnostic_questions[0],
                      node_id: "node_999",
                    },
                  ],
                }
              : node,
          ),
        }),
      }),
      {
        precomputedEmbedding: new Array(1536).fill(0),
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      stage: "store",
      error: {
        code: "STORE_NODE_REMAP_FAILED",
        category: "id_remap_failure",
        retryable: false,
      },
    });
    expect(store.rpc).not.toHaveBeenCalled();
  });
});
