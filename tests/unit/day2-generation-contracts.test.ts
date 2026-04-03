import { describe, expect, it } from "vitest";

import { diagnosticQuestionSchema } from "@/lib/schemas";

import {
  DAY2_DIAGNOSTIC_NODES,
  DAY2_GRAPH_DRAFT,
  DAY2_PARTIAL_FAILURE_TRACE,
  DAY2_SUCCESS_TRACE,
  DAY2_VISUAL_FALLBACK_NODES,
  DAY2_VISUAL_NODES,
  replayDay2Trace,
  selectNodeVisualArtifact,
  validateDay2DiagnosticBundle,
  validateDay2GraphDraft,
  validateDay2VisualBundle,
} from "../harness/day2-generation";

describe("day 2 generation contracts", () => {
  it("keeps the graph draft structurally valid for downstream validation", () => {
    expect(() => validateDay2GraphDraft(DAY2_GRAPH_DRAFT)).not.toThrow();
  });

  it("keeps diagnostic coverage at one question per node with stable node ids", () => {
    const diagnosticsStep = DAY2_SUCCESS_TRACE.steps.find(
      (step) => step.stage === "diagnostics",
    );

    if (!diagnosticsStep || !("nodes" in (diagnosticsStep.output as Record<string, unknown>))) {
      throw new Error("Missing diagnostics fixture.");
    }

    const diagnosticsBundle = diagnosticsStep.output as { nodes: typeof DAY2_DIAGNOSTIC_NODES };
    validateDay2DiagnosticBundle(diagnosticsBundle);

    expect(diagnosticsBundle.nodes).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    diagnosticsBundle.nodes.forEach((node, index) => {
      expect(node.diagnostic_questions).toHaveLength(1);
      const [question] = node.diagnostic_questions;
      expect(diagnosticQuestionSchema.parse(question)).toEqual(question);
      expect(question.node_id).toBe(node.id);
      expect(question.difficulty_order).toBe(index + 1);
    });
  });

  it("renders static fallback diagrams when visuals are unverified", () => {
    expect(() =>
      validateDay2VisualBundle({ nodes: DAY2_VISUAL_FALLBACK_NODES }),
    ).not.toThrow();

    for (const node of DAY2_VISUAL_FALLBACK_NODES) {
      const artifact = selectNodeVisualArtifact(node);
      expect(artifact.kind).toBe("static");
      expect(artifact.content).toBe(node.static_diagram);
    }
  });

  it("keeps verified p5 sketches executable by contract", () => {
    expect(() => validateDay2VisualBundle({ nodes: DAY2_VISUAL_NODES })).not.toThrow();

    const verifiedNode = DAY2_VISUAL_NODES.find((node) => node.visual_verified);
    if (!verifiedNode) {
      throw new Error("Expected at least one verified visual node.");
    }

    const artifact = selectNodeVisualArtifact(verifiedNode);
    expect(artifact.kind).toBe("interactive");
    expect(artifact.content).toContain("function setup");
    expect(artifact.content).toContain("function draw");
    expect(artifact.content).toContain("createCanvas(480, 320)");
  });

  it("aborts malformed provider output before store is possible", () => {
    const outcome = replayDay2Trace(DAY2_PARTIAL_FAILURE_TRACE);

    expect(outcome.status).toBe("aborted");
    expect(outcome.store_writes).toEqual([]);
    expect(outcome.persisted_graph_id).toBeNull();
    expect(outcome.failure?.stage).toBe("diagnostics");
  });
});
