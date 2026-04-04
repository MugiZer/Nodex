import { describe, expect, it } from "vitest";

import {
  buildDeterministicVisualArtifact,
  selectVisualFamily,
  selectVisualTemplate,
} from "@/lib/server/generation/visual-templates";

describe("visual templates", () => {
  it("selects explicit concept families for known calculus nodes", () => {
    expect(
      selectVisualFamily({
        subject: "mathematics",
        topic: "calculus_foundations",
        node: { id: "node_1", title: "Functions and graphs", position: 0 },
      }),
    ).toBe("function_graph_basic");

    expect(
      selectVisualFamily({
        subject: "mathematics",
        topic: "calculus_foundations",
        node: { id: "node_2", title: "Limits intuition", position: 1 },
      }),
    ).toBe("function_graph_limits");

    expect(
      selectVisualFamily({
        subject: "mathematics",
        topic: "calculus_foundations",
        node: { id: "node_7", title: "Derivative definition", position: 6 },
      }),
    ).toBe("slope_derivative");

    expect(
      selectVisualFamily({
        subject: "mathematics",
        topic: "calculus_foundations",
        node: { id: "node_10", title: "Chain rule", position: 9 },
      }),
    ).toBe("transform_chain_rule");
  });

  it("falls back cleanly when no family matches", () => {
    const input = {
      subject: "mathematics",
      topic: "calculus_foundations",
      node: { id: "node_x", title: "Unmapped topic", position: 0 },
    };

    expect(selectVisualFamily(input)).toBeNull();
    expect(selectVisualTemplate(input)).toBeNull();
    expect(buildDeterministicVisualArtifact(input)).toEqual({
      id: "node_x",
      p5_code: "",
      visual_verified: false,
    });
  });

  it("does not overmatch broad topic words when the node title is unrelated", () => {
    const input = {
      subject: "mathematics",
      topic: "calculus_foundations",
      node: { id: "node_y", title: "Graph Theory Basics", position: 0 },
    };

    expect(selectVisualFamily(input)).toBeNull();
    expect(selectVisualTemplate(input)).toBeNull();
    expect(buildDeterministicVisualArtifact(input)).toEqual({
      id: "node_y",
      p5_code: "",
      visual_verified: false,
    });
  });

  it("falls back when a known title appears under the wrong topic family", () => {
    const input = {
      subject: "mathematics",
      topic: "trigonometry",
      node: { id: "node_z", title: "Derivative definition", position: 0 },
    };

    expect(selectVisualFamily(input)).toBe("slope_derivative");
    expect(buildDeterministicVisualArtifact(input)).toEqual({
      id: "node_z",
      p5_code: "",
      visual_verified: false,
    });
  });
});
