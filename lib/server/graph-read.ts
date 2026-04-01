import { ApiError } from "@/lib/errors";
import {
  createSupabaseServiceRoleClient,
  type FoundationSupabaseClient,
} from "@/lib/supabase";
import {
  edgeSchema,
  graphSchema,
  nodeSchema,
  userProgressSchema,
} from "@/lib/schemas";
import type { GraphPayload } from "@/lib/types";

import { resolveAuthenticatedUserId, type AuthDependencies } from "@/lib/server/auth";

export type GraphReadDependencies = AuthDependencies & {
  createServiceClient?: () => FoundationSupabaseClient;
  fetchGraphPayload?: (graphId: string, userId: string) => Promise<GraphPayload>;
};

function getServiceClient(
  dependencies: GraphReadDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

export async function requireAuthenticatedUserId(
  request: Request,
  dependencies: GraphReadDependencies = {},
): Promise<string> {
  return resolveAuthenticatedUserId(request, dependencies);
}

export async function loadGraphPayload(
  graphId: string,
  userId: string,
  dependencies: GraphReadDependencies = {},
): Promise<GraphPayload> {
  if (dependencies.fetchGraphPayload) {
    return dependencies.fetchGraphPayload(graphId, userId);
  }

  const client = getServiceClient(dependencies);

  const { data: graphRow, error: graphError } = await client
    .from("graphs")
    .select("id,title,subject,topic,description,version,flagged_for_review,created_at")
    .eq("id", graphId)
    .maybeSingle();

  if (graphError) {
    throw new ApiError(
      "GRAPH_READ_FAILED",
      "Failed to load the requested graph.",
      500,
      { cause: graphError.message },
    );
  }

  if (!graphRow) {
    throw new ApiError("GRAPH_NOT_FOUND", "The requested graph does not exist.", 404);
  }

  const graph = graphSchema.parse(graphRow);

  const { data: nodeRows, error: nodeError } = await client
    .from("nodes")
    .select(
      "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count",
    )
    .eq("graph_id", graph.id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (nodeError) {
    throw new ApiError(
      "GRAPH_READ_FAILED",
      "Failed to load graph nodes.",
      500,
      { cause: nodeError.message },
    );
  }

  const nodes = (nodeRows ?? []).map((nodeRow) => nodeSchema.parse(nodeRow));
  const nodeIds = nodes.map((node) => node.id);

  if (nodeIds.length === 0) {
    return {
      graph,
      nodes,
      edges: [],
      progress: [],
    };
  }

  const edges = await loadEdgesForNodeIds(client, nodeIds, graphId);

  const { data: progressRows, error: progressError } = await client
    .from("user_progress")
    .select("id,user_id,node_id,graph_version,completed,attempts")
    .eq("user_id", userId)
    .eq("graph_version", graph.version)
    .in("node_id", nodeIds)
    .order("node_id", { ascending: true });

  if (progressError) {
    throw new ApiError(
      "GRAPH_READ_FAILED",
      "Failed to load learner progress for this graph.",
      500,
      { cause: progressError.message },
    );
  }

  const progress = (progressRows ?? []).map((progressRow) =>
    userProgressSchema.parse(progressRow),
  );

  return {
    graph,
    nodes,
    edges,
    progress,
  };
}

async function loadEdgesForNodeIds(
  client: FoundationSupabaseClient,
  nodeIds: string[],
  graphId: string,
): Promise<GraphPayload["edges"]> {
  const { data: edgeRows, error: edgeError } = await client
    .from("edges")
    .select("from_node_id,to_node_id,type")
    .in("from_node_id", nodeIds)
    .in("to_node_id", nodeIds);

  if (edgeError) {
    throw new ApiError(
      "GRAPH_READ_FAILED",
      "Failed to load graph edges.",
      500,
      { graphId, cause: edgeError.message },
    );
  }

  return (edgeRows ?? []).map((edgeRow) => edgeSchema.parse(edgeRow));
}
