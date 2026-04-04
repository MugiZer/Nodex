import { describe, expect, it } from "vitest";

import {
  createDbSchemaOutOfSyncError,
  createDbRpcOutOfSyncError,
  detectDbSurfaceAvailable,
  ensureDbRpcAvailable,
  isDbSchemaMismatchError,
  GRAPH_READ_NODES_SURFACE,
  STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  STORE_GENERATED_GRAPH_RPC_SURFACE,
} from "@/lib/server/db-contract";

describe("db contract diagnostics", () => {
  it("detects schema mismatch messages", () => {
    expect(
      isDbSchemaMismatchError({
        message: "column nodes.lesson_status does not exist",
      }),
    ).toBe(true);
  });

  it("preserves raw db error fields in the out-of-sync envelope", () => {
    const error = createDbSchemaOutOfSyncError(GRAPH_READ_NODES_SURFACE, {
      message: "",
      code: "42703",
      hint: "add the missing column",
      details: "column nodes.lesson_status does not exist",
      status: 400,
      statusCode: 400,
    });

    expect(error.code).toBe("DB_SCHEMA_OUT_OF_SYNC");
    expect(error.status).toBe(503);
    expect(error.details).toMatchObject({
      surface: "graph_read.nodes",
      source_table: "nodes",
      expected_select:
        "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
      cause_details: "column nodes.lesson_status does not exist",
      cause_code: "42703",
      cause_hint: "add the missing column",
      cause_status: 400,
      cause_status_code: 400,
    });
  });

  it("surfaces preferred write RPC schema drift with explicit function metadata", () => {
    const error = createDbRpcOutOfSyncError(STORE_GENERATED_GRAPH_RPC_SURFACE, {
      message: "could not find function",
      code: "PGRST202",
    });

    expect(error.code).toBe("DB_SCHEMA_OUT_OF_SYNC");
    expect(error.status).toBe(503);
    expect(error.details).toMatchObject({
      surface: "store.write_rpc.store_generated_graph",
      source_function: "store_generated_graph",
      expected_call: "store_generated_graph",
      cause: "could not find function",
      cause_code: "PGRST202",
    });
  });

  it("probes the preferred write RPC surface without relying on table reads", async () => {
    const rpc = async (name: string, args: Record<string, string>) => {
      expect(name).toBe("store_generated_graph");
      expect(args).toEqual({
        __codex_probe__: "db_contract_probe",
      });
      return {
        error: null,
      };
    };

    await expect(
      ensureDbRpcAvailable(
        {
          rpc,
        } as never,
        STORE_GENERATED_GRAPH_RPC_SURFACE,
      ),
    ).resolves.toBeUndefined();
  });

  it("raises DB_SCHEMA_OUT_OF_SYNC when the preferred write RPC is missing", async () => {
    await expect(
      ensureDbRpcAvailable(
        {
          rpc: async () => ({
            error: {
              message:
                "Could not find the function public.store_generated_graph(p_edges, p_embedding, p_graph, p_nodes) in the schema cache",
            },
          }),
        } as never,
        STORE_GENERATED_GRAPH_RPC_SURFACE,
      ),
    ).rejects.toMatchObject({
      code: "DB_SCHEMA_OUT_OF_SYNC",
      details: expect.objectContaining({
        surface: "store.write_rpc.store_generated_graph",
        source_function: "store_generated_graph",
      }),
    });
  });

  it("reports optional fallback lesson_status support when the column is present", async () => {
    await expect(
      detectDbSurfaceAvailable(
        {
          from: () => ({
            select: () => Promise.resolve({ data: [], error: null }),
          }),
        } as never,
        STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
      ),
    ).resolves.toBe(true);
  });

  it("reports optional fallback lesson_status support as false when the column is absent", async () => {
    await expect(
      detectDbSurfaceAvailable(
        {
          from: () => ({
            select: () =>
              Promise.resolve({
                data: null,
                error: {
                  message: "Could not find the 'lesson_status' column of 'nodes' in the schema cache",
                },
              }),
          }),
        } as never,
        STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
      ),
    ).resolves.toBe(false);
  });
});
