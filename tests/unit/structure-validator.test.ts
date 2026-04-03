import { describe, expect, it } from "vitest";

import {
  assertCanonicalBoundaryInvariants,
  runStructureValidator,
} from "@/lib/server/generation/stages/graph-pipeline";

import { DAY2_GRAPH_DRAFT } from "../harness/day2-generation";

describe("deterministic structure validator", () => {
  it("skips canonical boundary checks when structured boundaries are absent", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [{ id: "node_1", title: "Arithmetic Basics", position: 0 }],
        undefined,
      ),
    ).not.toThrow();
  });

  it("rejects graph nodes that match structured prerequisite boundaries", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [
          { id: "node_1", title: "Arithmetic Basics", position: 0 },
          { id: "node_2", title: "Linear Equations", position: 1 },
        ],
        {
          prerequisites: ["arithmetic"],
          downstream_topics: ["calculus", "physics", "statistics"],
        },
      ),
    ).toThrow(/prior knowledge/);
  });

  it("does not reject a fuzzy trig title that only overlaps on a generic boundary phrase", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [
          {
            id: "node_1",
            title: "Sine and Cosine Functions Defined on the Unit Circle",
            position: 1,
          },
        ],
        {
          prerequisites: ["functions and their graphs"],
          downstream_topics: ["calculus", "physics", "statistics"],
        },
      ),
    ).not.toThrow();
  });

  it("does not reject broad category overlap for tangent and reciprocal graphing content", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [
          {
            id: "node_1",
            title: "Graphs of Tangent and Reciprocal Functions",
            position: 1,
          },
        ],
        {
          prerequisites: ["functions and their graphs"],
          downstream_topics: ["calculus", "physics", "statistics"],
        },
      ),
    ).not.toThrow();
  });

  it("ignores generic container tokens that do not identify a specific prerequisite", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [
          {
            id: "node_1",
            title: "Graphs of Tangent and Reciprocal Functions",
            position: 1,
          },
        ],
        {
          prerequisites: ["functions", "graphs"],
          downstream_topics: ["calculus", "physics", "statistics"],
        },
      ),
    ).not.toThrow();
  });

  it("still rejects exact normalized phrase containment for multi-word prerequisites", () => {
    expect(() =>
      assertCanonicalBoundaryInvariants(
        [
          {
            id: "node_1",
            title: "Unit Circle Basics",
            position: 0,
          },
        ],
        {
          prerequisites: ["unit circle"],
          downstream_topics: ["calculus", "physics", "statistics"],
        },
      ),
    ).toThrow(/prior knowledge/);
  });

  it("returns a valid result without a model dependency for structurally sound graphs", async () => {
    const result = await runStructureValidator({
      subject: "mathematics",
      topic: "trigonometry",
      description:
        "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
      nodes: DAY2_GRAPH_DRAFT.nodes,
      edges: DAY2_GRAPH_DRAFT.edges,
    });

    expect(result).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("flags redundant hard edges deterministically", async () => {
    const result = await runStructureValidator({
      subject: "mathematics",
      topic: "trigonometry",
      description:
        "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
      nodes: DAY2_GRAPH_DRAFT.nodes,
      edges: [
        ...DAY2_GRAPH_DRAFT.edges,
        {
          from_node_id: "node_2",
          to_node_id: "node_8",
          type: "hard",
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "redundant_edge",
          severity: "minor",
          nodes_involved: ["node_2", "node_8"],
        }),
      ]),
    );
  });

  it("flags a likely missing hard edge when an immediate predecessor is only soft-linked", async () => {
    const result = await runStructureValidator({
      subject: "mathematics",
      topic: "trigonometry",
      description:
        "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
      nodes: DAY2_GRAPH_DRAFT.nodes.map((node) =>
        node.id === "node_8"
          ? {
              ...node,
              position: 2,
            }
          : node,
      ),
      edges: DAY2_GRAPH_DRAFT.edges.map((edge) =>
        edge.from_node_id === "node_9" && edge.to_node_id === "node_10"
          ? {
              ...edge,
              type: "soft" as const,
            }
          : edge,
      ),
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "missing_hard_edge",
          nodes_involved: ["node_9", "node_10"],
        }),
      ]),
    );
  });

  it("flags over-constraining hard fan-in as edge misclassification", async () => {
    const result = await runStructureValidator({
      subject: "mathematics",
      topic: "algebra",
      description:
        "Algebra is the study of symbols and the rules for manipulating them. It encompasses expressions, equations, functions, inequalities, and factoring. It assumes prior knowledge of arithmetic and serves as a foundation for calculus, discrete mathematics, and physics. Within mathematics, it is typically encountered at the introductory level.",
      nodes: [
        { id: "node_1", title: "Variables", position: 0 },
        { id: "node_2", title: "Expressions", position: 0 },
        { id: "node_3", title: "Equations", position: 0 },
        { id: "node_4", title: "Word Problems", position: 1 },
      ],
      edges: [
        { from_node_id: "node_1", to_node_id: "node_4", type: "hard" },
        { from_node_id: "node_2", to_node_id: "node_4", type: "hard" },
        { from_node_id: "node_3", to_node_id: "node_4", type: "hard" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "edge_misclassification",
          nodes_involved: expect.arrayContaining(["node_4", "node_1", "node_2", "node_3"]),
        }),
      ]),
    );
  });

  it("flags capstones that rely on immediate prior concepts only through soft context", async () => {
    const result = await runStructureValidator({
      subject: "mathematics",
      topic: "algebra",
      description:
        "Algebra is the study of symbols and the rules for manipulating them. It encompasses expressions, equations, functions, inequalities, and factoring. It assumes prior knowledge of arithmetic and serves as a foundation for calculus, discrete mathematics, and physics. Within mathematics, it is typically encountered at the introductory level.",
      nodes: [
        { id: "node_1", title: "Variables", position: 0 },
        { id: "node_2", title: "Expressions", position: 1 },
        { id: "node_3", title: "Equation Solving", position: 2 },
      ],
      edges: [
        { from_node_id: "node_1", to_node_id: "node_2", type: "hard" },
        { from_node_id: "node_1", to_node_id: "node_3", type: "hard" },
        { from_node_id: "node_2", to_node_id: "node_3", type: "soft" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "edge_misclassification",
          nodes_involved: expect.arrayContaining(["node_1", "node_2", "node_3"]),
        }),
      ]),
    );
  });
});
