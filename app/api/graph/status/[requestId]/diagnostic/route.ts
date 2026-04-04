import { NextResponse } from "next/server";

import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import type { StoredGraphDiagnosticResult } from "@/lib/diagnostic-session";
import { storedGraphDiagnosticResultSchema } from "@/lib/schemas";
import {
  getGenerateRequestRecord,
  updateGenerateRequestRecord,
} from "@/lib/server/generation/request-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<NextResponse> {
  try {
    const { requestId } = await params;
    const record = getGenerateRequestRecord(requestId);

    if (!record) {
      throw new ApiError(
        "REQUEST_NOT_FOUND",
        "No generate request was found for that request id.",
        404,
        {
          request_id: requestId,
        },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = storedGraphDiagnosticResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST_BODY",
        "Expected a stored graph diagnostic result body.",
        400,
        parsed.error.flatten(),
      );
    }

    if (record.graph_id && record.graph_id !== parsed.data.graphId) {
      throw new ApiError(
        "GRAPH_ID_MISMATCH",
        "The diagnostic result graph id does not match the request record.",
        400,
        {
          request_id: requestId,
          record_graph_id: record.graph_id,
          body_graph_id: parsed.data.graphId,
        },
      );
    }

    const updated = updateGenerateRequestRecord(requestId, {
      graph_id: record.graph_id ?? parsed.data.graphId,
      graph_diagnostic_result: parsed.data as StoredGraphDiagnosticResult,
    });

    if (!updated?.graph_diagnostic_result) {
      throw new ApiError(
        "DIAGNOSTIC_RESULT_NOT_STORED",
        "The graph diagnostic result could not be stored.",
        500,
      );
    }

    return NextResponse.json(
      storedGraphDiagnosticResultSchema.parse(updated.graph_diagnostic_result),
    );
  } catch (error) {
    return jsonError(normalizeError(error));
  }
}
