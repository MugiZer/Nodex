import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { storeGeneratedGraph } from "@/lib/server/generation/store";
import { validateCanonicalDescription } from "@/lib/schemas";

const graphId = "22222222-2222-4222-8222-222222222222";
const nodeIdA = "33333333-3333-4333-8333-333333333333";
const nodeIdB = "44444444-4444-4444-8444-444444444444";

const baseGraph = {
  title: "Sample Graph",
  subject: "mathematics" as const,
  topic: "sample_topic",
  description:
    "Sample Topic is the study of a sample learning boundary. It encompasses foundations, applications, representations, and practice. It assumes prior knowledge of algebra and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the introductory level.",
};

function createQuizItem(index: number) {
  return {
    question: `Question ${index}`,
    options: ["A", "B", "C", "D"] as [string, string, string, string],
    correct_index: index % 4,
    explanation: `Explanation ${index}`,
  };
}

function createNode(index: number, verified = false): {
  id: string;
  title: string;
  position: number;
  lesson_text: string;
  static_diagram: string;
  p5_code: string;
  visual_verified: boolean;
  quiz_json: Array<{
    question: string;
    options: [string, string, string, string];
    correct_index: number;
    explanation: string;
  }>;
  diagnostic_questions: Array<{
    question: string;
    options: [string, string, string, string];
    correct_index: number;
    difficulty_order: number;
    node_id: string;
  }>;
  lesson_status: "ready";
} {
  const id = `node_${index}`;
  return {
    id,
    title: `Node ${index}`,
    position: index - 1,
    lesson_text: `Node ${index} lesson text.`,
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    p5_code: verified
      ? "function setup() { createCanvas(480, 320); } function draw() {}"
      : "",
    visual_verified: verified,
    quiz_json: [1, 2, 3].map((questionIndex) => createQuizItem(index + questionIndex - 1)),
    diagnostic_questions: [
      {
        question: `Diag ${index}`,
        options: ["A", "B", "C", "D"] as [string, string, string, string],
        correct_index: index % 4,
        difficulty_order: index,
        node_id: id,
      },
    ],
    lesson_status: "ready",
  };
}

function buildTestGraphNodes(): Array<ReturnType<typeof createNode>> {
  return [
    createNode(1, false),
    createNode(2, true),
    createNode(3, false),
    createNode(4, false),
    createNode(5, false),
    createNode(6, false),
    createNode(7, false),
    createNode(8, false),
    createNode(9, false),
    createNode(10, false),
  ];
}

function buildTestGraphEdges() {
  return Array.from({ length: 9 }, (_, index) => ({
    from_node_id: `node_${index + 1}`,
    to_node_id: `node_${index + 2}`,
    type: "hard" as const,
  }));
}

function createExactDuplicateQueryClient(rows: Array<Record<string, unknown>>) {
  const rpc = vi.fn();

  return {
    rpc,
    client: {
      from: vi.fn((table: string) => {
        if (table !== "graphs") {
          throw new Error(`Unexpected table access: ${table}`);
        }

        let selectClause = "";
        const resolveResult = () => {
          if (selectClause === "version") {
            return {
              data: [{ version: 1 }],
              error: null,
            };
          }

          return {
            data: rows,
            error: null,
          };
        };

        return {
          select(value: string) {
            selectClause = value;
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve(resolveResult());
          },
          then<TResult1 = Awaited<ReturnType<typeof resolveResult>>, TResult2 = never>(
            onfulfilled?:
              | ((value: Awaited<ReturnType<typeof resolveResult>>) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?:
              | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
              | null,
          ) {
            return Promise.resolve(resolveResult()).then(onfulfilled, onrejected);
          },
        };
      }),
      rpc,
    },
  };
}

describe("store helpers", () => {
  it("remaps temp ids into persisted UUIDs and rewrites embedded node refs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ graph_id: graphId }],
      error: null,
    });
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const nodes = buildTestGraphNodes();
    const createUuid = vi
      .fn()
      .mockImplementation(() => randomUUID())
      .mockReturnValueOnce(graphId)
      .mockReturnValueOnce(nodeIdA)
      .mockReturnValueOnce(nodeIdB);

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes,
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        findExactDuplicateCandidates: async () => [],
        searchRetrievalCandidates: async () => [],
        createUuid,
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
    });

    const rpcArgs = rpc.mock.calls[0]?.[1] as {
      p_graph: { id: string };
      p_nodes: Array<{ id: string; diagnostic_questions: Array<{ node_id: string }> }>;
      p_edges: Array<{ from_node_id: string; to_node_id: string }>;
    };

    expect(validateCanonicalDescription(baseGraph.description)).toBe(true);
    expect(rpcArgs.p_graph.id).toBe(graphId);
    expect(rpcArgs.p_nodes).toHaveLength(10);
    expect(rpcArgs.p_nodes[0]?.id).not.toBe("node_1");
    expect(rpcArgs.p_nodes[1]?.id).not.toBe("node_2");
    expect(rpcArgs.p_nodes[0]?.diagnostic_questions[0]?.node_id).toBe(rpcArgs.p_nodes[0]?.id);
    expect(rpcArgs.p_nodes[1]?.diagnostic_questions[0]?.node_id).toBe(rpcArgs.p_nodes[1]?.id);
    expect(rpcArgs.p_edges[0]?.from_node_id).toBe(rpcArgs.p_nodes[0]?.id);
    expect(rpcArgs.p_edges[0]?.to_node_id).toBe(rpcArgs.p_nodes[1]?.id);
  });

  it("does not short-circuit when only flagged duplicates exist", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ graph_id: graphId }],
      error: null,
    });
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        findExactDuplicateCandidates: async () => [],
        searchRetrievalCandidates: async () => [
          {
            id: graphId,
            similarity: 0.91,
            flagged_for_review: true,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("logs duplicate-safeguard decisions with candidate context", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const rpc = vi.fn();
    const duplicateCandidate = {
      id: graphId,
      similarity: 0.93,
      flagged_for_review: false,
      version: 2,
      created_at: "2026-04-01T00:00:00.000Z",
    };

    try {
      const result = await storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes: buildTestGraphNodes(),
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
          findExactDuplicateCandidates: async () => [],
          searchRetrievalCandidates: async () => [duplicateCandidate],
          createServiceClient: () =>
            ({
              from: vi.fn(),
              rpc,
            }) as never,
        },
      );

      expect(result).toMatchObject({
        graph_id: graphId,
        duplicate_of_graph_id: graphId,
      });
      expect(rpc).not.toHaveBeenCalled();

      const duplicateLog = logSpy.mock.calls
        .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
        .find((entry) => entry.message === "Store duplicate safeguard returned existing graph.");

      expect(duplicateLog).toMatchObject({
        duplicate_reason: "usable_unflagged_match",
        duplicate_candidate_id: graphId,
        duplicate_candidate_similarity: 0.93,
        duplicate_candidate_flagged_for_review: false,
        duplicate_lookup_mode: "semantic",
        graph_identity_fingerprint: expect.any(String),
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("short-circuits exact duplicates before semantic duplicate search", async () => {
    const rpc = vi.fn();
    const searchRetrievalCandidates = vi.fn(async () => {
      throw new Error("semantic duplicate search should not run when exact match exists");
    });
    const exactCandidate = {
      id: graphId,
      similarity: 1,
      flagged_for_review: false,
      version: 2,
      created_at: "2026-04-01T00:00:00.000Z",
    };

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        findExactDuplicateCandidates: async () => [exactCandidate],
        searchRetrievalCandidates,
        createServiceClient: () =>
          ({
            from: vi.fn(),
            rpc,
          }) as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
      duplicate_of_graph_id: graphId,
    });
    expect(searchRetrievalCandidates).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("short-circuits exact duplicates when the DB row returns a naive created_at timestamp", async () => {
    const searchRetrievalCandidates = vi.fn(async () => {
      throw new Error("semantic duplicate search should not run when exact match exists");
    });
    const serviceClient = createExactDuplicateQueryClient([
      {
        id: graphId,
        flagged_for_review: false,
        version: 2,
        created_at: "2026-04-03T18:49:09",
      },
    ]);

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        searchRetrievalCandidates,
        createServiceClient: () => serviceClient.client as never,
      },
    );

    expect(result).toMatchObject({
      graph_id: graphId,
      duplicate_of_graph_id: graphId,
    });
    expect(searchRetrievalCandidates).not.toHaveBeenCalled();
  });

  it("surfaces duplicate-candidate parse boundaries when exact duplicate rows are invalid", async () => {
    const serviceClient = createExactDuplicateQueryClient([
      {
        id: graphId,
        flagged_for_review: false,
        version: 2,
        created_at: "not-a-timestamp",
      },
    ]);

    await expect(
      storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes: buildTestGraphNodes(),
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
          createServiceClient: () => serviceClient.client as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "STORE_UNEXPECTED_INTERNAL",
      details: expect.objectContaining({
        schema: "retrievalCandidateSchema",
        phase: "store.duplicate_recheck.read_parse",
      }),
    });
  });

  it("raises DB_SCHEMA_OUT_OF_SYNC when the exact-duplicate graph surface is missing a required column", async () => {
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return Promise.resolve({
            data: null,
            error: { message: "column graphs.created_at does not exist" },
          });
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: { data: null; error: { message: string } }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ) {
          return Promise.resolve({
            data: null,
            error: { message: "column graphs.created_at does not exist" },
          }).then(onfulfilled, onrejected);
        },
      })),
      rpc: vi.fn(),
    };

    await expect(
      storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes: buildTestGraphNodes(),
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
          createServiceClient: () => serviceClient as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "DB_SCHEMA_OUT_OF_SYNC",
      details: expect.objectContaining({
        surface: "store.duplicate_recheck.graphs",
        source_table: "graphs",
      }),
    });
  });

  it("falls back to direct table writes when the store RPC is unavailable", async () => {
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
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "graphs") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return graphsQuery();
            },
            insert(value: Record<string, unknown>) {
              inserted.graphs.push(value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }

        if (table === "nodes") {
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.nodes.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({ data: null, error: null });
            },
          };
        }

        if (table === "edges") {
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.edges.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({ data: null, error: null });
            },
          };
        }

        throw new Error(`Unexpected table access: ${table}`);
      }),
      rpc,
    };

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        findExactDuplicateCandidates: async () => [],
        searchRetrievalCandidates: async () => [],
        createUuid: vi
          .fn()
          .mockImplementation(() => randomUUID())
          .mockReturnValueOnce(graphId),
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result.graph_id).toBe(graphId);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(inserted.graphs).toHaveLength(1);
    expect(inserted.nodes).toHaveLength(10);
    expect(inserted.edges).toHaveLength(9);
    expect(inserted.graphs[0]).toMatchObject({
      id: graphId,
      title: baseGraph.title,
      subject: baseGraph.subject,
      topic: baseGraph.topic,
    });
  });

  it("rolls back partial fallback writes when a downstream insert fails", async () => {
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
    const deleted = {
      graphs: 0,
      nodes: 0,
      edges: 0,
    };
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "graphs") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [{ version: 1 }],
                error: null,
              });
            },
            insert(value: Record<string, unknown>) {
              inserted.graphs.push(value);
              return Promise.resolve({ data: null, error: null });
            },
            delete() {
              return {
                eq() {
                  deleted.graphs += 1;
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        }

        if (table === "nodes") {
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.nodes.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({
                data: null,
                error: {
                  message:
                    "Could not find the 'lesson_status' column of 'nodes' in the schema cache",
                },
              });
            },
            delete() {
              return {
                eq() {
                  deleted.nodes += 1;
                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        }

        if (table === "edges") {
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.edges.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({ data: null, error: null });
            },
            delete() {
              let deletedOnce = false;
              return {
                in() {
                  return this;
                },
                eq() {
                  return Promise.resolve({ data: null, error: null });
                },
                then<TResult1 = unknown, TResult2 = never>(
                  onfulfilled?:
                    | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
                    | null,
                  onrejected?:
                    | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                    | null,
                ) {
                  if (!deletedOnce) {
                    deleted.edges += 1;
                    deletedOnce = true;
                  }
                  return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table access: ${table}`);
      }),
      rpc,
    };

    await expect(
      storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes: buildTestGraphNodes(),
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
          findExactDuplicateCandidates: async () => [],
          searchRetrievalCandidates: async () => [],
          createUuid: vi
            .fn()
            .mockImplementation(() => randomUUID())
            .mockReturnValueOnce(graphId),
          createServiceClient: () => serviceClient as never,
        },
      ),
    ).rejects.toMatchObject({
      code: "DB_SCHEMA_OUT_OF_SYNC",
    });

    expect(inserted.graphs).toHaveLength(1);
    expect(inserted.nodes).toHaveLength(10);
    expect(deleted.graphs).toBe(1);
    expect(deleted.nodes).toBe(1);
    expect(deleted.edges).toBe(1);
  });

  it("omits lesson_status in fallback node inserts when the live nodes surface does not expose it", async () => {
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
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "graphs") {
          let selectedFields = "";
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              selectedFields = fields ?? "";
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return graphsQuery();
            },
            insert(value: Record<string, unknown>) {
              inserted.graphs.push(value);
              return Promise.resolve({ data: null, error: null });
            },
            then<TResult1 = unknown, TResult2 = never>(
              onfulfilled?:
                | ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ) {
              return Promise.resolve({
                data: selectedFields === "version" ? [{ version: 1 }] : [],
                error: null,
              }).then(onfulfilled, onrejected);
            },
          };
        }

        if (table === "nodes") {
          let selectedFields = "";
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              selectedFields = fields ?? "";
              if (options?.head) {
                if (selectedFields.includes("lesson_status")) {
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
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.nodes.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({ data: null, error: null });
            },
          };
        }

        if (table === "edges") {
          return {
            select(fields?: string, options?: { head?: boolean; count?: string }) {
              if (options?.head) {
                return Promise.resolve({ data: [], error: null });
              }
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
            insert(value: Array<Record<string, unknown>> | Record<string, unknown>) {
              inserted.edges.push(...(Array.isArray(value) ? value : [value]));
              return Promise.resolve({ data: null, error: null });
            },
          };
        }

        throw new Error(`Unexpected table access: ${table}`);
      }),
      rpc,
    };

    const result = await storeGeneratedGraph(
      {
        graph: baseGraph,
        nodes: buildTestGraphNodes(),
        edges: buildTestGraphEdges(),
      },
      undefined,
      {
        precomputedEmbedding: new Array(1536).fill(0).map((_, index) => (index === 0 ? 1 : 0)),
        findExactDuplicateCandidates: async () => [],
        searchRetrievalCandidates: async () => [],
        createUuid: vi
          .fn()
          .mockImplementation(() => randomUUID())
          .mockReturnValueOnce(graphId),
        createServiceClient: () => serviceClient as never,
      },
    );

    expect(result.graph_id).toBe(graphId);
    expect(
      inserted.nodes.every(
        (node) => !Object.prototype.hasOwnProperty.call(node, "lesson_status"),
      ),
    ).toBe(true);
  });

  it("rejects restricted p5 code before persistence", async () => {
    const rpc = vi.fn();
    const graphsQuery = vi.fn().mockResolvedValue({
      data: [{ version: 1 }],
      error: null,
    });
    const serviceClient = {
      from: vi.fn(() => ({
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return graphsQuery();
        },
      })),
      rpc,
    };

    const nodes = buildTestGraphNodes();
    nodes[1] = {
      ...nodes[1],
      visual_verified: true,
      p5_code:
        "function setup() { createCanvas(480, 320); fetch('https://example.com'); } function draw() {}",
    };

    await expect(
      storeGeneratedGraph(
        {
          graph: baseGraph,
          nodes,
          edges: buildTestGraphEdges(),
        },
        undefined,
        {
          precomputedEmbedding: new Array(1536).fill(0).map((_, index) =>
            index === 0 ? 1 : 0,
          ),
          findExactDuplicateCandidates: async () => [],
          searchRetrievalCandidates: async () => [],
          createServiceClient: () => serviceClient as never,
        },
      ),
    ).rejects.toThrow(/restricted snippets/i);

    expect(rpc).not.toHaveBeenCalled();
  });
});
