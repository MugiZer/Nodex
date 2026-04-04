import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { handleGenerateRequest } from "@/app/api/generate/route";
import { ApiError } from "@/lib/errors";
import { createRequestLogContext } from "@/lib/logging";
import { runGenerationPipeline } from "@/lib/server/generation/orchestrator";
import type { CanonicalizeModelSuccessDraft } from "@/lib/types";

import {
  DAY2_GRAPH_DRAFT,
  DAY2_LESSON_NODES,
  DAY2_VISUAL_NODES,
} from "../harness/day2-generation";

function createGraphVersionSelectBuilder(version = 0) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({
        data: version > 0 ? [{ version }] : [],
        error: null,
      });
    },
  };

  return builder;
}

function createStoreClient(graphId = "99999999-9999-4999-8999-999999999999") {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ graph_id: graphId }],
    error: null,
  });

  return {
    client: {
      from(table: string) {
        if (table === "graphs") {
          return createGraphVersionSelectBuilder();
        }

        throw new Error(`Unexpected table access in test store client: ${table}`);
      },
      rpc,
    },
    rpc,
  };
}

function createGenerateAndEnrichClient(graphId = "99999999-9999-4999-8999-999999999999") {
  const nodeState = new Map<string, Record<string, unknown>>();
  const edgeRows: Array<Record<string, unknown>> = [];
  let graphRow: Record<string, unknown> | null = null;
  const rpc = vi.fn().mockImplementation(async (fnName: string, args?: Record<string, unknown>) => {
    if (fnName === "store_generated_graph") {
      const graphVersion =
        (args?.p_graph as { version?: number } | undefined)?.version ?? 1;
      graphRow = {
        id: graphId,
        subject: (args?.p_graph as { subject?: string } | undefined)?.subject ?? "mathematics",
        topic: (args?.p_graph as { topic?: string } | undefined)?.topic ?? "trigonometry",
        description:
          (args?.p_graph as { description?: string } | undefined)?.description ?? "Trigonometry graph",
      };
      for (const row of ((args?.p_nodes as Array<Record<string, unknown>> | undefined) ?? [])) {
        nodeState.set(String(row.id), {
          graph_id: graphId,
          graph_version: graphVersion,
          attempt_count: 0,
          pass_count: 0,
          ...row,
        });
      }
      edgeRows.splice(0, edgeRows.length, ...(((args?.p_edges as Array<Record<string, unknown>> | undefined) ?? [])));
      return {
        data: [{ graph_id: graphId }],
        error: null,
      };
    }

    return {
      data: [],
      error: null,
    };
  });

  return {
    nodeState,
    edgeRows,
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
            order() {
              return builder;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            maybeSingle() {
              return Promise.resolve({
                data: graphRow,
                error: null,
              });
            },
          };
          return builder;
        }

        if (table === "nodes") {
          let updateValue: Record<string, unknown> | null = null;
          let selectedId = "";
          let selectedGraphId = "";
          const builder = {
            select() {
              return builder;
            },
            eq(field: string, value: string) {
              if (field === "id") {
                selectedId = value;
              }
              if (field === "graph_id") {
                selectedGraphId = value;
              }
              return builder;
            },
            order() {
              return builder;
            },
            update(value: Record<string, unknown>) {
              updateValue = value;
              return builder;
            },
            maybeSingle() {
              const current = nodeState.get(selectedId);
              if (!current) {
                return Promise.resolve({ data: null, error: null });
              }

              const next = updateValue ? { ...current, ...updateValue } : current;
              nodeState.set(selectedId, next);
              return Promise.resolve({ data: next, error: null });
            },
            insert(value: Array<Record<string, unknown>>) {
              for (const row of value) {
                nodeState.set(String(row.id), row);
              }
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
              const rows = [...nodeState.values()]
                .filter((row) => (selectedGraphId ? row.graph_id === selectedGraphId : true))
                .sort((left, right) => Number(left.position) - Number(right.position));
              return Promise.resolve({ data: rows, error: null }).then(resolve);
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
            insert(value: Array<Record<string, unknown>>) {
              edgeRows.push(...value);
              return Promise.resolve({ data: null, error: null });
            },
            then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
              return Promise.resolve({ data: edgeRows, error: null }).then(resolve);
            },
          };
          return builder;
        }

        throw new Error(`Unexpected table access in generate+enrich client: ${table}`);
      },
      rpc,
    },
    rpc,
  };
}

function createIncompleteCacheClient(
  candidateGraphId = "61bc6f87-439c-4ddd-889e-25368a4ceb78",
  storedGraphId = "99999999-9999-4999-8999-999999999999",
) {
  let searchGraphCandidatesCalls = 0;
  const rpc = vi.fn(async (fnName: string) => {
    if (fnName === "search_graph_candidates") {
      searchGraphCandidatesCalls += 1;
      if (searchGraphCandidatesCalls > 1) {
        return {
          data: [],
          error: null,
        };
      }

      return {
        data: [
          {
            id: candidateGraphId,
            similarity: 0.97,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-03T18:49:09Z",
          },
        ],
        error: null,
      };
    }

    if (fnName === "store_generated_graph") {
      return {
        data: [
          {
            graph_id: storedGraphId,
          },
        ],
        error: null,
      };
    }

    return {
      data: null,
      error: {
        message: `Unexpected RPC function in incomplete-cache client: ${fnName}`,
      },
    };
  });

  const createReadBuilder = (rows: Array<Record<string, unknown>>) => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      in() {
        return builder;
      },
      not() {
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return Promise.resolve({
          data: rows,
          error: null,
        });
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ) {
        return Promise.resolve({
          data: rows,
          error: null,
        }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  };

  return {
    client: {
      from(table: string) {
        if (table === "graphs") {
          return createGraphVersionSelectBuilder();
        }

        if (table === "nodes") {
          return createReadBuilder([]);
        }

        if (table === "edges") {
          return createReadBuilder([]);
        }

        throw new Error(`Unexpected table access in incomplete cache client: ${table}`);
      },
      rpc,
    },
    rpc,
  };
}

function createFallbackStoreClient(options: { supportsLessonStatus?: boolean } = {}) {
  const rpc = vi.fn().mockResolvedValue({
    data: null,
    error: {
      code: "PGRST202",
      message:
        "Could not find the function public.store_generated_graph(p_edges, p_embedding, p_graph, p_nodes) in the schema cache",
    },
  });
  const inserted = {
    graphs: [] as Array<Record<string, unknown>>,
    nodes: [] as Array<Record<string, unknown>>,
    edges: [] as Array<Record<string, unknown>>,
  };
  const supportsLessonStatus = options.supportsLessonStatus ?? true;

  const createGraphsBuilder = () => {
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
          return Promise.resolve({
            data: [],
            error: null,
          });
        }

        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      limit(count: number) {
        void count;
        return Promise.resolve({
          data: selectedFields === "version" ? [] : [],
          error: null,
        });
      },
      insert(value: Record<string, unknown>) {
        inserted.graphs.push(value);
        return Promise.resolve({
          data: null,
          error: null,
        });
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve({
          data: [],
          error: null,
        }).then(onfulfilled, onrejected);
      },
    };

    return builder;
  };

  const createInsertBuilder = (table: "nodes" | "edges") => {
    let selectedFields = "";

    return {
      select(fields?: string, options?: { head?: boolean; count?: string }) {
        selectedFields = fields ?? "";
        if (options?.head) {
          if (
            table === "nodes" &&
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
          return Promise.resolve({
            data: [],
            error: null,
          });
        }
        return this;
      },
      limit() {
        return Promise.resolve({
          data: [],
          error: null,
        });
      },
      insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
        if (
          table === "nodes" &&
          !supportsLessonStatus &&
          ((Array.isArray(value) ? value : [value]).some((entry) =>
            Object.prototype.hasOwnProperty.call(entry, "lesson_status"),
          ))
        ) {
          return Promise.resolve({
            data: null,
            error: {
              message:
                "Could not find the 'lesson_status' column of 'nodes' in the schema cache",
            },
          });
        }

        if (Array.isArray(value)) {
          inserted[table].push(...value);
        } else {
          inserted[table].push(value);
        }

        return Promise.resolve({
          data: null,
          error: null,
        });
      },
    };
  };

  return {
    client: {
      from(table: string) {
        if (table === "graphs") {
          return createGraphsBuilder();
        }

        if (table === "nodes") {
          return createInsertBuilder("nodes");
        }

        if (table === "edges") {
          return createInsertBuilder("edges");
        }

        throw new Error(`Unexpected table access in fallback store client: ${table}`);
      },
      rpc,
    },
    inserted,
    rpc,
  };
}

function createCanonicalizeDraft(
  overrides: Partial<CanonicalizeModelSuccessDraft> = {},
): CanonicalizeModelSuccessDraft {
  return {
    subject: "mathematics",
    topic: "Trigonometry",
    scope_summary:
      "the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
    core_concepts: [
      "sine",
      "cosine",
      "tangent",
      "trigonometric identities",
      "laws of sines and cosines",
      "radian measure",
      "graphing patterns",
    ],
    prerequisites: ["algebra", "Euclidean geometry"],
    downstream_topics: ["calculus", "physics", "statistics"],
    level: "intermediate",
    ...overrides,
  };
}

function createStageDependencies() {
  const canonicalizeDraft = createCanonicalizeDraft();

  return {
    callModel: async () => canonicalizeDraft,
    graphGeneratorDependencies: {
      callModel: async () => DAY2_GRAPH_DRAFT,
    },
    structureValidatorDependencies: {
      callModel: async () => ({ valid: true, issues: [] }),
    },
    curriculumValidatorDependencies: {
      callModel: async () => ({ valid: true, issues: [] }),
    },
    reconcilerDependencies: {
      callModel: async () => ({
        nodes: DAY2_GRAPH_DRAFT.nodes,
        edges: DAY2_GRAPH_DRAFT.edges,
        resolution_summary: [],
      }),
    },
    incrementalEnrichmentDependencies: {
      lessonDependencies: {
        callModel: async () => ({
          lesson_text: DAY2_LESSON_NODES[0]!.lesson_text,
          static_diagram: DAY2_LESSON_NODES[0]!.static_diagram,
          quiz_json: DAY2_LESSON_NODES[0]!.quiz_json as [typeof DAY2_LESSON_NODES[0]["quiz_json"][number], typeof DAY2_LESSON_NODES[0]["quiz_json"][number], typeof DAY2_LESSON_NODES[0]["quiz_json"][number]],
        }),
      },
      diagnosticDependencies: {
        callModel: async () => ({
          prerequisites: [
            {
              name: "algebra",
              questions: [
                {
                  question: "If x + 3 = 7, what is x?",
                  options: ["1", "2", "3", "4"],
                  correctIndex: 1,
                  explanation: "Subtract 3 from both sides to isolate x.",
                },
                {
                  question: "Which expression is equivalent to 2(x + 5)?",
                  options: ["2x + 10", "2x + 5", "x + 10", "x + 5"],
                  correctIndex: 0,
                  explanation: "Distribute the 2 across both terms inside the parentheses.",
                },
              ],
            },
            {
              name: "Euclidean geometry",
              questions: [
                {
                  question: "How many degrees are in a straight angle?",
                  options: ["90", "120", "180", "360"],
                  correctIndex: 2,
                  explanation: "A straight angle is half of a full rotation.",
                },
                {
                  question: "What is the sum of the interior angles of a triangle?",
                  options: ["90°", "180°", "270°", "360°"],
                  correctIndex: 1,
                  explanation: "The interior angles of any triangle add to 180 degrees.",
                },
              ],
            },
          ],
        }),
      },
      visualDependencies: {
        callModel: async () => ({
          p5_code: DAY2_VISUAL_NODES[0]!.p5_code,
          visual_verified: DAY2_VISUAL_NODES[0]!.visual_verified,
        }),
      },
    },
    triggerEnrichment: vi.fn(),
  };
}

function replaceNodeTitle(
  nodeId: string,
  title: string,
): typeof DAY2_GRAPH_DRAFT.nodes {
  return DAY2_GRAPH_DRAFT.nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          title,
        }
      : node,
  );
}

function buildCyclicGraphDraft() {
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    id: `node_${index + 1}`,
    title: `Concept ${index + 1}`,
    position: index,
  }));

  const edges = [
    { from_node_id: "node_1", to_node_id: "node_2", type: "hard" as const },
    { from_node_id: "node_2", to_node_id: "node_3", type: "hard" as const },
    { from_node_id: "node_3", to_node_id: "node_1", type: "hard" as const },
    { from_node_id: "node_3", to_node_id: "node_4", type: "hard" as const },
    { from_node_id: "node_4", to_node_id: "node_5", type: "hard" as const },
    { from_node_id: "node_5", to_node_id: "node_6", type: "hard" as const },
    { from_node_id: "node_6", to_node_id: "node_7", type: "hard" as const },
    { from_node_id: "node_7", to_node_id: "node_8", type: "hard" as const },
    { from_node_id: "node_8", to_node_id: "node_9", type: "hard" as const },
    { from_node_id: "node_9", to_node_id: "node_10", type: "hard" as const },
  ];

  return { nodes, edges };
}

function buildSelfLoopDraft() {
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    id: `node_${index + 1}`,
    title: `Concept ${index + 1}`,
    position: index,
  }));

  const edges = [
    { from_node_id: "node_1", to_node_id: "node_1", type: "hard" as const },
    { from_node_id: "node_1", to_node_id: "node_2", type: "hard" as const },
    { from_node_id: "node_2", to_node_id: "node_3", type: "hard" as const },
    { from_node_id: "node_3", to_node_id: "node_4", type: "hard" as const },
    { from_node_id: "node_4", to_node_id: "node_5", type: "hard" as const },
    { from_node_id: "node_5", to_node_id: "node_6", type: "hard" as const },
    { from_node_id: "node_6", to_node_id: "node_7", type: "hard" as const },
    { from_node_id: "node_7", to_node_id: "node_8", type: "hard" as const },
    { from_node_id: "node_8", to_node_id: "node_9", type: "hard" as const },
    { from_node_id: "node_9", to_node_id: "node_10", type: "hard" as const },
  ];

  return { nodes, edges };
}

function buildDraftWithDuplicateIdsAndDanglingEdge() {
  const nodes = Array.from({ length: 10 }, (_, index) => ({
    id: `node_${Math.min(index + 1, 9)}`,
    title: `Concept ${index + 1}`,
    position: index,
  }));

  const edges = [
    { from_node_id: "node_1", to_node_id: "node_2", type: "hard" as const },
    { from_node_id: "node_2", to_node_id: "node_3", type: "hard" as const },
    { from_node_id: "node_3", to_node_id: "node_4", type: "hard" as const },
    { from_node_id: "node_4", to_node_id: "node_5", type: "hard" as const },
    { from_node_id: "node_5", to_node_id: "node_6", type: "hard" as const },
    { from_node_id: "node_6", to_node_id: "node_7", type: "hard" as const },
    { from_node_id: "node_7", to_node_id: "node_8", type: "hard" as const },
    { from_node_id: "node_8", to_node_id: "node_9", type: "hard" as const },
    { from_node_id: "node_9", to_node_id: "node_99", type: "hard" as const },
  ];

  return { nodes, edges };
}

describe("day 2 generate orchestration", () => {
  it("short-circuits on a retrieval cache hit", async () => {
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.94,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      graph_id: "77777777-7777-4777-8777-777777777777",
      cached: true,
    });
    expect(body.diagnostic).toEqual(expect.anything());
  });

  it("treats an incomplete cached graph as a miss and generates a fresh graph", async () => {
    const store = createIncompleteCacheClient();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const response = await handleGenerateRequest(
        new Request("http://localhost/api/generate", {
          method: "POST",
          body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
        }),
        {
          ...createStageDependencies(),
          embedDescription: async () => [1, 0, 0],
          createServiceClient: () => store.client as never,
        },
      );

      expect(response.status).toBe(200);
      const incompleteCacheBody = await response.json();
      expect(incompleteCacheBody).toMatchObject({
        graph_id: "99999999-9999-4999-8999-999999999999",
        cached: false,
      });
      expect(store.rpc).toHaveBeenCalledWith("search_graph_candidates", {
        p_subject: "mathematics",
        p_embedding: expect.any(String),
        p_limit: 25,
      });
      expect(store.rpc.mock.calls.some(([fnName]) => fnName === "store_generated_graph")).toBe(
        true,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("incomplete_cache_rejected"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("runs the full pipeline and stores a generated graph on a miss", async () => {
    const store = createStoreClient();
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        triggerEnrichment: undefined,
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("schedules background enrich after storing a generated graph", async () => {
    const store = createGenerateAndEnrichClient();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const response = await handleGenerateRequest(
        new Request("http://localhost/api/generate", {
          method: "POST",
          body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
        }),
        {
          ...createStageDependencies(),
          triggerEnrichment: undefined,
          embedDescription: async () => [1, 0, 0],
          searchRetrievalCandidates: async () => [],
          createServiceClient: () => store.client as never,
          incrementalEnrichmentDependencies: {
            ...createStageDependencies().incrementalEnrichmentDependencies,
            createServiceClient: () => store.client as never,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        cached: false,
        graph_id: expect.any(String),
      });
      await vi.waitFor(() => {
        expect(logSpy).toHaveBeenCalledWith("[enrich] Route handler entered");
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("re-triggers enrichment for cached graphs that are missing demo lessons", async () => {
    const triggerEnrichment = vi.fn();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async () => createCanonicalizeDraft(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.94,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
        triggerEnrichment,
        incrementalEnrichmentDependencies: {
          createServiceClient: () =>
            ({
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
                      return Promise.resolve({
                        data: {
                          id: "77777777-7777-4777-8777-777777777777",
                          subject: "mathematics",
                          topic: "trigonometry",
                          description: "desc",
                        },
                        error: null,
                      });
                    },
                  };
                  return builder;
                }

                if (table === "nodes") {
                  const builder = {
                    select() {
                      return builder;
                    },
                    eq() {
                      return builder;
                    },
                    order() {
                      return builder;
                    },
                    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
                      return Promise.resolve({
                        data: Array.from({ length: 4 }, (_, index) => ({
                          id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
                          graph_id: "77777777-7777-4777-8777-777777777777",
                          graph_version: 1,
                          title: `Concept ${index + 1}`,
                          lesson_text: null,
                          static_diagram: null,
                          p5_code: null,
                          visual_verified: false,
                          quiz_json: null,
                          diagnostic_questions: null,
                          lesson_status: "pending",
                          position: index,
                          attempt_count: 0,
                          pass_count: 0,
                        })),
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
                    then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
                      return Promise.resolve({
                        data: [
                          {
                            from_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
                            to_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
                            type: "hard",
                          },
                          {
                            from_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
                            to_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
                            type: "hard",
                          },
                          {
                            from_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
                            to_node_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
                            type: "hard",
                          },
                        ],
                        error: null,
                      }).then(resolve);
                    },
                  };
                  return builder;
                }

                throw new Error(`Unexpected table: ${table}`);
              },
            }) as never,
        },
      },
    );

    expect(response.status).toBe(200);
    const cacheHitBody = await response.json();
    expect(cacheHitBody).toMatchObject({
      graph_id: "77777777-7777-4777-8777-777777777777",
      cached: true,
    });
    await vi.waitFor(() => {
      expect(triggerEnrichment).toHaveBeenCalledWith({
        graph_id: "77777777-7777-4777-8777-777777777777",
        request_id: expect.any(String),
      });
    });
  });

  it("continues generation when the curriculum validator times out", async () => {
    const store = createStoreClient();
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => {
            throw new ApiError(
              "UPSTREAM_TIMEOUT",
              "curriculum_validate timed out after 12000ms.",
              504,
            );
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("records detached curriculum failures without blocking the generate route", async () => {
    const store = createStoreClient();
    let curriculumCalls = 0;
    const persistAuditResult = vi.fn(async () => undefined);

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => {
            curriculumCalls += 1;
            return {
              valid: true,
            } as never;
          },
        },
        curriculumAuditDependencies: {
          runInTests: true,
          persistAuditResult,
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(curriculumCalls).toBe(1);
    expect(persistAuditResult).toHaveBeenCalledTimes(1);
    const firstPersistedAudit = persistAuditResult.mock.calls.at(0)?.at(0);
    expect(firstPersistedAudit).toMatchObject({
      audit_status: "skipped_contract_failure",
      outcome_bucket: "skipped_contract_failure",
      failure_category: "llm_contract_violation",
      async_audit: true,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("applies local canonicalize normalization without needing repair", async () => {
    const canonicalizeModes: string[] = [];

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async ({ mode }) => {
          canonicalizeModes.push(mode);
          return createCanonicalizeDraft({
            topic: " Trigonometry Foundations ",
            core_concepts: [
              " tangent ",
              "cosine.",
              "sine",
              "graphing patterns",
              "laws of sines and cosines",
              "radian measure",
              "trigonometric identities",
              "sine",
            ],
            prerequisites: [" Euclidean geometry ", "algebra."],
            downstream_topics: [" physics ", "calculus.", "statistics "],
          });
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.91,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(canonicalizeModes).toEqual(["draft"]);
  });

  it("uses grounded inventory matching for deterministic broad starter prompts", async () => {
    const callModel = vi.fn();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn calculus" }),
      }),
      {
        callModel,
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.93,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("uses one targeted repair call when the first canonical draft is underspecified", async () => {
    const canonicalizeModes: string[] = [];

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async ({ mode }) => {
          canonicalizeModes.push(mode);
          if (mode === "draft") {
            return createCanonicalizeDraft({
              core_concepts: ["sine", "sine", "cosine"],
            });
          }

          return createCanonicalizeDraft();
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.92,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(canonicalizeModes).toEqual(["draft", "repair"]);
  });

  it("stops immediately for non-learning prompts", async () => {
    const embedDescription = vi.fn();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "Tell me a joke" }),
      }),
      {
        callModel: async () => ({ error: "NOT_A_LEARNING_REQUEST" as const }),
        embedDescription,
      },
    );

    expect(response.status).toBe(400);
    expect(embedDescription).not.toHaveBeenCalled();
  });

  it("fails before retrieve and store when canonicalize cannot be repaired", async () => {
    const store = createStoreClient();
    const embedDescription = vi.fn();
    const searchRetrievalCandidates = vi.fn();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            core_concepts: ["sine", "sine", "cosine"],
            prerequisites: ["algebra"],
            downstream_topics: ["physics", "statistics", "calculus"],
          }),
        embedDescription,
        searchRetrievalCandidates,
        createServiceClient: () => store.client as never,
      }),
    ).rejects.toThrow();

    expect(embedDescription).not.toHaveBeenCalled();
    expect(searchRetrievalCandidates).not.toHaveBeenCalled();
    expect(store.rpc).not.toHaveBeenCalled();
  });

  it("falls back to demo canonicalization when draft times out and repair returns an invalid subject", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async ({ mode }) => {
          if (mode === "draft") {
            throw new ApiError(
              "UPSTREAM_TIMEOUT",
              "canonicalize draft timed out after 8000ms.",
              504,
            );
          }

          return {
            subject: "history",
            topic: "trigonometry",
            scope_summary:
              "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
            core_concepts: ["sine", "cosine", "tangent", "trigonometric identities"],
            prerequisites: ["algebra"],
            downstream_topics: ["calculus", "statistics", "physics"],
            level: "intermediate",
          } as never;
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

      expect(response.status).toBe(200);
      const incompleteCacheBody = await response.json();
      expect(incompleteCacheBody).toMatchObject({
        graph_id: "99999999-9999-4999-8999-999999999999",
        cached: false,
      });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a graph_id before incremental enrichment finishes", async () => {
    const store = createStoreClient();
    let releaseTrigger: (() => void) | null = null;
    const triggerEnrichment = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTrigger = resolve;
        }),
    );

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        triggerEnrichment,
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(triggerEnrichment).toHaveBeenCalledTimes(1);
    const resumeEnrichment = releaseTrigger as (() => void) | null;
    if (resumeEnrichment !== null) {
      resumeEnrichment();
    }
  });

  it("stores skeleton nodes with pending status and null content fields", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    expect(store.rpc).toHaveBeenCalledTimes(1);
    const storeCallPayload = store.rpc.mock.calls[0]?.[1] as
      | {
          p_nodes?: Array<{
            lesson_status: string;
            lesson_text: null;
            static_diagram: null;
            p5_code: null;
            quiz_json: null;
            diagnostic_questions: null;
            visual_verified: boolean;
          }>;
        }
      | undefined;
    expect(storeCallPayload?.p_nodes).toBeDefined();
    expect(
      storeCallPayload?.p_nodes?.every(
        (node) =>
          node.lesson_status === "pending" &&
          node.lesson_text === null &&
          node.static_diagram === null &&
          node.p5_code === null &&
          node.quiz_json === null &&
          node.diagnostic_questions === null &&
          node.visual_verified === false,
      ),
    ).toBe(true);
  });

  it("falls back to direct table writes when the skeleton store RPC is unavailable", async () => {
    const store = createFallbackStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        createUuid: vi
          .fn()
          .mockReturnValueOnce("99999999-9999-4999-8999-999999999999")
          .mockImplementation(() => randomUUID()),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        findExactDuplicateCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(store.inserted.graphs).toHaveLength(1);
    expect(store.inserted.nodes).toHaveLength(10);
    expect(store.inserted.edges).toHaveLength(DAY2_GRAPH_DRAFT.edges.length);
  });

  it("omits lesson_status in fallback node inserts when the live nodes surface does not expose it", async () => {
    const store = createFallbackStoreClient({
      supportsLessonStatus: false,
    });

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        createUuid: vi
          .fn()
          .mockReturnValueOnce("99999999-9999-4999-8999-999999999999")
          .mockImplementation(() => randomUUID()),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        findExactDuplicateCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const generatedGraphBody = await response.json();
    expect(generatedGraphBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(
      store.inserted.nodes.every(
        (node) => !Object.prototype.hasOwnProperty.call(node, "lesson_status"),
      ),
    ).toBe(true);
  });

  it("stores the skeleton even when delegated enrichment fails later", async () => {
    const store = createStoreClient();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        triggerEnrichment: async () => {
          throw new ApiError("DIAGNOSTICS_NODE_MISMATCH", "Bad node linkage.", 502);
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      }),
    ).resolves.toMatchObject({
      response: {
        graph_id: "99999999-9999-4999-8999-999999999999",
        cached: false,
      },
    });

    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to a simple live DAG when graph generation returns an invalid proposal", async () => {
    const store = createStoreClient();
    const structureValidatorCall = vi.fn();
    const curriculumValidatorCall = vi.fn();
    const reconcilerCall = vi.fn();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        graphGeneratorDependencies: {
          callModel: async () => ({
            nodes: DAY2_GRAPH_DRAFT.nodes,
            edges: [
              {
                from_node_id: "node_10",
                to_node_id: "node_1",
                type: "hard" as const,
              },
            ],
          }),
        },
        structureValidatorDependencies: {
          callModel: async () => {
            structureValidatorCall();
            return { valid: true, issues: [] };
          },
        },
        curriculumValidatorDependencies: {
          callModel: async () => {
            curriculumValidatorCall();
            return { valid: true, issues: [] };
          },
        },
        reconcilerDependencies: {
          callModel: async () => {
            reconcilerCall();
            return {
              nodes: DAY2_GRAPH_DRAFT.nodes,
              edges: DAY2_GRAPH_DRAFT.edges,
              resolution_summary: [],
            };
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      }),
    ).resolves.toMatchObject({
      response: {
        graph_id: "99999999-9999-4999-8999-999999999999",
        cached: false,
      },
    });

    expect(structureValidatorCall).toHaveBeenCalledTimes(2);
    expect(curriculumValidatorCall).not.toHaveBeenCalled();
    expect(reconcilerCall).toHaveBeenCalledTimes(2);
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps curriculum detached and still completes the generate pipeline when reconcile can stay deterministic", async () => {
    const store = createStoreClient();
    const reconcilerModes: number[] = [];

    const invalidReconciledEdges = DAY2_GRAPH_DRAFT.edges.map((edge, index) =>
      index === 0
        ? {
            from_node_id: "node_10",
            to_node_id: "node_1",
            type: "hard" as const,
          }
        : edge,
    );

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: "I want to learn the structure of the U.S. Constitution",
        }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => ({
            valid: false,
            issues: [
              {
                type: "incorrect_ordering" as const,
                severity: "minor" as const,
                nodes_involved: ["node_2"],
                missing_concept_title: null,
                description: "One concept appears slightly early.",
                suggested_fix: "Move the node later.",
                curriculum_basis:
                  "Most standard introductions sequence this concept after the foundation node.",
              },
            ],
          }),
        },
        reconcilerDependencies: {
          callModel: async () => {
            reconcilerModes.push(reconcilerModes.length + 1);
            if (reconcilerModes.length === 1) {
              return {
                nodes: DAY2_GRAPH_DRAFT.nodes,
                edges: invalidReconciledEdges,
                resolution_summary: [
                  {
                    issue_key: "curriculum:incorrect_ordering:node_2",
                    issue_source: "curriculum_validator" as const,
                    issue_description: "Initial repair returned one reversed hard edge.",
                    resolution_action: "Retry with corrected edge ordering.",
                  },
                ],
              };
            }

            return {
              nodes: DAY2_GRAPH_DRAFT.nodes,
              edges: DAY2_GRAPH_DRAFT.edges,
              resolution_summary: [
                {
                  issue_key: "curriculum:incorrect_ordering:node_2",
                  issue_source: "curriculum_validator" as const,
                  issue_description: "Corrected reversed hard edge ordering.",
                  resolution_action: "Restored forward prerequisite ordering.",
                },
              ],
            };
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const curricBody = await response.json();
    expect(curricBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(reconcilerModes).toEqual([]);
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a route-level boundary violation for arithmetic -> Arithmetic Basics", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn algebra" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            topic: "algebra",
            prerequisites: ["arithmetic"],
            downstream_topics: ["calculus", "physics", "statistics"],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle("node_1", "Arithmetic Basics"),
          }),
        },
        reconcilerDependencies: {
          callModel: async () => ({
            nodes: replaceNodeTitle("node_1", "Arithmetic Basics"),
            edges: DAY2_GRAPH_DRAFT.edges,
            resolution_summary: [
              {
                issue_key: "structure:boundary_violation:node_1",
                issue_source: "structure_validator" as const,
                issue_description:
                  'The graph includes assumed prior knowledge "arithmetic" as node content via token boundary matching.',
                resolution_action: "Kept the node unchanged.",
              },
            ],
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      status: "ready",
      graph_id: expect.any(String),
      diagnostic: expect.any(Object),
      topic: "algebra",
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("allows the top-level generate route for functions and their graphs -> Graphs of Tangent and Reciprocal Functions", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            prerequisites: ["functions and their graphs"],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle(
              "node_8",
              "Graphs of Tangent and Reciprocal Functions",
            ),
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const fallbackBody = await response.json();
    expect(fallbackBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("allows algebraic wording that does not exactly restate the algebra prerequisite", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn calculus" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            topic: "differential_calculus",
            prerequisites: ["algebra", "functions", "trigonometry"],
            downstream_topics: [
              "integral_calculus",
              "differential_equations",
              "multivariable_calculus",
            ],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle("node_5", "Limit Laws and Algebraic Evaluation"),
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const algebraBody = await response.json();
    expect(algebraBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("accepts downstream-topic leakage in live generation when the graph is otherwise usable", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn limits" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            topic: "limits",
            prerequisites: [
              "algebra",
              "functions and their graphs",
              "inequalities",
              "basic trigonometry",
            ],
            downstream_topics: [
              "differential_calculus",
              "derivatives",
              "continuity",
              "infinite_series",
              "integral_calculus",
            ],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle("node_10", "Limits and Continuity of Functions"),
          }),
        },
        reconcilerDependencies: {
          callModel: async () => ({
            nodes: replaceNodeTitle("node_10", "Limits and Continuity of Functions"),
            edges: DAY2_GRAPH_DRAFT.edges,
            resolution_summary: [
              {
                issue_key: "structure:boundary_violation:node_10",
                issue_source: "structure_validator" as const,
                issue_description:
                  'The graph includes downstream topic "continuity" as node content via token boundary matching.',
                resolution_action: "Kept the node because downstream scope leakage is tolerated in demo mode.",
              },
            ],
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const leakageBody = await response.json();
    expect(leakageBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("recovers a cyclic generator draft in live generation and still stores a graph", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn graph theory" }),
      }),
      {
        ...createStageDependencies(),
        graphGeneratorDependencies: {
          callModel: async () => buildCyclicGraphDraft(),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    const cyclicBody = await response.json();
    expect(cyclicBody).toMatchObject({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("sanitizes duplicate node ids and dangling edges in live generation instead of failing early", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn graph theory" }),
      }),
      {
        ...createStageDependencies(),
        graphGeneratorDependencies: {
          callModel: async () => buildDraftWithDuplicateIdsAndDanglingEdge(),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("falls back to a simple DAG in live generation when the generator draft is unrecoverable", async () => {
    const store = createFallbackStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn graph theory" }),
      }),
      {
        ...createStageDependencies(),
        graphGeneratorDependencies: {
          callModel: async () => buildSelfLoopDraft(),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      graph_id: expect.any(String),
    });
    expect(store.inserted.nodes).toHaveLength(10);
    expect(store.inserted.edges).toHaveLength(9);
  });
});

