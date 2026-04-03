import { NextResponse } from "next/server";

import { getStageErrorStatus, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  diagnosticsRouteRequestSchema,
  diagnosticsRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  generateDiagnosticsStage,
  type DiagnosticsStageDependencies,
} from "@/lib/server/generation/diagnostics";

export const runtime = "nodejs";

export async function handleDiagnosticsRequest(
  request: Request,
  dependencies: DiagnosticsStageDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate/diagnostics");

  try {
    const body = await request.json().catch(() => null);
    const parsed = diagnosticsRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          message:
            "Expected body with subject, topic, description, nodes, and edges for diagnostics.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await generateDiagnosticsStage(parsed.data, logContext, dependencies);
    const validated = diagnosticsRouteResponseSchema.parse(result);

    logInfo(logContext, "diagnostics", "success", "Diagnostics route completed.", {
      ok: validated.ok,
      node_count: validated.data?.nodes.length ?? 0,
      error_code: validated.error?.code ?? null,
    });

    return NextResponse.json(validated, {
      status: validated.ok ? 200 : getStageErrorStatus(validated.error!),
    });
  } catch (error) {
    logError(logContext, "diagnostics", "Diagnostics route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleDiagnosticsRequest(request);
}
