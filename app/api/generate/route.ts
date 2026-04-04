import { NextResponse } from "next/server";

import { handleGenerateEnrichRequest } from "@/app/api/generate/enrich/route";
import { ApiError, jsonError, normalizeError } from "@/lib/errors";
import { createRequestLogContext, hashPrompt, logError, logInfo } from "@/lib/logging";
import {
  generateRouteRequestSchema,
  generateRouteResponseSchema,
} from "@/lib/server/generation/contracts";
import { generatePrerequisiteDiagnostic } from "@/lib/server/generation/diagnostic";
import { inspectDemoEnrichmentReadiness } from "@/lib/server/generation/incremental";
import { generatePrerequisiteFlagshipLessons } from "@/lib/server/generation/prerequisite-lessons";
import {
  continueGenerationPipeline,
  canonicalizeGenerationPrompt,
  type GenerationPipelineDependencies,
} from "@/lib/server/generation/orchestrator";
import type { PrerequisiteDiagnosticDependencies } from "@/lib/server/generation/diagnostic";
import {
  createGenerateRequestRecord,
  updateGenerateRequestRecord,
} from "@/lib/server/generation/request-store";

export const runtime = "nodejs";

function resolveIncrementalCreateServiceClient(
  dependencies: GenerationPipelineDependencies,
): (() => ReturnType<NonNullable<GenerationPipelineDependencies["createServiceClient"]>>) | undefined {
  return (
    dependencies.incrementalEnrichmentDependencies?.createServiceClient ??
    dependencies.createServiceClient
  );
}

function canInspectCachedDemoReadiness(
  dependencies: GenerationPipelineDependencies,
): boolean {
  if (resolveIncrementalCreateServiceClient(dependencies)) {
    return true;
  }

  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function resolvePrerequisiteDiagnosticDependencies(
  dependencies: GenerationPipelineDependencies,
): PrerequisiteDiagnosticDependencies | undefined {
  const incrementalDiagnosticDependencies = dependencies.incrementalEnrichmentDependencies?.diagnosticDependencies as
    | PrerequisiteDiagnosticDependencies
    | undefined;
  if (incrementalDiagnosticDependencies) {
    return incrementalDiagnosticDependencies;
  }

  const diagnosticDependencies = dependencies.diagnosticStageDependencies as
    | PrerequisiteDiagnosticDependencies
    | undefined;
  if (diagnosticDependencies) {
    return diagnosticDependencies;
  }

  const legacyDiagnosticDependencies = (
    dependencies as GenerationPipelineDependencies & {
      diagnosticDependencies?: PrerequisiteDiagnosticDependencies;
    }
  ).diagnosticDependencies;
  if (legacyDiagnosticDependencies) {
    return legacyDiagnosticDependencies;
  }

  return dependencies.lessonStageDependencies as PrerequisiteDiagnosticDependencies | undefined;
}

function scheduleDefaultEnrichment(
  graphId: string,
  logContext: ReturnType<typeof createRequestLogContext>,
  dependencies: GenerationPipelineDependencies,
): void {
  const scheduled = handleGenerateEnrichRequest(
    new Request("http://localhost/api/generate/enrich", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        graph_id: graphId,
        limit: 4,
      }),
    }),
    {
      ...dependencies.incrementalEnrichmentDependencies,
      createServiceClient: resolveIncrementalCreateServiceClient(dependencies),
      enableDiagnostics: false,
      enableVisuals: false,
      maxNodeConcurrency: 1,
    },
  );

  void scheduled.catch((error) => {
    logError(
      logContext,
      "enrich",
      "Background incremental enrichment scheduling failed.",
      error,
      {
        graph_id: graphId,
      },
    );
  });
}

function schedulePrerequisiteLessonGeneration(
  input: {
    requestId: string;
    topic: string;
    prerequisites: string[];
  },
  logContext: ReturnType<typeof createRequestLogContext>,
): void {
  void (async () => {
    try {
      logInfo(logContext, "lessons", "start", "Starting background prerequisite lesson generation.", {
        request_id: input.requestId,
        topic: input.topic,
        prerequisite_count: input.prerequisites.length,
      });

      const prerequisiteLessons = await generatePrerequisiteFlagshipLessons(
        {
          topic: input.topic,
          prerequisiteNames: input.prerequisites,
        },
        logContext,
      );

      updateGenerateRequestRecord(input.requestId, {
        prerequisite_lessons: prerequisiteLessons,
        prerequisite_lessons_status:
          prerequisiteLessons.length > 0 ? "ready" : "failed",
      });

      logInfo(logContext, "lessons", "success", "Background prerequisite lesson generation completed.", {
        request_id: input.requestId,
        topic: input.topic,
        generated_count: prerequisiteLessons.length,
      });
    } catch (error) {
      updateGenerateRequestRecord(input.requestId, {
        prerequisite_lessons_status: "failed",
        prerequisite_lessons: [],
      });

      logError(
        logContext,
        "lessons",
        "Background prerequisite lesson generation failed.",
        error,
        {
          request_id: input.requestId,
          topic: input.topic,
        },
      );
    }
  })().catch((error) => {
    logError(
      logContext,
      "lessons",
      "Background prerequisite lesson scheduling failed.",
      error,
      {
        request_id: input.requestId,
        topic: input.topic,
      },
    );
  });
}

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

    const canonicalized = await canonicalizeGenerationPrompt(
      parsed.data.prompt,
      logContext,
      dependencies,
    );

    createGenerateRequestRecord({
      request_id: logContext.requestId,
      prompt: parsed.data.prompt,
      topic: canonicalized.topic,
      prerequisite_lessons_status: "pending",
    });

    schedulePrerequisiteLessonGeneration(
      {
        requestId: logContext.requestId,
        topic: canonicalized.topic,
        prerequisites: (canonicalized.prerequisites ?? []).slice(0, 5),
      },
      logContext,
    );

    let backgroundGraphId: string | null = null;
    let backgroundCached = false;
    let backgroundGraphPipelineError: unknown = null;

    const graphPipelinePromise = continueGenerationPipeline(
      {
        prompt: parsed.data.prompt,
        canonicalized,
      },
      logContext,
      dependencies,
    )
      .then((result) => {
        backgroundGraphId = result.response.graph_id;
        backgroundCached = result.response.cached;

        if (result.response.graph_id) {
          updateGenerateRequestRecord(logContext.requestId, {
            status: "ready",
            graph_id: result.response.graph_id,
            cached: result.response.cached,
          });
        }

        void (async () => {
          try {
            if (!result.response.graph_id) {
              return;
            }

            if (result.response.cached) {
              const readiness = canInspectCachedDemoReadiness(dependencies)
                ? await inspectDemoEnrichmentReadiness(
                    result.response.graph_id,
                    {
                      ...dependencies.incrementalEnrichmentDependencies,
                      createServiceClient: resolveIncrementalCreateServiceClient(dependencies),
                    },
                    4,
                  )
                : null;

              if (readiness?.needs_enrichment) {
                if (dependencies.triggerEnrichment) {
                  void Promise.resolve(
                    dependencies.triggerEnrichment({
                      graph_id: result.response.graph_id,
                      request_id: logContext.requestId,
                    }),
                  ).catch((error) => {
                    logError(
                      logContext,
                      "enrich",
                      "Cached graph enrichment trigger rejected after background graph completion.",
                      error,
                      {
                        graph_id: result.response.graph_id,
                      },
                    );
                  });
                } else {
                  scheduleDefaultEnrichment(result.response.graph_id, logContext, dependencies);
                }
              }
            } else if (dependencies.triggerEnrichment === undefined) {
              scheduleDefaultEnrichment(result.response.graph_id, logContext, dependencies);
            }
          } catch (error) {
            logError(
              logContext,
              "enrich",
              "Background post-generation enrichment setup failed.",
              error,
              {
                graph_id: result.response.graph_id,
              },
            );
          }
        })();

        return result;
      })
      .catch((error) => {
        backgroundGraphPipelineError = error;
        logError(
          logContext,
          "generate",
          "Background graph generation failed after diagnostic response.",
          error,
        );

        updateGenerateRequestRecord(logContext.requestId, {
          status: "failed",
          graph_id: null,
          cached: false,
        });

        return null;
      });

    const diagnostic = await generatePrerequisiteDiagnostic(
      {
        topic: canonicalized.topic,
        prerequisites: canonicalized.prerequisites ?? [],
      },
      logContext,
      resolvePrerequisiteDiagnosticDependencies(dependencies),
    );

    if (!backgroundGraphId) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (backgroundGraphPipelineError && !backgroundGraphId) {
        throw backgroundGraphPipelineError;
      }
    }

    const response = generateRouteResponseSchema.parse({
      request_id: logContext.requestId,
      graph_id: backgroundGraphId,
      diagnostic,
      status: backgroundGraphId ? "ready" : "generating",
      topic: canonicalized.topic,
      cached: backgroundCached,
    });

    void graphPipelinePromise.catch(() => undefined);

    if (response.status === "generating" && response.diagnostic === null) {
      logInfo(
        logContext,
        "generate",
        "success",
        "Generate request is continuing without a prerequisite diagnostic; frontend should poll graph status.",
        {
          request_id: response.request_id,
          topic: response.topic,
        },
      );
    }

    logInfo(logContext, "generate", "success", "Generate route completed.", {
      request_id: response.request_id,
      graph_id: response.graph_id,
      status: response.status,
      cached: response.cached,
      has_diagnostic: response.diagnostic !== null,
    });

    return NextResponse.json(response);
  } catch (error) {
    logError(logContext, "generate", "Generate route failed.", error);
    return jsonError(normalizeError(error));
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleGenerateRequest(request);
}
