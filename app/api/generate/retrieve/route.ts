import { NextResponse } from "next/server";

import { retrieveRequestSchema, retrieveResponseSchema } from "@/lib/schemas";
import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { retrieveGraphId, type RetrievalDependencies } from "@/lib/server/retrieve";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";

export const runtime = "nodejs";

export async function handleRetrieveRequest(
  request: Request,
  dependencies: RetrievalDependencies = {},
): Promise<NextResponse> {
  const context = createRequestLogContext("POST /api/generate/retrieve");

  try {
    const body = await request.json().catch(() => null);
    const parsed = retrieveRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST_BODY",
        "Expected body with { subject, description }.",
        400,
        parsed.error.flatten(),
      );
    }

    logInfo(context, "retrieve", "start", "Retrieve route received request");
    const result = await retrieveGraphId(parsed.data, dependencies);
    retrieveResponseSchema.parse(result);
    logInfo(context, "retrieve", "success", "Retrieve route completed", {
      graph_id: result.graph_id,
    });
    return NextResponse.json(result);
  } catch (error) {
    const normalized = normalizeError(error);
    logError(context, "retrieve", "Retrieve route failed", normalized);
    return jsonError(normalized);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleRetrieveRequest(request);
}
