import { NextResponse } from "next/server";

import {
  canonicalizeRequestSchema,
  canonicalizeResultSchema,
} from "@/lib/schemas";
import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import {
  canonicalizePrompt,
  type CanonicalizeDependencies,
} from "@/lib/server/canonicalize";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";

export const runtime = "nodejs";

export async function handleCanonicalizeRequest(
  request: Request,
  dependencies: CanonicalizeDependencies = {},
): Promise<NextResponse> {
  const context = createRequestLogContext("POST /api/generate/canonicalize");

  try {
    const body = await request.json().catch(() => null);
    const parsed = canonicalizeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST_BODY",
        "Expected body with { prompt: string }.",
        400,
        parsed.error.flatten(),
      );
    }

    logInfo(context, "canonicalize", "start", "Canonicalize route received request");
    const result = await canonicalizePrompt(parsed.data.prompt, context, dependencies);
    canonicalizeResultSchema.parse(result);
    logInfo(context, "canonicalize", "success", "Canonicalize route completed", {
      result_type: "error" in result ? "error" : "success",
    });
    return NextResponse.json(result);
  } catch (error) {
    const normalized = normalizeError(error);
    logError(context, "canonicalize", "Canonicalize route failed", normalized);
    return jsonError(normalized);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleCanonicalizeRequest(request);
}
