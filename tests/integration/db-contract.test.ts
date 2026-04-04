import { describe, expect, it } from "vitest";

import {
  detectDbSurfaceAvailable,
  ensureDbRpcAvailable,
  ensureDbSurfacesAvailable,
} from "@/lib/server/db-contract";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import {
  GRAPH_READ_EDGES_SURFACE,
  GRAPH_READ_GRAPH_SURFACE,
  GRAPH_READ_NODES_SURFACE,
  GRAPH_READ_PROGRESS_SURFACE,
  RETRIEVE_FALLBACK_SURFACE,
  STORE_FALLBACK_EDGES_SURFACE,
  STORE_FALLBACK_GRAPHS_SURFACE,
  STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  STORE_FALLBACK_NODES_REQUIRED_SURFACE,
  STORE_EXACT_DUPLICATE_SURFACE,
  STORE_GENERATED_GRAPH_RPC_SURFACE,
} from "@/lib/server/db-contract";

const hasLiveDbContractEnv =
  process.env.RUN_LIVE_DB_CONTRACT_TEST === "true" &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("live db contract", () => {
  const liveTest = hasLiveDbContractEnv ? it : it.skip;

  liveTest("verifies the required read surfaces against live Supabase", async () => {
    const client = createSupabaseServiceRoleClient();
    await expect(
      ensureDbSurfacesAvailable(client, [
        GRAPH_READ_GRAPH_SURFACE,
        GRAPH_READ_NODES_SURFACE,
        GRAPH_READ_EDGES_SURFACE,
        GRAPH_READ_PROGRESS_SURFACE,
        STORE_EXACT_DUPLICATE_SURFACE,
        RETRIEVE_FALLBACK_SURFACE,
        STORE_FALLBACK_GRAPHS_SURFACE,
        STORE_FALLBACK_NODES_REQUIRED_SURFACE,
        STORE_FALLBACK_EDGES_SURFACE,
      ]),
    ).resolves.toBeUndefined();
  });

  liveTest("verifies the preferred write RPC and records optional fallback lesson_status support", async () => {
    const client = createSupabaseServiceRoleClient();

    await expect(
      ensureDbRpcAvailable(client, STORE_GENERATED_GRAPH_RPC_SURFACE),
    ).resolves.toBeUndefined();

    await expect(
      detectDbSurfaceAvailable(client, STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE),
    ).resolves.toBeTypeOf("boolean");
  });
});
