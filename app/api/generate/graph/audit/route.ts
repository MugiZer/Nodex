import { NextResponse } from "next/server";

import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  graphCurriculumAuditReadResponseSchema,
} from "@/lib/schemas";
import {
  fetchCurriculumAuditRecord,
  type CurriculumAuditStoreDependencies,
} from "@/lib/server/generation/curriculum-audit-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type GraphCurriculumAuditReadDependencies = {
  curriculumAuditDependencies?: CurriculumAuditStoreDependencies;
};

export async function handleGraphCurriculumAuditReadRequest(
  request: Request,
  dependencies: GraphCurriculumAuditReadDependencies = {},
): Promise<NextResponse> {
  const context = createRequestLogContext("GET /api/generate/graph/audit");
  const requestUrl = new URL(request.url);
  const requestId = requestUrl.searchParams.get("request_id")?.trim() ?? "";

  try {
    if (requestId.length === 0) {
      throw new ApiError(
        "INVALID_REQUEST_QUERY",
        "Expected query parameter request_id.",
        400,
      );
    }

    logInfo(context, "curriculum_audit_lookup", "start", "Loading curriculum audit record.", {
      request_id: requestId,
    });

    const audit = await fetchCurriculumAuditRecord(
      requestId,
      context,
      dependencies.curriculumAuditDependencies,
    );
    const response = graphCurriculumAuditReadResponseSchema.parse({
      request_id: requestId,
      audit,
    });

    logInfo(context, "curriculum_audit_lookup", "success", "Curriculum audit record loaded.", {
      request_id: requestId,
      found: audit !== null,
      audit_status: audit?.audit_status ?? null,
      outcome_bucket: audit?.outcome_bucket ?? null,
    });

    return NextResponse.json(response);
  } catch (error) {
    const normalized = normalizeError(error);
    logError(context, "curriculum_audit_lookup", "Curriculum audit lookup failed.", normalized, {
      request_id: requestId || null,
    });
    return jsonError(normalized);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleGraphCurriculumAuditReadRequest(request);
}
