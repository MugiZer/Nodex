import { NextResponse } from "next/server";

import { getStageErrorStatus, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  storeRouteRequestSchema,
  storeStageResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  runStoreStage,
  type StoreGraphDependencies,
} from "@/lib/server/generation/store";

export const runtime = "nodejs";

export async function handleStoreRequest(
  request: Request,
  dependencies: StoreGraphDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate/store");

  try {
    const body = await request.json().catch(() => null);
    const parsed = storeRouteRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          message: "Expected body with graph, nodes, and edges for store.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    logInfo(logContext, "store", "start", "Store route received request.");
    const result = await runStoreStage(parsed.data, logContext, dependencies);
    const validated = storeStageResponseSchema.parse(result);
    logInfo(logContext, "store", "success", "Store route completed.", {
      ok: validated.ok,
      graph_id: validated.data?.graph_id ?? null,
      error_code: validated.error?.code ?? null,
    });
    return NextResponse.json(validated, {
      status: validated.ok ? 200 : getStageErrorStatus(validated.error!),
    });
  } catch (error) {
    logError(logContext, "store", "Store route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleStoreRequest(request);
}
