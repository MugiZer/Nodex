import { NextResponse } from "next/server";

import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, hashPrompt, logError, logInfo } from "@/lib/logging";
import {
  generateRouteRequestSchema,
  generateRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  runGenerationPipeline,
  type GenerationPipelineDependencies,
} from "@/lib/server/generation/orchestrator";

export const runtime = "nodejs";

export async function handleGenerateRequest(
  request: Request,
  dependencies: GenerationPipelineDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate");

  try {
    const body = await request.json().catch(() => null);
    const parsed = generateRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST_BODY",
        "Expected body with { prompt: string }.",
        400,
        parsed.error.flatten(),
      );
    }

    logInfo(logContext, "generate", "start", "Generate route received request.", {
      prompt_hash: hashPrompt(parsed.data.prompt),
    });

    const { response } = await runGenerationPipeline(
      parsed.data.prompt,
      logContext,
      dependencies,
    );
    const validated = generateRouteResponseSchema.parse(response);

    logInfo(logContext, "generate", "success", "Generate route completed.", {
      graph_id: validated.graph_id,
      cached: validated.cached,
    });

    return NextResponse.json(validated);
  } catch (error) {
    logError(logContext, "generate", "Generate route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleGenerateRequest(request);
}
