import { describe, expect, it } from "vitest";

import { canonicalizeSuccessFixture } from "@/tests/harness/fixtures";
import {
  DAY2_DIAGNOSTIC_NODES,
  DAY2_GRAPH_DRAFT,
  DAY2_LESSON_NODES,
  DAY2_VISUAL_NODES,
} from "@/tests/harness/day2-generation";
import {
  DIAGNOSTIC_TIMEOUT_MS,
  LESSON_TIMEOUT_MS,
  VISUAL_TIMEOUT_MS,
  runDiagnosticStage,
  runLessonStage,
  runVisualStage,
} from "@/lib/server/generation/stages/content-stages";
import { computeStageTimeout } from "@/lib/server/generation/timeout-model";

describe("content stages", () => {
  it("derives lesson budgets from the shared timeout model and prompts per node", async () => {
    const capturedPrompts: string[] = [];
    const capturedMaxTokens: number[] = [];

    const output = await runLessonStage(
      {
        ...canonicalizeSuccessFixture,
        nodes: DAY2_GRAPH_DRAFT.nodes,
        edges: DAY2_GRAPH_DRAFT.edges,
      },
      undefined,
      {
        callModel: async ({ userPrompt, maxTokens }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim();
          const lessonNode = DAY2_LESSON_NODES.find((node) => node.id === nodeId);
          if (!lessonNode) {
            throw new Error(`Unexpected lesson node prompt: ${userPrompt}`);
          }

          capturedPrompts.push(userPrompt);
          capturedMaxTokens.push(maxTokens ?? 0);

          return {
            id: lessonNode.id,
            lesson_text: lessonNode.lesson_text,
            static_diagram: lessonNode.static_diagram,
            quiz_json: lessonNode.quiz_json,
          };
        },
      },
    );

    expect(output.nodes).toHaveLength(DAY2_LESSON_NODES.length);
    expect(capturedPrompts).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(capturedMaxTokens.every((value) => value === 1800)).toBe(true);
    expect(LESSON_TIMEOUT_MS).toBe(computeStageTimeout(1800));
    expect(capturedPrompts[0]).toContain("Hard prerequisites:");
    expect(capturedPrompts[0]).toContain("Node id:");
  });

  it("keeps the diagnostic prompt slim while staying node-scoped", async () => {
    const capturedPrompts: string[] = [];
    const capturedMaxTokens: number[] = [];

    const output = await runDiagnosticStage(
      {
        ...canonicalizeSuccessFixture,
        nodes: DAY2_GRAPH_DRAFT.nodes,
        edges: DAY2_GRAPH_DRAFT.edges,
      },
      undefined,
      {
        callModel: async ({ userPrompt, maxTokens }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim();
          const diagnosticNode = DAY2_DIAGNOSTIC_NODES.find((node) => node.id === nodeId);
          if (!diagnosticNode) {
            throw new Error(`Unexpected diagnostic node prompt: ${userPrompt}`);
          }

          capturedPrompts.push(userPrompt);
          capturedMaxTokens.push(maxTokens ?? 0);

          return {
            id: diagnosticNode.id,
            diagnostic_questions: diagnosticNode.diagnostic_questions,
          };
        },
      },
    );

    expect(output.nodes).toHaveLength(DAY2_DIAGNOSTIC_NODES.length);
    expect(capturedPrompts).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(capturedMaxTokens.every((value) => value === 400)).toBe(true);
    expect(DIAGNOSTIC_TIMEOUT_MS).toBe(computeStageTimeout(400));
    expect(capturedPrompts[0]).toContain("Node title:");
    expect(capturedPrompts[0]).not.toContain("Hard prerequisite edges:");
    expect(capturedPrompts[0]).not.toContain("Lesson bundle:");
  });

  it("keeps the visual prompt to graph context and node metadata", async () => {
    const capturedPrompts: string[] = [];
    const capturedMaxTokens: number[] = [];

    const output = await runVisualStage(
      {
        ...canonicalizeSuccessFixture,
        nodes: DAY2_GRAPH_DRAFT.nodes,
      },
      undefined,
      {
        callModel: async ({ userPrompt, maxTokens }) => {
          const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim();
          const visualNode = DAY2_VISUAL_NODES.find((node) => node.id === nodeId);
          if (!visualNode) {
            throw new Error(`Unexpected visual node prompt: ${userPrompt}`);
          }

          capturedPrompts.push(userPrompt);
          capturedMaxTokens.push(maxTokens ?? 0);

          return {
            id: visualNode.id,
            p5_code: visualNode.p5_code,
            visual_verified: visualNode.visual_verified,
          };
        },
      },
    );

    expect(output.nodes).toHaveLength(DAY2_VISUAL_NODES.length);
    expect(capturedPrompts).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(capturedMaxTokens.every((value) => value === 900)).toBe(true);
    expect(VISUAL_TIMEOUT_MS).toBe(computeStageTimeout(900));
    expect(capturedPrompts[0]).toContain("Node title:");
    expect(capturedPrompts[0]).not.toContain("Diagnostic bundle:");
    expect(capturedPrompts[0]).not.toContain("quiz_json");
  });

  it("stops scheduling new lesson nodes after the first failure", async () => {
    const startedNodeIds: string[] = [];

    await expect(
      runLessonStage(
        {
          ...canonicalizeSuccessFixture,
          nodes: DAY2_GRAPH_DRAFT.nodes,
          edges: DAY2_GRAPH_DRAFT.edges,
        },
        undefined,
        {
          callModel: async ({ userPrompt }) => {
            const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
            startedNodeIds.push(nodeId);

            if (nodeId === "node_1") {
              throw new Error(
                "Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 4388 (line 1 column 4389)",
              );
            }

            await new Promise((resolve) => setTimeout(resolve, 20));
            const lessonNode = DAY2_LESSON_NODES.find((node) => node.id === nodeId);
            if (!lessonNode) {
              throw new Error(`Unexpected lesson node prompt: ${userPrompt}`);
            }

            return {
              id: lessonNode.id,
              lesson_text: lessonNode.lesson_text,
              static_diagram: lessonNode.static_diagram,
              quiz_json: lessonNode.quiz_json,
            };
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "LLM_PARSE_FAILURE",
    });

    expect(startedNodeIds).toContain("node_1");
    expect(startedNodeIds.length).toBeLessThan(DAY2_GRAPH_DRAFT.nodes.length);
  });
});
