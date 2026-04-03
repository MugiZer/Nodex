import { NextResponse } from "next/server";

import {
  graphRouteDebugResponseSchema,
  graphRouteRequestSchema,
  graphRouteResponseSchema,
} from "@/lib/schemas";
import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, logError, logInfo } from "@/lib/logging";
import {
  runCurriculumValidator,
  runGraphGenerator,
  runReconciler,
  runStructureValidator,
  assertCanonicalBoundaryInvariants,
} from "@/lib/server/generation/stages/graph-pipeline";
import type { CurriculumAuditStoreDependencies } from "@/lib/server/generation/curriculum-audit-store";
import {
  createDeferredCurriculumResult,
  launchDetachedCurriculumAudit,
} from "@/lib/server/generation/curriculum-audit";
import { buildGraphRouteTelemetry } from "@/lib/server/generation/graph-route-telemetry";

type GraphGeneratorDependencies = Parameters<typeof runGraphGenerator>[2];
type StructureValidatorDependencies = Parameters<typeof runStructureValidator>[2];
type CurriculumValidatorDependencies = Parameters<typeof runCurriculumValidator>[2];
type ReconcilerDependencies = Parameters<typeof runReconciler>[2];

export type GraphRouteDependencies = {
  graphGeneratorDependencies?: GraphGeneratorDependencies;
  structureValidatorDependencies?: StructureValidatorDependencies;
  curriculumValidatorDependencies?: CurriculumValidatorDependencies;
  reconcilerDependencies?: ReconcilerDependencies;
  curriculumAuditDependencies?: CurriculumAuditStoreDependencies;
};

export const runtime = "nodejs";

export async function handleGraphGenerateRequest(
  request: Request,
  dependencies: GraphRouteDependencies = {},
): Promise<NextResponse> {
  const context = createRequestLogContext("POST /api/generate/graph");
  const requestUrl = new URL(request.url);
  const debugEnabled =
    process.env.NODE_ENV !== "production" &&
    requestUrl.searchParams.get("debug") === "1";

  try {
    const body = await request.json().catch(() => null);
    const parsed = graphRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        "INVALID_REQUEST_BODY",
        "Expected body with { subject, topic, description }.",
        400,
        parsed.error.flatten(),
      );
    }

    logInfo(context, "graph_generate", "start", "Graph route received request");

    const graphGenerateStartedAt = Date.now();
    const generatedGraphDraft = await runGraphGenerator(
      parsed.data,
      context,
      dependencies.graphGeneratorDependencies,
    );
    const graphGenerateMs = Date.now() - graphGenerateStartedAt;

    const structureStartedAt = Date.now();
    const structure = await runStructureValidator(
      {
        ...parsed.data,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
      },
      context,
      dependencies.structureValidatorDependencies,
    );
    const structureResult = {
      output: structure,
      durationMs: Date.now() - structureStartedAt,
    };

    const curriculumInput = {
      ...parsed.data,
      nodes: generatedGraphDraft.nodes,
      edges: generatedGraphDraft.edges,
    };
    launchDetachedCurriculumAudit(
      curriculumInput,
      context,
      runCurriculumValidator,
      dependencies.curriculumValidatorDependencies,
      dependencies.curriculumAuditDependencies,
    );
    const curriculumResult = createDeferredCurriculumResult();

    const curriculum = curriculumResult.output;

    const reconcileStartedAt = Date.now();
    const reconciled = await runReconciler(
      {
        ...parsed.data,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
        structure,
        curriculum,
        curriculumAuditStatus: curriculumResult.auditStatus,
      },
      context,
      dependencies.reconcilerDependencies,
    );

    if (parsed.data.prerequisites || parsed.data.downstream_topics) {
      assertCanonicalBoundaryInvariants(reconciled.nodes, {
        prerequisites: parsed.data.prerequisites ?? [],
        downstream_topics: parsed.data.downstream_topics ?? [],
      });
    }

    const reconcileMs = Date.now() - reconcileStartedAt;
    const totalMs = Date.now() - context.startedAtMs;
    const telemetry = buildGraphRouteTelemetry({
      structure,
      curriculum,
      resolutionSummary: reconciled.resolution_summary,
      repairMode: reconciled.repair_mode,
      curriculumAuditStatus: curriculumResult.auditStatus,
    });

    const response = graphRouteResponseSchema.parse({
      nodes: reconciled.nodes,
      edges: reconciled.edges,
    });

    logInfo(context, "graph_generate", "success", "Graph route completed", {
      node_count: response.nodes.length,
      edge_count: response.edges.length,
      structure_issue_count: structure.issues.length,
      curriculum_audit_status: curriculumResult.auditStatus,
      curriculum_audit_phase: "synchronous_placeholder",
      telemetry,
      timings_ms: {
        graph_generate: graphGenerateMs,
        structure_validate: structureResult.durationMs,
        curriculum_validate: curriculumResult.durationMs,
        reconcile: reconcileMs,
        total: totalMs,
      },
    });

    if (debugEnabled) {
      const debugResponse = graphRouteDebugResponseSchema.parse({
        nodes: reconciled.nodes,
        edges: reconciled.edges,
        debug: {
        request_id: context.requestId,
        structure,
        curriculum,
        audit_status: curriculumResult.auditStatus,
        curriculum_audit_phase: "synchronous_placeholder",
          telemetry,
          reconciliation: {
            resolution_summary: reconciled.resolution_summary,
            repair_mode: reconciled.repair_mode,
          },
          timings: {
            graph_generate_ms: graphGenerateMs,
            structure_validate_ms: structureResult.durationMs,
            curriculum_validate_ms: curriculumResult.durationMs,
            reconcile_ms: reconcileMs,
            total_ms: totalMs,
          },
        },
      });

      return NextResponse.json(debugResponse);
    }

    return NextResponse.json(response);
  } catch (error) {
    const normalized = normalizeError(error);
    logError(context, "graph_generate", "Graph route failed", normalized);
    return jsonError(normalized);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleGraphGenerateRequest(request);
}
