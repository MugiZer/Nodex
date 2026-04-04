import { ApiError } from "@/lib/errors";
import type { FoundationSupabaseClient } from "@/lib/supabase";

export type DbSurfaceDefinition = {
  name: string;
  table: string;
  select: string;
};

export type DbRpcSurfaceDefinition = {
  name: string;
  function_name: "store_generated_graph";
  probe_arguments: Record<string, string>;
};

type DbErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

type DbLimitProbe = {
  limit: (count: number) => PromiseLike<{ error: unknown }>;
};

export const GRAPH_READ_GRAPH_SURFACE: DbSurfaceDefinition = {
  name: "graph_read.graph",
  table: "graphs",
  select: "id,title,subject,topic,description,version,flagged_for_review,created_at",
};

export const GRAPH_READ_NODES_SURFACE: DbSurfaceDefinition = {
  name: "graph_read.nodes",
  table: "nodes",
  select:
    "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
};

export const GRAPH_READ_EDGES_SURFACE: DbSurfaceDefinition = {
  name: "graph_read.edges",
  table: "edges",
  select: "from_node_id,to_node_id,type",
};

export const GRAPH_READ_PROGRESS_SURFACE: DbSurfaceDefinition = {
  name: "graph_read.progress",
  table: "user_progress",
  select: "id,user_id,node_id,graph_version,completed,attempts",
};

export const STORE_EXACT_DUPLICATE_SURFACE: DbSurfaceDefinition = {
  name: "store.duplicate_recheck.graphs",
  table: "graphs",
  select: "id, flagged_for_review, version, created_at",
};

export const RETRIEVE_FALLBACK_SURFACE: DbSurfaceDefinition = {
  name: "retrieve.fallback.graphs",
  table: "graphs",
  select: "id,subject,embedding,flagged_for_review,version,created_at",
};

export const STORE_GENERATED_GRAPH_RPC_SURFACE: DbRpcSurfaceDefinition = {
  name: "store.write_rpc.store_generated_graph",
  function_name: "store_generated_graph",
  probe_arguments: {
    __codex_probe__: "db_contract_probe",
  },
};

export const STORE_FALLBACK_GRAPHS_SURFACE: DbSurfaceDefinition = {
  name: "store.fallback_write.graphs",
  table: "graphs",
  select: "id,title,subject,topic,description,embedding,version,flagged_for_review",
};

export const STORE_FALLBACK_NODES_REQUIRED_SURFACE: DbSurfaceDefinition = {
  name: "store.fallback_write.nodes.required",
  table: "nodes",
  select:
    "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
};

export const STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE: DbSurfaceDefinition = {
  name: "store.fallback_write.nodes.optional_lesson_status",
  table: "nodes",
  select:
    "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,lesson_status,position,attempt_count,pass_count",
};

export const STORE_FALLBACK_EDGES_SURFACE: DbSurfaceDefinition = {
  name: "store.fallback_write.edges",
  table: "edges",
  select: "from_node_id,to_node_id,type",
};

function getDbErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "";
}

function serializeUnknownError(error: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(error));
  } catch {
    return String(error);
  }
}

function getDbErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") {
    return {};
  }

  const candidate = error as DbErrorLike;
  const details: Record<string, unknown> = {};

  if (typeof candidate.message === "string" && candidate.message.length > 0) {
    details.cause_message = candidate.message;
  }

  if (typeof candidate.code === "string" && candidate.code.length > 0) {
    details.cause_code = candidate.code;
  }

  if (typeof candidate.hint === "string" && candidate.hint.length > 0) {
    details.cause_hint = candidate.hint;
  }

  if (typeof candidate.details === "string" && candidate.details.length > 0) {
    details.cause_details = candidate.details;
  } else if (candidate.details !== undefined) {
    details.cause_details = candidate.details;
  }

  if (typeof candidate.status === "number") {
    details.cause_status = candidate.status;
  }

  if (typeof candidate.statusCode === "number") {
    details.cause_status_code = candidate.statusCode;
  }

  if (!("cause_message" in details)) {
    details.cause_raw = serializeUnknownError(error);
  }

  return details;
}

export function isDbSchemaMismatchError(error: unknown): boolean {
  const message = getDbErrorMessage(error).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function")
  );
}

export function createDbSchemaOutOfSyncError(
  surface: DbSurfaceDefinition,
  cause: unknown,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(
    "DB_SCHEMA_OUT_OF_SYNC",
    `Database schema is out of sync for ${surface.name}.`,
    503,
    {
      surface: surface.name,
      source_table: surface.table,
      expected_select: surface.select,
      cause: getDbErrorMessage(cause),
      ...getDbErrorDetails(cause),
      ...details,
    },
  );
}

export function createDbRpcOutOfSyncError(
  surface: DbRpcSurfaceDefinition,
  cause: unknown,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(
    "DB_SCHEMA_OUT_OF_SYNC",
    `Database schema is out of sync for ${surface.name}.`,
    503,
    {
      surface: surface.name,
      source_function: surface.function_name,
      expected_call: surface.function_name,
      cause: getDbErrorMessage(cause),
      ...getDbErrorDetails(cause),
      ...details,
    },
  );
}

async function probeDbSurfaceError(
  client: FoundationSupabaseClient,
  surface: DbSurfaceDefinition,
): Promise<unknown | null> {
  const { error: headError } = await client.from(surface.table).select(surface.select, {
    head: true,
    count: "exact",
  });

  if (!headError) {
    return null;
  }

  const headMessage = getDbErrorMessage(headError);
  let error: unknown = headError;

  if (headMessage.trim().length === 0) {
    try {
      const probe = client.from(surface.table).select(surface.select) as unknown as DbLimitProbe;
      if (typeof probe.limit === "function") {
        const limitResult = await probe.limit(0);
        if (limitResult.error) {
          error = limitResult.error;
        }
      }
    } catch {
      // Fall back to the original head probe error if the secondary probe fails.
    }
  }

  return error;
}

export async function ensureDbSurfaceAvailable(
  client: FoundationSupabaseClient,
  surface: DbSurfaceDefinition,
): Promise<void> {
  const error = await probeDbSurfaceError(client, surface);
  if (!error) {
    return;
  }

  if (isDbSchemaMismatchError(error)) {
    throw createDbSchemaOutOfSyncError(surface, error);
  }

  throw new ApiError(
    "DB_SURFACE_CHECK_FAILED",
    `Failed to verify database surface ${surface.name}.`,
    503,
    {
      surface: surface.name,
      source_table: surface.table,
      expected_select: surface.select,
      cause: getDbErrorMessage(error),
    },
  );
}

export async function detectDbSurfaceAvailable(
  client: FoundationSupabaseClient,
  surface: DbSurfaceDefinition,
): Promise<boolean> {
  const error = await probeDbSurfaceError(client, surface);
  if (!error) {
    return true;
  }

  if (isDbSchemaMismatchError(error)) {
    return false;
  }

  throw new ApiError(
    "DB_SURFACE_CHECK_FAILED",
    `Failed to verify database surface ${surface.name}.`,
    503,
    {
      surface: surface.name,
      source_table: surface.table,
      expected_select: surface.select,
      cause: getDbErrorMessage(error),
    },
  );
}

export async function ensureDbRpcAvailable(
  client: FoundationSupabaseClient,
  surface: DbRpcSurfaceDefinition,
): Promise<void> {
  const { error } = await client.rpc(
    surface.function_name,
    surface.probe_arguments as never,
  );

  if (!error) {
    return;
  }

  if (isDbSchemaMismatchError(error)) {
    throw createDbRpcOutOfSyncError(surface, error);
  }

  throw new ApiError(
    "DB_SURFACE_CHECK_FAILED",
    `Failed to verify database surface ${surface.name}.`,
    503,
    {
      surface: surface.name,
      source_function: surface.function_name,
      expected_call: surface.function_name,
      cause: getDbErrorMessage(error),
    },
  );
}

export async function ensureDbSurfacesAvailable(
  client: FoundationSupabaseClient,
  surfaces: DbSurfaceDefinition[],
): Promise<void> {
  await Promise.all(surfaces.map((surface) => ensureDbSurfaceAvailable(client, surface)));
}
