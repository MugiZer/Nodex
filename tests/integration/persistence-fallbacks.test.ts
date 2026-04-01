import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";
import { handleGraphReadRequest } from "@/app/api/graph/[id]/route";
import { handleProgressWriteRequest } from "@/app/api/progress/route";
import { loadGraphPayload } from "@/lib/server/graph-read";
import { retrieveGraphId } from "@/lib/server/retrieve";
import { writeProgressAttempt } from "@/lib/server/progress-write";
import type { GraphPayload, ProgressWriteResponse } from "@/lib/types";
import { TEST_GRAPH_ID, TEST_USER_ID, baseGraphPayloadFixture } from "../harness/fixtures";

type GraphReadQueryLogEntry = {
  table: "graphs" | "nodes" | "edges" | "user_progress";
  filters: {
    eq: Array<{ field: string; value: unknown }>;
    in: Array<{ field: string; values: unknown[] }>;
    order: Array<{ field: string; ascending: boolean }>;
  };
};

function createGraphReadServiceClient(payload: GraphPayload): {
  client: unknown;
  queryLog: GraphReadQueryLogEntry[];
} {
  const queryLog: GraphReadQueryLogEntry[] = [];

  const createTracker = () => ({
    eq: [] as Array<{ field: string; value: unknown }>,
    in: [] as Array<{ field: string; values: unknown[] }>,
    order: [] as Array<{ field: string; ascending: boolean }>,
  });

  const createBuilder = (table: GraphReadQueryLogEntry["table"]) => {
    const tracker = createTracker();

    const filterRows = <Row extends Record<string, unknown>>(
      rows: Row[],
    ): Row[] => {
      const filteredRows = rows.filter((row) =>
        tracker.eq.every((entry) => row[entry.field] === entry.value) &&
        tracker.in.every((entry) => entry.values.some((candidate) => candidate === row[entry.field])),
      );

      const orderedRows = tracker.order.length === 0
        ? filteredRows
        : [...filteredRows].sort((left, right) => {
            for (const entry of tracker.order) {
              const leftValue = left[entry.field];
              const rightValue = right[entry.field];
              if (leftValue === rightValue) {
                continue;
              }

              const comparison =
                typeof leftValue === "string" && typeof rightValue === "string"
                  ? leftValue.localeCompare(rightValue)
                  : Number(leftValue) - Number(rightValue);

              return entry.ascending ? comparison : -comparison;
            }

            return 0;
          });

      queryLog.push({
        table,
        filters: {
          eq: tracker.eq.map((entry) => ({ ...entry })),
          in: tracker.in.map((entry) => ({ field: entry.field, values: [...entry.values] })),
          order: tracker.order.map((entry) => ({ ...entry })),
        },
      });

      return orderedRows;
    };

    const builder = {
      select(fields?: string) {
        void fields;
        return builder;
      },
      eq(field: string, value: unknown) {
        tracker.eq.push({ field, value });
        return builder;
      },
      in(field: string, values: unknown[]) {
        tracker.in.push({ field, values: [...values] });
        return builder;
      },
      order(field: string, options?: { ascending?: boolean }) {
        tracker.order.push({ field, ascending: options?.ascending ?? true });
        return builder;
      },
      maybeSingle() {
        if (table !== "graphs") {
          throw new Error(`maybeSingle() is not supported for ${table}.`);
        }

        const rows = filterRows([payload.graph] as Array<Record<string, unknown>>);
        return Promise.resolve({
          data: rows[0] ?? null,
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
        let rows: Array<Record<string, unknown>> = [];

        if (table === "nodes") {
          rows = filterRows(payload.nodes as Array<Record<string, unknown>>);
        } else if (table === "edges") {
          rows = filterRows(payload.edges as Array<Record<string, unknown>>);
        } else if (table === "user_progress") {
          rows = filterRows(payload.progress as Array<Record<string, unknown>>);
        } else if (table === "graphs") {
          rows = filterRows([payload.graph] as Array<Record<string, unknown>>);
        }

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
        if (table === "graphs" || table === "nodes" || table === "edges" || table === "user_progress") {
          return createBuilder(table);
        }

        throw new Error(`Unexpected table access: ${table}`);
      },
    },
    queryLog,
  };
}

describe("persistence and auth hardening", () => {
  it("returns 401 for unauthenticated graph reads", async () => {
    const response = await handleGraphReadRequest(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}`),
      { params: Promise.resolve({ id: TEST_GRAPH_ID }) },
      {
        resolveAuthenticatedUserId: async () => {
          throw new ApiError(
            "UNAUTHENTICATED",
            "A valid Supabase learner session is required.",
            401,
          );
        },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "UNAUTHENTICATED",
    });
  });

  it("returns 401 for unauthenticated progress writes", async () => {
    const response = await handleProgressWriteRequest(
      new Request("http://localhost/api/progress", {
        method: "POST",
        body: JSON.stringify({
          graph_id: TEST_GRAPH_ID,
          node_id: baseGraphPayloadFixture.nodes[0]?.id,
          score: 2,
        }),
      }),
      {
        resolveAuthenticatedUserId: async () => {
          throw new ApiError(
            "UNAUTHENTICATED",
            "A valid Supabase learner session is required.",
            401,
          );
        },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "UNAUTHENTICATED",
    });
  });

  it("falls back to direct graph reads when retrieval RPC is unavailable", async () => {
    const candidateGraphId = "77777777-7777-4777-8777-777777777777";
    const fakeClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc unavailable" },
      }),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({
          data: [
            {
              id: candidateGraphId,
              embedding: `[${[1, 0, 0].join(",")}]`,
              flagged_for_review: false,
              version: 1,
              created_at: "2026-04-01T00:00:00.000Z",
            },
          ],
          error: null,
        }),
      }),
    };

    const result = await retrieveGraphId(
      {
        subject: "mathematics",
        description: "test description",
      },
      {
        createServiceClient: () => fakeClient as never,
        embedDescription: async () => [1, 0, 0],
      },
    );

    expect(result).toEqual({ graph_id: candidateGraphId });
  });

  it("falls back to direct table writes when progress RPC is unavailable", async () => {
    const graphPayload: GraphPayload = JSON.parse(
      JSON.stringify(baseGraphPayloadFixture),
    ) as GraphPayload;
    const targetNode = graphPayload.nodes[0];
    if (!targetNode) {
      throw new Error("Missing target node fixture.");
    }

    const progressState = new Map<string, ProgressWriteResponse["progress"]>();
    const nodeCounterState = new Map(
      graphPayload.nodes.map((node) => [
        node.id,
        { attempt_count: node.attempt_count, pass_count: node.pass_count },
      ]),
    );
    const graphState = { flagged_for_review: false };

    const fakeClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc unavailable" },
      }),
      from(table: string) {
        if (table === "nodes") {
          let selectedFields = "";
          let nodeUpdate:
            | {
                attempt_count: number;
                pass_count: number;
              }
            | null = null;

          const builder = {
            select(fields: string) {
              selectedFields = fields;
              return builder;
            },
            eq() {
              return builder;
            },
            update(value: { attempt_count: number; pass_count: number }) {
              nodeUpdate = value;
              return builder;
            },
            single() {
              if (nodeUpdate) {
                nodeCounterState.set(targetNode.id, nodeUpdate);
              }

              return Promise.resolve({
                data: nodeUpdate,
                error: null,
              });
            },
            maybeSingle() {
              if (selectedFields.includes("id,graph_id,graph_version,attempt_count,pass_count")) {
                return Promise.resolve({
                  data: {
                    id: targetNode.id,
                    graph_id: targetNode.graph_id,
                    graph_version: targetNode.graph_version,
                    attempt_count: nodeCounterState.get(targetNode.id)?.attempt_count ?? 0,
                    pass_count: nodeCounterState.get(targetNode.id)?.pass_count ?? 0,
                  },
                  error: null,
                });
              }

              return Promise.resolve({
                data: null,
                error: null,
              });
            },
            order() {
              return builder;
            },
            then(resolve: (value: unknown) => unknown) {
              if (selectedFields === "id") {
                return Promise.resolve({
                  data: graphPayload.nodes.map((node) => ({ id: node.id })),
                  error: null,
                }).then(resolve);
              }

              nodeCounterState.set(targetNode.id, nodeUpdate ?? nodeCounterState.get(targetNode.id) ?? {
                attempt_count: 0,
                pass_count: 0,
              });

              return Promise.resolve({
                data: nodeUpdate,
                error: null,
              }).then(resolve);
            },
          };

          return builder;
        }

        if (table === "user_progress") {
          const filters = new Map<string, string>();

          const builder = {
            select() {
              return builder;
            },
            eq(field: string, value: string) {
              filters.set(field, value);
              return builder;
            },
            maybeSingle() {
              const key = `${filters.get("user_id")}::${filters.get("node_id")}::${filters.get("graph_version")}`;
              return Promise.resolve({
                data: progressState.get(key) ?? null,
                error: null,
              });
            },
            upsert(value: ProgressWriteResponse["progress"]) {
              const normalizedValue: ProgressWriteResponse["progress"] = {
                ...value,
                id: value.id || "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              };
              const key = `${normalizedValue.user_id}::${normalizedValue.node_id}::${normalizedValue.graph_version}`;
              progressState.set(key, normalizedValue);
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: normalizedValue, error: null });
                    },
                  };
                },
              };
            },
            in() {
              const rows = Array.from(progressState.values()).map((row) => ({
                id: row.id,
                user_id: row.user_id,
                node_id: row.node_id,
                graph_version: row.graph_version,
                completed: row.completed,
                attempts: row.attempts,
              }));

              return Promise.resolve({
                data: rows,
                error: null,
              });
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
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({
                data: [
                  {
                    from_node_id: graphPayload.nodes[0]?.id,
                    to_node_id: graphPayload.nodes[1]?.id,
                    type: "hard",
                  },
                  {
                    from_node_id: graphPayload.nodes[1]?.id,
                    to_node_id: graphPayload.nodes[2]?.id,
                    type: "hard",
                  },
                ],
                error: null,
              }).then(resolve);
            },
          };

          return builder;
        }

        if (table === "graphs") {
          let graphUpdate: { flagged_for_review: boolean } | null = null;
          let selectedFields = "";

          const builder = {
            update(value: { flagged_for_review: boolean }) {
              graphUpdate = value;
              return builder;
            },
            eq() {
              if (graphUpdate) {
                graphState.flagged_for_review = graphUpdate.flagged_for_review;
                return Promise.resolve({ data: null, error: null });
              }

              return builder;
            },
            select(fields?: string) {
              selectedFields = fields ?? "";
              return builder;
            },
            single() {
              return Promise.resolve({
                data:
                  selectedFields === "flagged_for_review"
                    ? { flagged_for_review: graphState.flagged_for_review }
                    : null,
                error: null,
              });
            },
          };

          return builder;
        }

        throw new Error(`Unexpected table access: ${table}`);
      },
    };

    const result = await writeProgressAttempt(
      {
        graph_id: targetNode.graph_id,
        node_id: targetNode.id,
        score: 3,
        timestamp: "2026-04-01T12:20:00.000Z",
      },
      TEST_USER_ID,
      {
        createServiceClient: () => fakeClient as never,
      },
    );

    expect(result.progress.completed).toBe(true);
    expect(result.available_node_ids).toContain(graphPayload.nodes[1]?.id);
    expect(nodeCounterState.get(targetNode.id)).toEqual({
      attempt_count: 1,
      pass_count: 1,
    });
  });

  it("scopes graph reads to the authenticated learner through the real service module", async () => {
    const graphPayload: GraphPayload = JSON.parse(
      JSON.stringify(baseGraphPayloadFixture),
    ) as GraphPayload;

    graphPayload.progress = [
      graphPayload.progress[0] as GraphPayload["progress"][number],
      {
        ...(graphPayload.progress[0] as GraphPayload["progress"][number]),
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ];

    const fixture = createGraphReadServiceClient(graphPayload);
    const payload = await loadGraphPayload(TEST_GRAPH_ID, TEST_USER_ID, {
      createServiceClient: () => fixture.client as never,
    });

    expect(payload.progress).toHaveLength(1);
    expect(payload.progress[0]).toMatchObject({
      user_id: TEST_USER_ID,
      node_id: graphPayload.progress[0]?.node_id,
    });

    const progressQuery = fixture.queryLog.find((entry) => entry.table === "user_progress");
    expect(progressQuery).toMatchObject({
      table: "user_progress",
      filters: {
        eq: [
          { field: "user_id", value: TEST_USER_ID },
          { field: "graph_version", value: 1 },
        ],
        in: [
          {
            field: "node_id",
            values: graphPayload.nodes.map((node) => node.id),
          },
        ],
        order: [{ field: "node_id", ascending: true }],
      },
    });
  });
});
