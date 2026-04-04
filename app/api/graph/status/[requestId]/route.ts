import { NextResponse } from "next/server";

import { jsonError, normalizeError } from "@/lib/errors";
import { graphStatusRouteResponseSchema } from "@/lib/server/generation/contracts";
import { getGenerateRequestRecord } from "@/lib/server/generation/request-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<NextResponse> {
  try {
    const { requestId } = await params;
    const record = getGenerateRequestRecord(requestId);

    if (!record) {
      return NextResponse.json(
        {
          error: "REQUEST_NOT_FOUND",
          message: "No generate request was found for that request id.",
          details: {
            request_id: requestId,
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      graphStatusRouteResponseSchema.parse({
        status: record.status,
        graph_id: record.graph_id,
        prerequisite_lessons_status: record.prerequisite_lessons_status,
        prerequisite_lessons: record.prerequisite_lessons,
      }),
    );
  } catch (error) {
    return jsonError(normalizeError(error));
  }
}
