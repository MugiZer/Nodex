import { NextResponse } from "next/server";

import { jsonError, normalizeError } from "@/lib/errors";
import { normalizeLessonNodeId } from "@/lib/lesson-route-node-id";
import { lessonResolverRouteResponseSchema } from "@/lib/schemas";
import {
  requireAuthenticatedUserId,
  type GraphReadDependencies,
} from "@/lib/server/graph-read";
import { resolveLessonNode } from "@/lib/server/lesson-resolver";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
  dependencies: GraphReadDependencies = {},
): Promise<NextResponse> {
  try {
    const { id, nodeId } = await params;
    const normalizedNodeId = normalizeLessonNodeId(nodeId);
    const userId = await requireAuthenticatedUserId(request, dependencies);
    const resolved = await resolveLessonNode(
      {
        graphId: id,
        nodeId: normalizedNodeId.normalized,
        userId,
      },
      dependencies,
    );

    if (!resolved.node) {
      console.error("Lesson resolver could not match requested node.", {
        graphId: id,
        nodeId,
        normalizedNodeId: normalizedNodeId.normalized,
        nodeIdWasNormalized: normalizedNodeId.wasNormalized,
        source: resolved.source,
      });

      return NextResponse.json(
        {
          error: "LESSON_NODE_NOT_FOUND",
          message: "We couldn't resolve this lesson route.",
          ready: false,
          source: resolved.source,
          node: null,
          graph_diagnostic_result: resolved.graphDiagnosticResult,
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      lessonResolverRouteResponseSchema.parse({
        ready: resolved.ready,
        source: resolved.source,
        node: resolved.node,
        graph_diagnostic_result: resolved.graphDiagnosticResult,
      }),
    );
  } catch (error) {
    return jsonError(normalizeError(error));
  }
}
