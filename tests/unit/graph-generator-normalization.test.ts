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
});
