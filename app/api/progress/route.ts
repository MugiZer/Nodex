import { NextResponse } from "next/server";

import { jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  progressWriteRequestSchema,
  progressWriteResponseSchema,
} from "@/lib/schemas";
import {
  requireAuthenticatedUserId,
  type GraphReadDependencies,
} from "@/lib/server/graph-read";
import {
  type ProgressWriteDependencies,
  writeProgressAttempt,
} from "@/lib/server/progress-write";

export const dynamic = "force-dynamic";

type RouteDependencies = GraphReadDependencies & ProgressWriteDependencies;

function normalizeProgressWriteRequestBody(body: unknown): unknown {
  if (!Array.isArray(body)) {
    return body;
  }

  return body[0] ?? body;
}

export async function handleProgressWriteRequest(
  request: Request,
  dependencies: RouteDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/progress");

  try {
    logInfo(logContext, "progress_write", "start", "Writing learner progress.");

    const rawRequestBody = await request.json();
    if (Array.isArray(rawRequestBody)) {
      logInfo(logContext, "progress_write", "start", "Normalizing array-shaped progress write payload.", {
        body_shape: "array",
        item_count: rawRequestBody.length,
      });
    }
    const requestBody = normalizeProgressWriteRequestBody(rawRequestBody);

    const parsedRequest = progressWriteRequestSchema.parse(requestBody);
    const userId = await requireAuthenticatedUserId(request, dependencies);
    const result = await writeProgressAttempt(parsedRequest, userId, dependencies);
    const validated = progressWriteResponseSchema.parse(result);

    logInfo(logContext, "progress_write", "success", "Learner progress updated.", {
      graph_id: parsedRequest.graph_id,
      node_id: parsedRequest.node_id,
      user_id: userId.slice(0, 8),
      completed: validated.progress.completed,
    });

    return NextResponse.json(validated);
  } catch (error) {
    logError(logContext, "progress_write", "Learner progress write failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleProgressWriteRequest(request);
}
