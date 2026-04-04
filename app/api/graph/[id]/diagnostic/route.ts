import { NextResponse } from "next/server";

import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { graphDiagnosticRouteResponseSchema } from "@/lib/schemas";
import {
  requireAuthenticatedUserId,
  type GraphReadDependencies,
} from "@/lib/server/graph-read";
import { getGenerateRequestRecordByGraphId } from "@/lib/server/generation/request-store";

export const runtime = "nodejs";

export async function handleGraphDiagnosticRequest(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  dependencies: GraphReadDependencies = {},
): Promise<NextResponse> {
  try {
    const { id } = await params;
    await requireAuthenticatedUserId(request, dependencies);

    const record = getGenerateRequestRecordByGraphId(id);
    if (!record?.graph_diagnostic_result) {
      throw new ApiError(
        "GRAPH_DIAGNOSTIC_NOT_FOUND",
        "No stored prerequisite bundle was found for that graph.",
        404,
        {
          graph_id: id,
        },
      );
    }

    return NextResponse.json(
      graphDiagnosticRouteResponseSchema.parse(record.graph_diagnostic_result),
    );
  } catch (error) {
    return jsonError(normalizeError(error));
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return handleGraphDiagnosticRequest(request, context);
}
