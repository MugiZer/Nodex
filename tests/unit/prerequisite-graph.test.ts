import { describe, expect, it } from "vitest";

import {
  buildAppendedPrerequisiteNodes,
  buildPrerequisiteGraphEdges,
  computePrerequisiteAvailability,
  resolveActiveFlagshipNodeId,
} from "@/lib/prerequisite-lessons";
import type {
  FlagshipLesson,
  Node,
  PrerequisiteDiagnosticGroup,
} from "@/lib/types";
import type { StoredGraphDiagnosticResult } from "@/lib/diagnostic-session";

function makeLesson(name: string): FlagshipLesson {
  return {
    version: "flagship-v1",
    predictionTrap: {
      question: `${name} trap?`,
      obviousAnswer: "obvious",
      correctAnswer: "correct",
      whyWrong: "wrong",
    },
    guidedInsight: {
      ground: "ground",
      mechanism: "mechanism",
      surprise: "surprise",
      reframe: "reframe",
    },
    workedExample: {
      setup: "setup",
      naiveAttempt: "naive",
      steps: [
        { action: "step 1", result: "result 1" },
        { action: "step 2", result: "result 2" },
        { action: "step 3", result: "result 3" },
      ],
      takeaway: "takeaway",
    },
    whatIf: {
      question: "what if?",
      options: [
        { text: "a", isCorrect: false, explanation: "a" },
        { text: "b", isCorrect: true, explanation: "b" },
        { text: "c", isCorrect: false, explanation: "c" },
      ],
    },
    masteryCheck: {
      stem: "stem",
      options: [
        { text: "a", isCorrect: false, feedback: "a" },
        { text: "b", isCorrect: true, feedback: "b" },
        { text: "c", isCorrect: false, feedback: "c" },
        { text: "d", isCorrect: false, feedback: "d" },
      ],
      forwardHook: "forward",
    },
    anchor: {
      summary: "summary",
      bridge: "bridge",
    },
  };
}

describe("prerequisite graph helpers", () => {
  it("prepends prerequisite nodes and unlocks them in order", () => {
    const graphNodes: Node[] = [
      {
        id: "graph-root",
        graph_id: "graph-1",
        graph_version: 1,
        title: "Main topic",
        position: 0,
        attempt_count: 0,
        pass_count: 0,
        lesson_text: null,
        static_diagram: null,
        p5_code: null,
        visual_verified: false,
        quiz_json: null,
        diagnostic_questions: null,
        lesson_status: "ready",
      },
    ];
    const graphEdges = [] as Array<{
      from_node_id: string;
      to_node_id: string;
      type: "hard";
    }>;

    const prerequisiteQuestions = (name: string): PrerequisiteDiagnosticGroup => ({
      name,
      questions: [
        {
          question: `${name} question 1`,
          options: ["a", "b", "c", "d"],
          correctIndex: 1,
          explanation: "explanation 1",
        },
        {
          question: `${name} question 2`,
          options: ["a", "b", "c", "d"],
          correctIndex: 2,
          explanation: "explanation 2",
        },
      ],
    });

    const storedResult: StoredGraphDiagnosticResult = {
      requestId: "request-1",
      graphId: "graph-1",
      topic: "main topic",
      gapNames: ["Prereq A", "Prereq B"],
      gapPrerequisites: [
        prerequisiteQuestions("Prereq A"),
        prerequisiteQuestions("Prereq B"),
      ],
      gapPrerequisiteLessons: [
        { name: "Prereq A", lesson: makeLesson("Prereq A") },
        { name: "Prereq B", lesson: makeLesson("Prereq B") },
      ],
      completedGapNodeIds: [],
    };

    const appendedNodes = buildAppendedPrerequisiteNodes(storedResult, 0);
    expect(appendedNodes).toHaveLength(2);
    expect(appendedNodes[0]?.position).toBe(-2);
    expect(appendedNodes[1]?.position).toBe(-1);
    expect(appendedNodes[0]?.lesson_text).toContain("\"version\":\"flagship-v1\"");

    const edges = buildPrerequisiteGraphEdges({
      prerequisiteNodes: appendedNodes,
      graphNodes,
      graphEdges,
    });

    expect(edges).toEqual([
      {
        from_node_id: appendedNodes[0]!.id,
        to_node_id: appendedNodes[1]!.id,
        type: "hard",
      },
      {
        from_node_id: appendedNodes[1]!.id,
        to_node_id: "graph-root",
        type: "hard",
      },
    ]);

    const availableAtStart = computePrerequisiteAvailability({
      nodes: [...appendedNodes, ...graphNodes],
      edges,
      completedNodeIds: new Set<string>(),
    });
    expect(availableAtStart.has(appendedNodes[0]!.id)).toBe(true);
    expect(availableAtStart.has(appendedNodes[1]!.id)).toBe(false);
    expect(availableAtStart.has("graph-root")).toBe(false);

    const availableAfterFirst = computePrerequisiteAvailability({
      nodes: [...appendedNodes, ...graphNodes],
      edges,
      completedNodeIds: new Set<string>([appendedNodes[0]!.id]),
    });
    expect(availableAfterFirst.has(appendedNodes[0]!.id)).toBe(true);
    expect(availableAfterFirst.has(appendedNodes[1]!.id)).toBe(true);
    expect(availableAfterFirst.has("graph-root")).toBe(false);

    const availableAfterSecond = computePrerequisiteAvailability({
      nodes: [...appendedNodes, ...graphNodes],
      edges,
      completedNodeIds: new Set<string>([appendedNodes[0]!.id, appendedNodes[1]!.id]),
    });
    expect(availableAfterSecond.has("graph-root")).toBe(true);

    expect(
      resolveActiveFlagshipNodeId({
        prerequisiteNodes: appendedNodes,
        completedNodeIds: new Set<string>(),
        persistedFlagshipNodeId: "graph-root",
      }),
    ).toBe(appendedNodes[0]!.id);

    expect(
      resolveActiveFlagshipNodeId({
        prerequisiteNodes: appendedNodes,
        completedNodeIds: new Set<string>([appendedNodes[0]!.id]),
        persistedFlagshipNodeId: "graph-root",
      }),
    ).toBe(appendedNodes[1]!.id);

    expect(
      resolveActiveFlagshipNodeId({
        prerequisiteNodes: appendedNodes,
        completedNodeIds: new Set<string>([appendedNodes[0]!.id, appendedNodes[1]!.id]),
        persistedFlagshipNodeId: "graph-root",
      }),
    ).toBe("graph-root");
  });
});
