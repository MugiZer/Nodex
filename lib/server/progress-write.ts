import { ApiError } from "@/lib/errors";
import {
  createSupabaseServiceRoleClient,
  type FoundationSupabaseClient,
} from "@/lib/supabase";
import {
  edgeSchema,
  progressWriteRequestSchema,
  progressWriteResponseSchema,
  userProgressSchema,
} from "@/lib/schemas";
import type { ProgressWriteRequest, ProgressWriteResponse } from "@/lib/types";

import { type AuthDependencies } from "@/lib/server/auth";

export type ProgressWriteDependencies = AuthDependencies & {
  createServiceClient?: () => FoundationSupabaseClient;
  recordProgressAttempt?: (
    input: ProgressWriteRequest,
    userId: string,
  ) => Promise<ProgressWriteResponse>;
};

function getServiceClient(
  dependencies: ProgressWriteDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

function shouldDisallowRpcFallback(): boolean {
  return process.env.FOUNDATION_STRICT_DB_PATHS === "true";
}

async function writeProgressAttemptFallback(
  client: FoundationSupabaseClient,
  input: ProgressWriteRequest,
  userId: string,
): Promise<ProgressWriteResponse> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const { data: nodeRow, error: nodeError } = await client
    .from("nodes")
    .select("id,graph_id,graph_version,attempt_count,pass_count")
    .eq("id", input.node_id)
    .eq("graph_id", input.graph_id)
    .maybeSingle();

  if (nodeError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to load the target node for progress write.",
      500,
      { cause: nodeError.message },
    );
  }

  if (!nodeRow) {
    throw new ApiError(
      "NODE_NOT_FOUND",
      "The target node does not belong to the requested graph.",
      404,
    );
  }

  const completedNow = input.score >= 2;
  const { data: existingProgressRow, error: existingProgressError } = await client
    .from("user_progress")
    .select("id,user_id,node_id,graph_version,completed,attempts")
    .eq("user_id", userId)
    .eq("node_id", input.node_id)
    .eq("graph_version", nodeRow.graph_version)
    .maybeSingle();

  if (existingProgressError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to load existing learner progress.",
      500,
      { cause: existingProgressError.message },
    );
  }

  const nextAttempts = [
    ...((existingProgressRow?.attempts ?? []) as Array<{ score: number; timestamp: string }>),
    { score: input.score, timestamp },
  ];
  const nextCompleted = (existingProgressRow?.completed ?? false) || completedNow;

  const upsertResult = await client.from("user_progress").upsert(
    {
      id: existingProgressRow?.id,
      user_id: userId,
      node_id: input.node_id,
      graph_version: nodeRow.graph_version,
      completed: nextCompleted,
      attempts: nextAttempts,
    },
    { onConflict: "user_id,node_id,graph_version" },
  ).select("id,user_id,node_id,graph_version,completed,attempts").single();

  if (upsertResult.error) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to upsert learner progress.",
      500,
      { cause: upsertResult.error.message },
    );
  }

  const nodeUpdateResult = await client
    .from("nodes")
    .update({
      attempt_count: nodeRow.attempt_count + 1,
      pass_count: nodeRow.pass_count + (completedNow ? 1 : 0),
    })
    .eq("id", input.node_id)
    .eq("graph_id", input.graph_id)
    .select("attempt_count,pass_count")
    .single();

  if (nodeUpdateResult.error) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to update node attempt counters.",
      500,
      { cause: nodeUpdateResult.error.message },
    );
  }

  const attemptCount = nodeUpdateResult.data.attempt_count;
  const passCount = nodeUpdateResult.data.pass_count;
  const shouldFlagGraph = attemptCount > 10 && passCount / attemptCount < 0.4;

  if (shouldFlagGraph) {
    const flagUpdate = await client
      .from("graphs")
      .update({ flagged_for_review: true })
      .eq("id", input.graph_id);

    if (flagUpdate.error) {
      throw new ApiError(
        "PROGRESS_WRITE_FAILED",
        "Failed to update flagged_for_review on the graph.",
        500,
        { cause: flagUpdate.error.message },
      );
    }
  }

  const { data: nodeRows, error: nodeRowsError } = await client
    .from("nodes")
    .select("id")
    .eq("graph_id", input.graph_id);

  if (nodeRowsError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to load graph nodes for unlock computation.",
      500,
      { cause: nodeRowsError.message },
    );
  }

  const nodeIds = (nodeRows ?? []).map((row) => row.id);
  const { data: edgeRows, error: edgeRowsError } = await client
    .from("edges")
    .select("from_node_id,to_node_id,type")
    .in("from_node_id", nodeIds)
    .in("to_node_id", nodeIds);

  if (edgeRowsError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to load graph edges for unlock computation.",
      500,
      { cause: edgeRowsError.message },
    );
  }

  const parsedEdges = (edgeRows ?? []).map((row) => edgeSchema.parse(row));
  const { data: progressRows, error: progressRowsError } = await client
    .from("user_progress")
    .select("id,user_id,node_id,graph_version,completed,attempts")
    .eq("user_id", userId)
    .eq("graph_version", nodeRow.graph_version)
    .in("node_id", nodeIds);

  if (progressRowsError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to reload learner progress for unlock computation.",
      500,
      { cause: progressRowsError.message },
    );
  }

  const progress = (progressRows ?? []).map((row) => userProgressSchema.parse(row));
  const completedNodeIds = new Set(
    progress.filter((row) => row.completed).map((row) => row.node_id),
  );
  const availableNodeIds = nodeIds.filter((nodeId) =>
    parsedEdges
      .filter((edge) => edge.to_node_id === nodeId && edge.type === "hard")
      .every((edge) => completedNodeIds.has(edge.from_node_id)),
  );

  const { data: graphRow, error: graphRowError } = await client
    .from("graphs")
    .select("flagged_for_review")
    .eq("id", input.graph_id)
    .single();

  if (graphRowError) {
    throw new ApiError(
      "PROGRESS_WRITE_FAILED",
      "Failed to reload graph flag state.",
      500,
      { cause: graphRowError.message },
    );
  }

  return progressWriteResponseSchema.parse({
    progress: upsertResult.data,
    available_node_ids: availableNodeIds,
    flagged_for_review: graphRow.flagged_for_review,
  });
}

export async function writeProgressAttempt(
  input: ProgressWriteRequest,
  userId: string,
  dependencies: ProgressWriteDependencies = {},
): Promise<ProgressWriteResponse> {
  const parsedInput = progressWriteRequestSchema.parse(input);

  if (dependencies.recordProgressAttempt) {
    return dependencies.recordProgressAttempt(parsedInput, userId);
  }

  const client = getServiceClient(dependencies);
  const timestamp = parsedInput.timestamp ?? new Date().toISOString();
  const { data, error } = await client.rpc("record_progress_attempt", {
    p_graph_id: parsedInput.graph_id,
    p_node_id: parsedInput.node_id,
    p_user_id: userId,
    p_score: parsedInput.score,
    p_timestamp: timestamp,
  });

  if (error) {
    if (shouldDisallowRpcFallback()) {
      throw new ApiError(
        "PROGRESS_WRITE_FAILED",
        "Progress RPC is unavailable and strict DB paths are enabled.",
        500,
        { cause: error.message },
      );
    }

    console.warn(
      JSON.stringify({
        level: "warn",
        stage: "progress_write",
        event: "rpc_fallback",
        message: "Falling back to direct progress persistence because record_progress_attempt RPC is unavailable.",
        cause: error.message,
      }),
    );

    return writeProgressAttemptFallback(client, parsedInput, userId);
  }

  const validated = progressWriteResponseSchema.parse(data);
  return {
    progress: validated.progress,
    available_node_ids: validated.available_node_ids,
    flagged_for_review: validated.flagged_for_review,
  };
}
