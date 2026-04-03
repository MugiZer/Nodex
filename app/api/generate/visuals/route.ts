import { NextResponse } from "next/server";

import { getStageErrorStatus, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  visualsRouteRequestSchema,
  visualsRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  generateVisualsStage,
  type VisualsStageDependencies,
} from "@/lib/server/generation/visuals";

export const runtime = "nodejs";

export async function handleVisualsRequest(
  request: Request,
  dependencies: VisualsStageDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate/visuals");

  try {
    const body = await request.json().catch(() => null);
    const parsed = visualsRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      const nodeCount =
        body && typeof body === "object" && Array.isArray((body as { nodes?: unknown }).nodes)
          ? (body as { nodes: unknown[] }).nodes.length
          : null;
      const issues = parsed.error.flatten();
      const requestError = new Error(
        "Expected body with subject, topic, description, and nodes for visuals.",
      );
      logError(logContext, "visuals", "Visuals request validation failed.", requestError, {
        node_count: nodeCount,
        issues,
      });
      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          message:
            "Expected body with subject, topic, description, and nodes for visuals.",
          details: issues,
        },
        { status: 400 },
      );
    }

    const result = await generateVisualsStage(parsed.data, logContext, dependencies);
    const validated = visualsRouteResponseSchema.parse(result);

    logInfo(logContext, "visuals", "success", "Visuals route completed.", {
      ok: validated.ok,
      node_count: validated.data?.nodes.length ?? 0,
      warning_count: validated.warnings.length,
      error_code: validated.error?.code ?? null,
    });

    return NextResponse.json(validated, {
      status: validated.ok ? 200 : getStageErrorStatus(validated.error!),
    });
  } catch (error) {
    logError(logContext, "visuals", "Visuals route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleVisualsRequest(request);
}
