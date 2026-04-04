import { describe, expect, it } from "vitest";

import {
  computeAvailableNodeIds,
  getDiagnosticStartNode,
  getDiagnosticRecommendation,
  getNextDiagnosticNode,
  getRecommendedResumeNodeId,
  isQuizPass,
  simulateDiagnosticRun,
} from "@/lib/domain/progress";

import {
  NODE_1_ID,
  NODE_2_ID,
  NODE_3_ID,
  baseEdgesFixture,
  baseGraphPayloadFixture,
  baseNodesFixture,
  baseProgressFixture,
} from "../harness/fixtures";

describe("progress helpers", () => {
  it("scores mastery quizzes using the 2-of-3 threshold", () => {
    expect(isQuizPass(2)).toBe(true);
    expect(isQuizPass(1)).toBe(false);
  });

  it("computes unlocked nodes from hard prerequisites only", () => {
    expect(
      computeAvailableNodeIds(baseNodesFixture, baseEdgesFixture, baseProgressFixture).sort(),
    ).toEqual([NODE_1_ID, NODE_2_ID]);
  });

  it("selects the middle diagnostic start node and moves by two positions", () => {
    expect(getDiagnosticStartNode(baseNodesFixture)?.id).toBe(NODE_2_ID);
    expect(
      getNextDiagnosticNode(baseNodesFixture, NODE_2_ID, [NODE_2_ID], true)?.id,
    ).toBe(NODE_3_ID);
    expect(
      getNextDiagnosticNode(baseNodesFixture, NODE_3_ID, [NODE_3_ID], false)?.id,
    ).toBe(NODE_1_ID);
  });

  it("returns null for empty diagnostic node sets", () => {
    expect(getDiagnosticStartNode([])).toBeNull();
    expect(getDiagnosticRecommendation([], [])).toBeNull();

    const run = simulateDiagnosticRun([], []);
    expect(run.start_node_id).toBeNull();
    expect(run.recommended_node_id).toBeNull();
    expect(run.asked_node_ids).toEqual([]);
  });

  it("returns the first available incomplete node for resume guidance", () => {
    expect(getRecommendedResumeNodeId(baseGraphPayloadFixture)).toBe(NODE_2_ID);
  });

  it("simulates a diagnostic run with a stable recommendation", () => {
    const run = simulateDiagnosticRun(baseNodesFixture, [
      { node_id: NODE_2_ID, correct: true },
      { node_id: NODE_3_ID, correct: false },
    ]);

    expect(run.start_node_id).toBe(NODE_2_ID);
    expect(run.asked_node_ids.length).toBeGreaterThan(0);
    expect(run.recommended_node_id).toBe(NODE_2_ID);
  });
});
