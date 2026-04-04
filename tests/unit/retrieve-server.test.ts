import { describe, expect, it, vi } from "vitest";

import { loadRetrievalCandidates, retrieveGraphId } from "@/lib/server/retrieve";

describe("server retrieval candidate parsing", () => {
  it("accepts Supabase-style +00:00 timestamps from the retrieval RPC", async () => {
    const candidates = await loadRetrievalCandidates(
      "mathematics",
      [1, 0, 0],
      {
        createServiceClient: () =>
          ({
            rpc: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  similarity: 0.93,
                  flagged_for_review: false,
                  version: 2,
                  created_at: "2026-04-01T12:00:00+00:00",
                },
              ],
              error: null,
            }),
          }) as never,
      },
    );

    expect(candidates).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        similarity: 0.93,
        flagged_for_review: false,
        version: 2,
        created_at: "2026-04-01T12:00:00+00:00",
      },
    ]);
  });

  it("normalizes Postgres timestamptz space-separated timestamps from the retrieval RPC", async () => {
    const candidates = await loadRetrievalCandidates(
      "mathematics",
      [1, 0, 0],
      {
        createServiceClient: () =>
          ({
            rpc: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "11111111-1111-4111-8111-111111111112",
                  similarity: 0.91,
                  flagged_for_review: false,
                  version: 2,
                  created_at: "2025-06-23 16:42:07.869646+00",
                },
              ],
              error: null,
            }),
          }) as never,
      },
    );

    expect(candidates[0]?.created_at).toBe("2025-06-23T16:42:07.869646+00:00");
  });

  it("normalizes naive DB timestamps from the retrieval RPC before ranking candidates", async () => {
    const candidates = await loadRetrievalCandidates(
      "mathematics",
      [1, 0, 0],
      {
        createServiceClient: () =>
          ({
            rpc: vi.fn().mockResolvedValue({
              data: [
                {
                  id: "11111111-1111-4111-8111-111111111113",
                  similarity: 0.89,
                  flagged_for_review: false,
                  version: 4,
                  created_at: "2026-04-03T18:49:09",
                },
              ],
              error: null,
            }),
          }) as never,
      },
    );

    expect(candidates[0]?.created_at).toBe("2026-04-03T18:49:09Z");
  });

  it("raises DB_SCHEMA_OUT_OF_SYNC when the fallback graph surface is missing a required column", async () => {
    await expect(
      loadRetrievalCandidates("mathematics", [1, 0, 0], {
        createServiceClient: () =>
          ({
            rpc: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "rpc unavailable" },
            }),
            from: vi.fn().mockReturnValue({
              select: vi.fn((_, options?: { head?: boolean }) => {
                if (options?.head) {
                  return Promise.resolve({
                    data: [],
                    error: { message: "column graphs.created_at does not exist" },
                  });
                }

                return {
                  eq: vi.fn().mockReturnThis(),
                  not: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: "column graphs.created_at does not exist" },
                  }),
                };
              }),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "column graphs.created_at does not exist" },
              }),
            }),
          }) as never,
      }),
    ).rejects.toMatchObject({
      code: "DB_SCHEMA_OUT_OF_SYNC",
      details: expect.objectContaining({
        surface: "retrieve.fallback.graphs",
        source_table: "graphs",
      }),
    });
  });

  it("rejects a cached graph id when the persisted skeleton is incomplete", async () => {
    const rowsByTable = {
      nodes: [] as Array<Record<string, unknown>>,
      edges: [] as Array<Record<string, unknown>>,
    };

    const builderFor = (table: "nodes" | "edges") => {
      let selectedFields = "";
      const builder = {
        select(fields?: string, options?: { head?: boolean; count?: string }) {
          selectedFields = fields ?? "";
          if (options?.head) {
            return Promise.resolve({ data: [], error: null });
          }
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: selectedFields === "id" ? rowsByTable[table] : [],
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
            data: selectedFields === "id" ? rowsByTable[table] : [],
            error: null,
          }).then(onfulfilled, onrejected);
        },
      };

      return builder;
    };

    const result = await retrieveGraphId(
      {
        subject: "mathematics",
        description: "The study of trigonometric functions and their graphs.",
      },
      {
        searchRetrievalCandidates: async () => [
          {
            id: "11111111-1111-4111-8111-111111111111",
            similarity: 0.95,
            flagged_for_review: false,
            version: 1,
            created_at: "2026-04-03T18:49:09Z",
          },
        ],
        embedDescription: async () => [1, 0, 0],
        createServiceClient: () =>
          ({
            from(table: string) {
              if (table === "nodes") {
                return builderFor("nodes");
              }

              if (table === "edges") {
                return builderFor("edges");
              }

              throw new Error(`Unexpected table access: ${table}`);
            },
          }) as never,
      },
    );

    expect(result.graph_id).toBeNull();
  });
});
