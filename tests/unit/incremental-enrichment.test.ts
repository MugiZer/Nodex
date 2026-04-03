import { describe, expect, it } from "vitest";

import { createRequestLogContext } from "@/lib/logging";
import {
  runIncrementalGraphEnrichment,
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

function createIncrementalClient() {
  const fixture = createIncrementalGraph();
  const nodeState = new Map(fixture.nodes.map((node) => [node.id, { ...node }]));

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

          const builder = {
            select() {
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
              return Promise.resolve({ data: next, error: null });
            },
            then(resolve: (value: { data: Node[]; error: null }) => unknown) {
              return Promise.resolve({
                data: [...nodeState.values()].sort((left, right) => left.position - right.position),
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
  it("selects the first four nodes deterministically along the hard path", () => {
    const fixture = createIncrementalGraph();
    expect(selectInitialLearningSlice(fixture.nodes, fixture.edges, 4)).toEqual(
      fixture.nodes.map((node) => node.id),
    );
  });

  it("marks node 1 ready before node 2 starts and does not let visual failure block readiness", async () => {
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
        lessonDependencies: {
          callModel: async ({ userPrompt }) => ({
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
    expect(events.indexOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1:ready")).toBeLessThan(
      events.indexOf("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2:started"),
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.lesson_status).toBe(
      "ready",
    );
    expect(service.nodeState.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")?.visual_verified).toBe(
      false,
    );
  });
});
