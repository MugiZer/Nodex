import { NextResponse } from "next/server";

import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import { graphPayloadSchema } from "@/lib/schemas";
import {
  loadGraphPayload,
  requireAuthenticatedUserId,
  type GraphReadDependencies,
} from "@/lib/server/graph-read";

export const dynamic = "force-dynamic";

export async function handleGraphReadRequest(
  request: Request,
  context: { params: Promise<{ id: string }> },
  dependencies: GraphReadDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("GET /api/graph/[id]");

  try {
    logInfo(logContext, "graph_read", "start", "Loading graph payload.");

    const { id } = await context.params;
    const userId = await requireAuthenticatedUserId(request, dependencies);
    const payload = await loadGraphPayload(id, userId, dependencies);
    const validated = graphPayloadSchema.parse(payload);

    if (validated.nodes.length === 0) {
      throw new ApiError(
        "GRAPH_INCOMPLETE",
        "The graph payload is incomplete: no nodes were persisted for this graph version.",
        503,
        {
          graph_id: id,
          graph_version: validated.graph.version,
        },
      );
    }

    logInfo(logContext, "graph_read", "success", "Graph payload loaded.", {
      graph_id: validated.graph.id,
      graph_version: validated.graph.version,
      user_id: userId.slice(0, 8),
    });

    return NextResponse.json(validated);
  } catch (error) {
    logError(logContext, "graph_read", "Graph payload load failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleGraphReadRequest(request, context);
}
