import { describe, expect, it, vi } from "vitest";

import { createRequestLogContext } from "@/lib/logging";
import {
  computeFlagshipAttemptTimeoutMs,
  computeStandardLessonTimeoutMs,
  runIncrementalGraphEnrichment,
  selectInitialSlice,
  selectInitialLearningSlice,
} from "@/lib/server/generation/incremental";
import type { Graph, Node } from "@/lib/types";

function createIncrementalGraph() {
  const graph: Graph = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Trigonometry",
    subject: "mathematics",
    topic: "trigonometry",
    description:
      "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra, Euclidean geometry and serves as a foundation for calculus, physics, statistics. Within mathematics, it is typically encountered at the intermediate level.",
    version: 1,
    flagged_for_review: false,
    created_at: "2026-04-01T00:00:00.000Z",
  };

  const nodes: Node[] = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      graph_id: graph.id,
      graph_version: graph.version,
      title: "Angle Measurement",
      lesson_text: null,
      static_diagram: null,
      p5_code: null,
      visual_verified: false,
      quiz_json: null,
      diagnostic_questions: null,
      lesson_status: "pending",
      position: 0,
      attempt_count: 0,
      pass_count: 0,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      graph_id: graph.id,
      graph_version: graph.version,
      title: "Right Triangle Ratios",
      lesson_text: null,
      static_diagram: null,
      p5_code: null,
      visual_verified: false,
      quiz_json: null,
      diagnostic_questions: null,
      lesson_status: "pending",
      position: 1,
      attempt_count: 0,
      pass_count: 0,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      graph_id: graph.id,
      graph_version: graph.version,
      title: "Unit Circle Basics",
      lesson_text: null,
      static_diagram: null,
      p5_code: null,
      visual_verified: false,
      quiz_json: null,
      diagnostic_questions: null,
      lesson_status: "pending",
      position: 2,
      attempt_count: 0,
      pass_count: 0,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      graph_id: graph.id,
      graph_version: graph.version,
      title: "Sine Function",
      lesson_text: null,
      static_diagram: null,
      p5_code: null,
      visual_verified: false,
      quiz_json: null,
      diagnostic_questions: null,
      lesson_status: "pending",
      position: 3,
      attempt_count: 0,
      pass_count: 0,
    },
  ];

  const edges = [
    { from_node_id: nodes[0]!.id, to_node_id: nodes[1]!.id, type: "hard" as const },
    { from_node_id: nodes[1]!.id, to_node_id: nodes[2]!.id, type: "hard" as const },
    { from_node_id: nodes[2]!.id, to_node_id: nodes[3]!.id, type: "hard" as const },
  ];

  return { graph, nodes, edges };
}

type SliceFixtureNode = {
  id: string;
  is_lesson_bearing: boolean;
};

function createInitialSliceFixture() {
  const nodes: SliceFixtureNode[] = [
    { id: "a", is_lesson_bearing: false },
    { id: "b", is_lesson_bearing: true },
    { id: "c", is_lesson_bearing: true },
    { id: "d", is_lesson_bearing: true },
    { id: "e", is_lesson_bearing: false },
    { id: "f", is_lesson_bearing: true },
    { id: "g", is_lesson_bearing: false },
    { id: "h", is_lesson_bearing: true },
  ];

  const edges = [
    { from_node_id: "a", to_node_id: "c", type: "hard" as const },
    { from_node_id: "a", to_node_id: "b", type: "hard" as const },
    { from_node_id: "b", to_node_id: "e", type: "hard" as const },
    { from_node_id: "b", to_node_id: "d", type: "hard" as const },
    { from_node_id: "d", to_node_id: "g", type: "hard" as const },
    { from_node_id: "d", to_node_id: "f", type: "hard" as const },
    { from_node_id: "f", to_node_id: "h", type: "hard" as const },
  ];

  return { nodes, edges };
}

function createIncrementalClient(options: { supportsLessonStatus?: boolean } = {}) {
  const fixture = createIncrementalGraph();
  const nodeState = new Map(fixture.nodes.map((node) => [node.id, { ...node }]));
  const supportsLessonStatus = options.supportsLessonStatus ?? true;

  return {
    nodeState,
    client: {
      from(table: string) {
        if (table === "graphs") {
          const builder = {
            select() {
              return builder;
            },
            eq() {
              return builder;
            },
            maybeSingle() {
              return Promise.resolve({ data: fixture.graph, error: null });
            },
          };
          return builder;
        }

        if (table === "nodes") {
          let updateValue: Partial<Node> | null = null;
          let selectedId = "";
          let selectedFields = "";

          const builder = {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              selectedFields = fields ?? "";
              if (options?.head) {
                if (
                  !supportsLessonStatus &&
                  selectedFields.includes("lesson_status")
                ) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        "Could not find the 'lesson_status' column of 'nodes' in the schema cache",
                    },
                  });
                }
                return Promise.resolve({ data: [], error: null });
              }
              return builder;
            },
            eq(field: string, value: string) {
              if (field === "id") {
                selectedId = value;
              }
              return builder;
            },
            order() {
              return builder;
            },
            update(value: Partial<Node>) {
              updateValue = value;
              return builder;
            },
            maybeSingle() {
              if (!selectedId) {
                return Promise.resolve({ data: null, error: null });
              }

              const current = nodeState.get(selectedId);
              if (!current) {
                return Promise.resolve({ data: null, error: null });
              }

              const next = updateValue ? { ...current, ...updateValue } : current;
              nodeState.set(selectedId, next);
              const result = supportsLessonStatus
                ? next
                : (() => {
                    const { lesson_status, ...withoutLessonStatus } = next;
                    void lesson_status;
                    return withoutLessonStatus;
                  })();
              return Promise.resolve({ data: result, error: null });
            },
            then(resolve: (value: { data: Node[]; error: null }) => unknown) {
              const rows = [...nodeState.values()]
                .sort((left, right) => left.position - right.position)
                .map((node) => {
                  if (supportsLessonStatus) {
                    return node;
                  }
                  const { lesson_status, ...withoutLessonStatus } = node;
                  void lesson_status;
                  return withoutLessonStatus as Node;
                });
              return Promise.resolve({
                data: rows,
                error: null,
              }).then(resolve);
            },
          };

          return builder;
        }

        if (table === "edges") {
          const builder = {
            select() {
              return builder;
            },
            in() {
              return builder;
            },
            then(resolve: (value: { data: typeof fixture.edges; error: null }) => unknown) {
              return Promise.resolve({ data: fixture.edges, error: null }).then(resolve);
            },
          };

          return builder;
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
}

describe("incremental enrichment", () => {
  it("splits the initial slice along the primary lesson-bearing hard path", () => {
    const fixture = createInitialSliceFixture();

    expect(selectInitialSlice(fixture.nodes, fixture.edges)).toEqual({
      flagship: "b",
      standard: ["d", "f", "h"],
      pending: ["a", "c", "e", "g"],
    });
  });

  it("selects the first four nodes deterministically along the hard path", () => {
    const fixture = createIncrementalGraph();
    expect(selectInitialLearningSlice(fixture.nodes, fixture.edges, 4)).toEqual(
      fixture.nodes.map((node) => node.id),
    );
  });

  it("runs selected nodes concurrently and does not let visual failure block readiness", async () => {
    const service = createIncrementalClient();
    const events: string[] = [];
    const context = createRequestLogContext("test incremental");

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 2,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        flagshipLessonDependencies: {
          callModel: async () => "not json",
        },
        lessonDependencies: {
          callModel: async ({ userPrompt }) => {
            if (userPrompt.includes("Angle Measurement")) {
              await new Promise((resolve) => setTimeout(resolve, 20));
            }

            return {
              lesson_text: `Lesson for ${userPrompt}`,
              static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
              quiz_json: [
                {
                  question: "Q1",
                  options: ["A", "B", "C", "D"],
                  correct_index: 0,
                  explanation: "E1",
                },
                {
                  question: "Q2",
                  options: ["A", "B", "C", "D"],
                  correct_index: 0,
                  explanation: "E2",
                },
                {
                  question: "Q3",
                  options: ["A", "B", "C", "D"],
                  correct_index: 0,
                  explanation: "E3",
                },
              ],
            };
          },
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => {
            const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
            return {
              diagnostic_questions: [
                {
                  question: "Diagnostic",
                  options: ["A", "B", "C", "D"],
                  correct_index: 0,
                  difficulty_order: 1,
                  node_id: nodeId,
                },
              ],
            };
          },
        },
        visualDependencies: {
          callModel: async ({ userPrompt }) => {
            if (userPrompt.includes("Angle Measurement")) {
              throw new Error("visual failed");
            }

            return {
              p5_code:
                "function setup() { createCanvas(480, 320); }\nfunction draw() {}",
              visual_verified: true,
            };
          },
        },
        onNodeTransition: async ({ node_id, event }) => {
          events.push(`${node_id}:${event}`);
        },
      },
    );

    expect(result.ready_node_ids).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    ]);
    expect(result.failed_node_ids).toEqual([]);
    expect(events.indexOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2:ready")).toBeLessThan(
      events.indexOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1:ready"),
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_status).toBe(
      "ready",
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.visual_verified).toBe(
      false,
    );
  });

  it("stores a flagship lesson JSON string for the first selected node only", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental flagship");

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 2,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        flagshipLessonDependencies: {
          callModel: async ({ userPrompt }) =>
            `\`\`\`json
${JSON.stringify({
  predictionTrap: {
    question: `Trap for ${userPrompt.includes("Angle Measurement") ? "Angle Measurement" : "node"}`,
    obviousAnswer: "Obvious",
    correctAnswer: "Correct",
    whyWrong: "Why wrong",
  },
  guidedInsight: {
    ground: "Ground",
    mechanism: "Mechanism",
    surprise: "Surprise",
    reframe: "Reframe",
  },
  workedExample: {
    setup: "Setup",
    naiveAttempt: "Naive",
    steps: [
      { action: "Step 1", result: "Result 1" },
      { action: "Step 2", result: "Result 2" },
      { action: "Step 3", result: "Result 3" },
    ],
    takeaway: "Takeaway",
  },
  whatIf: {
    question: "What if?",
    options: [
      { text: "A", isCorrect: false, explanation: "No" },
      { text: "B", isCorrect: true, explanation: "Yes" },
      { text: "C", isCorrect: false, explanation: "No" },
    ],
  },
  masteryCheck: {
    stem: "Mastery?",
    options: [
      { text: "M1", isCorrect: false, feedback: "No" },
      { text: "M2", isCorrect: true, feedback: "Yes" },
      { text: "M3", isCorrect: false, feedback: "No" },
      { text: "M4", isCorrect: false, feedback: "No" },
    ],
    forwardHook: "Next",
  },
  anchor: {
    summary: "Summary",
    bridge: "Bridge",
  },
}, null, 2)}
\`\`\``,
        },
        lessonDependencies: {
          callModel: async ({ userPrompt }) => ({
            lesson_text: `Standard lesson for ${userPrompt.match(/Node title: ([^\n]+)/)?.[1] ?? "node"}`,
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            quiz_json: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E1",
              },
              {
                question: "Q2",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E2",
              },
              {
                question: "Q3",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E3",
              },
            ],
          }),
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(result.ready_node_ids).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    ]);
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toMatch(
      /^\{"version":"flagship-v1","predictionTrap":/,
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2")?.lesson_text).toBe(
      "Standard lesson for Right Triangle Ratios",
    );
  });

  it("falls back to the standard lesson generator when flagship generation returns null", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental flagship fallback");

    await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 1,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        maxNodeConcurrency: 1,
        flagshipLessonDependencies: {
          callModel: async () => "not json",
        },
        lessonDependencies: {
          callModel: async () => ({
            lesson_text: "Fallback standard lesson",
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            quiz_json: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E1",
              },
              {
                question: "Q2",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E2",
              },
              {
                question: "Q3",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E3",
              },
            ],
          }),
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toBe(
      "Fallback standard lesson",
    );
  });

  it("uses a single flagship attempt and falls back when the flagship JSON is truncated", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental flagship truncation");
    const flagshipCallModel = vi.fn(async ({ maxTokens }: { maxTokens: number }) => {
      expect(maxTokens).toBe(4000);
      return "{\"predictionTrap\":{\"question\":\"cut off";
    });

    await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 1,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        maxNodeConcurrency: 1,
        flagshipLessonDependencies: {
          callModel: flagshipCallModel,
        },
        lessonDependencies: {
          callModel: async () => ({
            lesson_text: "Fallback standard lesson after truncated flagship JSON",
            static_diagram: null,
            quiz_json: null,
          }),
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(flagshipCallModel).toHaveBeenCalledTimes(1);
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toBe(
      "Fallback standard lesson after truncated flagship JSON",
    );
  });

  it("reserves enough budget for fallback and skips flagship retries when the remainder is too small", async () => {
    expect(
      computeFlagshipAttemptTimeoutMs({
        remainingBudgetMs: 24,
        minimumFallbackBudgetMs: 7,
        minimumFlagshipRetryBudgetMs: 8,
      }),
    ).toBe(17);

    expect(
      computeFlagshipAttemptTimeoutMs({
        remainingBudgetMs: 14,
        minimumFallbackBudgetMs: 7,
        minimumFlagshipRetryBudgetMs: 8,
      }),
    ).toBe(0);

    expect(
      computeStandardLessonTimeoutMs({
        remainingBudgetMs: 9,
      }),
    ).toBe(9);
  });

  it("keeps the node pending when flagship retry budget is exhausted and fallback would be too small", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental flagship budget floor");
    const flagshipCallModel = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return "not json";
    });
    const lessonCallModel = vi.fn(async () => ({
      lesson_text: "should not be used",
      static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      quiz_json: null,
    }));

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 1,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        enrichmentDeadlineMs: 24,
        minimumFallbackBudgetMs: 7,
        minimumFlagshipRetryBudgetMs: 8,
        flagshipLessonDependencies: {
          callModel: flagshipCallModel,
        },
        lessonDependencies: {
          callModel: lessonCallModel,
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(flagshipCallModel).toHaveBeenCalledTimes(1);
    expect(lessonCallModel).not.toHaveBeenCalled();
    expect(result.ready_node_ids).toEqual([]);
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_status).toBe(
      "pending",
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toBeNull();
  });

  it("derives lesson_status when the live nodes surface does not expose it", async () => {
    const service = createIncrementalClient({
      supportsLessonStatus: false,
    });
    const context = createRequestLogContext("test incremental");

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 1,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        lessonDependencies: {
          callModel: async () => ({
            lesson_text: "Lesson text.",
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            quiz_json: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E1",
              },
              {
                question: "Q2",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E2",
              },
              {
                question: "Q3",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                explanation: "E3",
              },
            ],
          }),
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => {
            const nodeId = userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "";
            return {
              diagnostic_questions: [
                {
                  question: "Diagnostic",
                  options: ["A", "B", "C", "D"],
                  correct_index: 0,
                  difficulty_order: 1,
                  node_id: nodeId,
                },
              ],
            };
          },
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(result.ready_node_ids).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"]);
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toBe(
      "Lesson text.",
    );
  });

  it("keeps a node pending instead of failed when lesson or diagnostic generation is malformed", async () => {
    const service = createIncrementalClient();
    const events: string[] = [];
    const context = createRequestLogContext("test incremental");

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 1,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        lessonDependencies: {
          callModel: async () => {
            throw new Error("lesson malformed");
          },
        },
        diagnosticDependencies: {
          callModel: async () => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: "wrong-node-id",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "function setup() { createCanvas(480, 320); }\nfunction draw() {}",
            visual_verified: true,
          }),
        },
        onNodeTransition: async ({ node_id, event }) => {
          events.push(`${node_id}:${event}`);
        },
      },
    );

    expect(result.ready_node_ids).toEqual([]);
    expect(result.failed_node_ids).toEqual([]);
    expect(result.remaining_pending_node_ids).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_status).toBe(
      "pending",
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_text).toBeNull();
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.diagnostic_questions).toBeNull();
    expect(events).not.toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1:failed");
  });

  it("skips remaining standard lesson generations after the first deterministic structured-output failure", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental circuit breaker");
    const lessonCalls: string[] = [];

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 3,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        maxNodeConcurrency: 1,
        flagshipLessonDependencies: {
          callModel: async () => "not json",
        },
        lessonDependencies: {
          callModel: async ({ userPrompt }) => {
            lessonCalls.push(userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "");
            throw new Error(
              "Failed to parse structured output: Error: Failed to parse structured output: [{\"expected\":\"string\",\"path\":[\"quiz_json\",0,\"question\"],\"message\":\"Invalid input: expected string, received null\"}]",
            );
          },
        },
        diagnosticDependencies: {
          callModel: async ({ userPrompt }) => ({
            diagnostic_questions: [
              {
                question: "Diagnostic",
                options: ["A", "B", "C", "D"],
                correct_index: 0,
                difficulty_order: 1,
                node_id: userPrompt.match(/Node id: ([^\n]+)/)?.[1]?.trim() ?? "",
              },
            ],
          }),
        },
        visualDependencies: {
          callModel: async () => ({
            p5_code: "",
            visual_verified: false,
          }),
        },
      },
    );

    expect(lessonCalls).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    ]);
    expect(result.ready_node_ids).toEqual([]);
    expect(result.failed_node_ids).toEqual([]);
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2")?.lesson_status).toBe(
      "pending",
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3")?.lesson_text).toBeNull();
  });

  it("returns once the overall enrichment deadline is exhausted and leaves remaining nodes pending", async () => {
    const service = createIncrementalClient();
    const context = createRequestLogContext("test incremental deadline");

    const result = await runIncrementalGraphEnrichment(
      {
        graph_id: "11111111-1111-4111-8111-111111111111",
        limit: 2,
      },
      context,
      {
        createServiceClient: () => service.client as never,
        enrichmentDeadlineMs: 1,
        flagshipLessonDependencies: {
          callModel: async () => new Promise(() => undefined),
        },
        lessonDependencies: {
          callModel: async () => new Promise(() => undefined),
        },
        diagnosticDependencies: {
          callModel: async () => new Promise(() => undefined),
        },
        visualDependencies: {
          callModel: async () => new Promise(() => undefined),
        },
      },
    );

    expect(result.ready_node_ids).toEqual([]);
    expect(result.failed_node_ids).toEqual([]);
    expect(result.remaining_pending_node_ids).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(result.remaining_pending_node_ids).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
  });
});
