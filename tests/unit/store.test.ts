import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { storeGeneratedGraph } from "@/lib/server/generation/store";
import { validateCanonicalDescription } from "@/lib/schemas";

const graphId = "22222222-2222-4222-8222-222222222222";
const nodeIdA = "33333333-3333-4333-8333-333333333333";
const nodeIdB = "44444444-4444-4444-8444-444444444444";

const baseGraph = {
  title: "Sample Graph",
  subject: "mathematics" as const,
  topic: "sample_topic",
  description:
    "Sample Topic is the study of a sample learning boundary. It encompasses foundations, applications, representations, and practice. It assumes prior knowledge of algebra and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the introductory level.",
};

function createQuizItem(index: number) {
  return {
    question: `Question ${index}`,
    options: ["A", "B", "C", "D"] as [string, string, string, string],
    correct_index: index % 4,
    explanation: `Explanation ${index}`,
  };
}

function createNode(index: number, verified = false): {
  id: string;
  title: string;
  position: number;
  lesson_text: string;
  static_diagram: string;
  p5_code: string;
  visual_verified: boolean;
  quiz_json: Array<{
    question: string;
    options: [string, string, string, string];
    correct_index: number;
    explanation: string;
  }>;
  diagnostic_questions: Array<{
    question: string;
    options: [string, string, string, string];
    correct_index: number;
    difficulty_order: number;
    node_id: string;
  }>;
  lesson_status: "ready";
} {
  const id = `node_${index}`;
  return {
    id,
    title: `Node ${index}`,
    position: index - 1,
    lesson_text: `Node ${index} lesson text.`,
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    p5_code: verified
      ? "function setup() { createCanvas(480, 320); } function draw() {}"
      : "",
    visual_verified: verified,
    quiz_json: [1, 2, 3].map((questionIndex) => createQuizItem(index + questionIndex - 1)),
    diagnostic_questions: [
      {
        question: `Diag ${index}`,
        options: ["A", "B", "C", "D"] as [string, string, string, string],
        correct_index: index % 4,
        difficulty_order: index,
        node_id: id,
      },
    ],
    lesson_status: "ready",
  };
}

function buildTestGraphNodes(): Array<ReturnType<typeof createNode>> {
  return [
    createNode(1, false),
    createNode(2, true),
    createNode(3, false),
    createNode(4, false),
    createNode(5, false),
    createNode(6, false),
    createNode(7, false),
    createNode(8, false),
    createNode(9, false),
    createNode(10, false),
  ];
}

function buildTestGraphEdges() {
  return Array.from({ length: 9 }, (_, index) => ({
    from_node_id: `node_${index + 1}`,
    to_node_id: `node_${index + 2}`,
    type: "hard" as const,
  }));
}

describe("store helpers", () => {
  it("remaps temp ids into persisted UUIDs and rewrites embedded node refs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ graph_id: graphId }],
      error: null,
    });
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const nodes = buildTestGraphNodes();
    const createUuid = vi
      .fn()
      .mockImplementation(() => randomUUID())
      .mockReturnValueOnce(graphId)
      .mockReturnValueOnce(nodeIdA)
      .mockReturnValueOnce(nodeIdB);

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes,
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        searchRetrievalCandidates: async () => [],
        createUuid,
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
    });

    const rpcArgs = rpc.mock.calls[0]?.[1] as {
      p_graph: { id: string };
      p_nodes: Array<{ id: string; diagnostic_questions: Array<{ node_id: string }> }>;
      p_edges: Array<{ from_node_id: string; to_node_id: string }>;
    };

    expect(validateCanonicalDescription(baseGraph.description)).toBe(true);
    expect(rpcArgs.p_graph.id).toBe(graphId);
    expect(rpcArgs.p_nodes).toHaveLength(10);
    expect(rpcArgs.p_nodes[0]?.id).not.toBe("node_1");
    expect(rpcArgs.p_nodes[1]?.id).not.toBe("node_2");
    expect(rpcArgs.p_nodes[0]?.diagnostic_questions[0]?.node_id).toBe(rpcArgs.p_nodes[0]?.id);
    expect(rpcArgs.p_nodes[1]?.diagnostic_questions[0]?.node_id).toBe(rpcArgs.p_nodes[1]?.id);
    expect(rpcArgs.p_edges[0]?.from_node_id).toBe(rpcArgs.p_nodes[0]?.id);
    expect(rpcArgs.p_edges[0]?.to_node_id).toBe(rpcArgs.p_nodes[1]?.id);
  });

  it("does not short-circuit when only flagged duplicates exist", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ graph_id: graphId }],
      error: null,
    });
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        searchRetrievalCandidates: async () => [
          {
            id: graphId,
            similarity: 0.91,
            flagged_for_review: true,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects restricted p5 code before persistence", async () => {
    const rpc = vi.fn();
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const nodes = buildTestGraphNodes();
    nodes[1] = {
      ...nodes[1],
      visual_verified: true,
      p5_code:
        "function setup() { createCanvas(480, 320); fetch('https://example.com'); } function draw() {}",
    };

    await expect(
      storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes,
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) =>
            index === 0 ? 1 : 0,
          ),
          searchRetrievalCandidates: async () => [],
          createServiceClient: () => serviceClient as never,
        },
      ),
    ).rejects.toThrow(/restricted snippets/i);

    expect(rpc).not.toHaveBeenCalled();
  });
});
