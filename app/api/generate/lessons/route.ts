import { NextResponse } from "next/server";

import { getStageErrorStatus, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  lessonsRouteRequestSchema,
  lessonsRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  generateLessonsStage,
  type LessonsStageDependencies,
} from "@/lib/server/generation/lessons";

export const runtime = "nodejs";

export async function handleLessonsRequest(
  request: Request,
  dependencies: LessonsStageDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate/lessons");

  try {
    const body = await request.json().catch(() => null);
    const parsed = lessonsRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          message:
            "Expected body with subject, topic, description, nodes, and edges for lessons.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = await generateLessonsStage(parsed.data, logContext, dependencies);
    const validated = lessonsRouteResponseSchema.parse(result);

    logInfo(logContext, "lessons", "success", "Lessons route completed.", {
      ok: validated.ok,
      node_count: validated.data?.nodes.length ?? 0,
      error_code: validated.error?.code ?? null,
    });

    return NextResponse.json(validated, {
      status: validated.ok ? 200 : getStageErrorStatus(validated.error!),
    });
  } catch (error) {
    logError(logContext, "lessons", "Lessons route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleLessonsRequest(request);
}
