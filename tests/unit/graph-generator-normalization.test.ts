import { describe, expect, it } from "vitest";

import { runGraphGenerator } from "@/lib/server/generation/stages/graph-pipeline";

import { DAY2_GRAPH_DRAFT } from "../harness/day2-generation";

describe("graph generator normalization", () => {
  it("deduplicates edges, prunes redundant hard edges, and recomputes positions", async () => {
    const response = await runGraphGenerator(
      {
        subject: "mathematics",
        topic: "trigonometry",
        description:
          "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
      },
      undefined,
      {
        callModel: async () => ({
          nodes: DAY2_GRAPH_DRAFT.nodes.map((node, index) => ({
            ...node,
            position: DAY2_GRAPH_DRAFT.nodes.length - index,
          })),
          edges: [
            ...DAY2_GRAPH_DRAFT.edges,
            DAY2_GRAPH_DRAFT.edges[0]!,
            {
              from_node_id: "node_2",
              to_node_id: "node_8",
              type: "hard" as const,
            },
          ],
        }),
      },
    );

    expect(response.edges).toHaveLength(DAY2_GRAPH_DRAFT.edges.length);
    expect(
      response.edges.filter(
        (edge) => edge.from_node_id === "node_2" && edge.to_node_id === "node_8",
      ),
    ).toHaveLength(0);

    const positions = new Map(response.nodes.map((node) => [node.id, node.position]));
    for (const edge of response.edges.filter((entry) => entry.type === "hard")) {
      expect((positions.get(edge.from_node_id) ?? -1)).toBeLessThan(
        positions.get(edge.to_node_id) ?? -1,
      );
    }
  });

  it("accepts small four-node graphs for narrow concepts", async () => {
    const response = await runGraphGenerator(
      {
        subject: "mathematics",
        topic: "bayes_theorem",
        description:
          "Bayes theorem is the study of conditional probability updates from prior beliefs to posterior beliefs. It encompasses priors, likelihoods, posteriors, and evidence. It assumes prior knowledge of probability, fractions, and basic algebra and serves as a foundation for statistics, machine learning, and inference. Within mathematics, it is typically encountered at the intermediate level.",
      },
      undefined,
      {
        callModel: async () => ({
          nodes: [
            { id: "node_1", title: "Prior Probability", position: 0 },
            { id: "node_2", title: "Likelihood", position: 1 },
            { id: "node_3", title: "Posterior Update", position: 2 },
            { id: "node_4", title: "Inference Decision", position: 3 },
          ],
          edges: [
            { from_node_id: "node_1", to_node_id: "node_2", type: "hard" as const },
            { from_node_id: "node_2", to_node_id: "node_3", type: "hard" as const },
            { from_node_id: "node_3", to_node_id: "node_4", type: "hard" as const },
          ],
        }),
      },
    );

    expect(response.nodes).toHaveLength(4);
    expect(response.edges).toHaveLength(3);
    expect(response.nodes[0]?.position).toBe(0);
    expect(response.nodes[3]?.position).toBe(3);
  });
});
