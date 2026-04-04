import { ApiError } from "@/lib/errors";
import {
  createSupabaseServiceRoleClient,
  type FoundationSupabaseClient,
} from "@/lib/supabase";
import {
  lessonStatusSchema,
  edgeSchema,
  graphSchema,
  nodeSchema,
  userProgressSchema,
} from "@/lib/schemas";
import { parseSchemaOrThrow } from "@/lib/server/schema-parse";
import type { GraphPayload } from "@/lib/types";
import type { Database } from "@/supabase/database.types";
import {
  ensureDbSurfacesAvailable,
  GRAPH_READ_EDGES_SURFACE,
  GRAPH_READ_GRAPH_SURFACE,
  GRAPH_READ_NODES_SURFACE,
  GRAPH_READ_PROGRESS_SURFACE,
} from "@/lib/server/db-contract";

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

type EdgeRow = Database["public"]["Tables"]["edges"]["Row"];
type ProgressRow = Database["public"]["Tables"]["user_progress"]["Row"];
type NodeRow = Omit<Database["public"]["Tables"]["nodes"]["Row"], "lesson_status"> & {
  lesson_status?: Database["public"]["Tables"]["nodes"]["Row"]["lesson_status"] | null;
};

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
  await ensureDbSurfacesAvailable(client, [
    GRAPH_READ_GRAPH_SURFACE,
    GRAPH_READ_NODES_SURFACE,
    GRAPH_READ_EDGES_SURFACE,
    GRAPH_READ_PROGRESS_SURFACE,
  ]);

  const { data: graphRow, error: graphError } = await client
    .from("graphs")
    .select(GRAPH_READ_GRAPH_SURFACE.select)
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

  const graph = parseSchemaOrThrow({
    schema: graphSchema,
    value: graphRow,
    errorCode: "GRAPH_READ_FAILED",
    message: "Failed to parse graph row returned from graphs.",
    schemaName: "graphSchema",
    phase: "graph_read.graph.read_parse",
    details: {
      graph_id: graphId,
    },
  });

  const { data: nodeRows, error: nodeError } = await client
    .from("nodes")
    .select(GRAPH_READ_NODES_SURFACE.select)
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

  const typedNodeRows = (nodeRows ?? []) as unknown as NodeRow[];

  const nodes = typedNodeRows.map((nodeRow) =>
    parseSchemaOrThrow({
      schema: nodeSchema,
      value: {
        ...nodeRow,
        lesson_status: deriveLessonStatus(nodeRow),
      },
      errorCode: "GRAPH_READ_FAILED",
      message: "Failed to parse node row returned from nodes.",
      schemaName: "nodeSchema",
      phase: "graph_read.nodes.read_parse",
      details: {
        graph_id: graphId,
        node_id:
          typeof nodeRow === "object" && nodeRow !== null && "id" in nodeRow
            ? String(nodeRow.id)
            : null,
      },
    }),
  );
  if (nodes.length === 0) {
    throw new ApiError(
      "GRAPH_INCOMPLETE",
      "The graph payload is incomplete: no nodes were persisted for this graph version.",
      503,
      {
        graph_id: graphId,
        graph_version: graph.version,
      },
    );
  }
  const nodeIds = nodes.map((node) => node.id);

  const edges = await loadEdgesForNodeIds(client, nodeIds, graphId);

  const { data: progressRows, error: progressError } = await client
    .from("user_progress")
    .select(GRAPH_READ_PROGRESS_SURFACE.select)
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

  const typedProgressRows = (progressRows ?? []) as unknown as ProgressRow[];

  const progress = typedProgressRows.map((progressRow) =>
    parseSchemaOrThrow({
      schema: userProgressSchema,
      value: progressRow,
      errorCode: "GRAPH_READ_FAILED",
      message: "Failed to parse learner progress row returned from user_progress.",
      schemaName: "userProgressSchema",
      phase: "graph_read.progress.read_parse",
      details: {
        graph_id: graphId,
      },
    }),
  );

  return {
    graph,
    nodes,
    edges,
    progress,
  };
}

function deriveLessonStatus(nodeRow: NodeRow): Database["public"]["Tables"]["nodes"]["Row"]["lesson_status"] {
  const explicitStatus = lessonStatusSchema.safeParse(nodeRow.lesson_status);
  const hasLessonArtifacts =
    (typeof nodeRow.lesson_text === "string" && nodeRow.lesson_text.trim().length > 0) ||
    (typeof nodeRow.static_diagram === "string" && nodeRow.static_diagram.trim().length > 0) ||
    (typeof nodeRow.p5_code === "string" && nodeRow.p5_code.trim().length > 0) ||
    nodeRow.quiz_json !== null ||
    nodeRow.diagnostic_questions !== null;

  if (hasLessonArtifacts) {
    return "ready";
  }

  if (explicitStatus.success) {
    return explicitStatus.data;
  }

  return "pending";
}

async function loadEdgesForNodeIds(
  client: FoundationSupabaseClient,
  nodeIds: string[],
  graphId: string,
): Promise<GraphPayload["edges"]> {
  const { data: edgeRows, error: edgeError } = await client
    .from("edges")
    .select(GRAPH_READ_EDGES_SURFACE.select)
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

  const typedEdgeRows = (edgeRows ?? []) as unknown as EdgeRow[];

  return typedEdgeRows.map((edgeRow) =>
    parseSchemaOrThrow({
      schema: edgeSchema,
      value: edgeRow,
      errorCode: "GRAPH_READ_FAILED",
      message: "Failed to parse edge row returned from edges.",
      schemaName: "edgeSchema",
      phase: "graph_read.edges.read_parse",
      details: {
        graph_id: graphId,
      },
    }),
  );
}
