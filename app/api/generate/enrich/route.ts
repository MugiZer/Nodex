import { NextResponse } from "next/server";

import { jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  generateEnrichRouteRequestSchema,
  generateEnrichRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import {
  runIncrementalGraphEnrichment,
  type IncrementalEnrichmentDependencies,
} from "@/lib/server/generation/incremental";

export const runtime = "nodejs";

export async function handleGenerateEnrichRequest(
  request: Request,
  dependencies: IncrementalEnrichmentDependencies = {},
): Promise<NextResponse> {
  const logContext = createRequestLogContext("POST /api/generate/enrich");

  try {
    const body = await request.json().catch(() => null);
    const parsed = generateEnrichRouteRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          message: "Expected body with { graph_id, limit?, retry_failed? }.",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    logInfo(logContext, "enrich", "start", "Incremental enrichment route received request.", {
      graph_id: parsed.data.graph_id,
      limit: parsed.data.limit ?? 4,
      retry_failed: parsed.data.retry_failed ?? false,
    });

    const result = await runIncrementalGraphEnrichment(parsed.data, logContext, dependencies);
    const validated = generateEnrichRouteResponseSchema.parse(result);

    logInfo(logContext, "enrich", "success", "Incremental enrichment route completed.", {
      graph_id: validated.graph_id,
      ready_node_ids: validated.ready_node_ids,
      failed_node_ids: validated.failed_node_ids,
    });

    return NextResponse.json(validated);
  } catch (error) {
    logError(logContext, "enrich", "Incremental enrichment route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleGenerateEnrichRequest(request);
}
