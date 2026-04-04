import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import {
  hashPrompt,
  logError,
  logInfo,
} from "@/lib/logging";
import {
  canonicalizePrompt,
  type CanonicalizeDependencies,
} from "@/lib/server/canonicalize";
import {
  embedDescription,
  retrieveGraphId,
  type RetrievalDependencies,
} from "@/lib/server/retrieve";

import {
  generateRouteResponseSchema,
  generationRunStateSchema,
  type GenerateRouteResponse,
  type GenerationFailureCategory,
  type GenerationRunState,
} from "./contracts";
import {
  createDeferredCurriculumResult,
  launchDetachedCurriculumAudit,
} from "./curriculum-audit";
import type { CurriculumAuditStoreDependencies } from "./curriculum-audit-store";
import {
  selectInitialLearningSlice,
  type IncrementalEnrichmentDependencies,
} from "./incremental";
import { storeGraphSkeleton, type StoreGraphDependencies } from "./store";
import {
  buildFallbackDagFromDraft,
  runCurriculumValidator,
  runGraphGenerator,
  runReconciler,
  runStructureValidator,
} from "./stages/graph-pipeline";

type GraphGeneratorDependencies = Parameters<typeof runGraphGenerator>[2];
type StructureValidatorDependencies = Parameters<typeof runStructureValidator>[2];
type CurriculumValidatorDependencies = Parameters<typeof runCurriculumValidator>[2];
type ReconcilerDependencies = Parameters<typeof runReconciler>[2];

export type GenerationPipelineDependencies = CanonicalizeDependencies &
  RetrievalDependencies &
  StoreGraphDependencies & {
    graphGeneratorDependencies?: GraphGeneratorDependencies;
    structureValidatorDependencies?: StructureValidatorDependencies;
    curriculumValidatorDependencies?: CurriculumValidatorDependencies;
    curriculumAuditDependencies?: CurriculumAuditStoreDependencies;
    reconcilerDependencies?: ReconcilerDependencies;
    lessonStageDependencies?: unknown;
    diagnosticStageDependencies?: unknown;
    visualStageDependencies?: unknown;
    incrementalEnrichmentDependencies?: IncrementalEnrichmentDependencies;
    triggerEnrichment?: (input: { graph_id: string; request_id: string }) => void | Promise<void>;
  };

export type GenerationPipelineResult = {
  state: GenerationRunState;
  response: GenerateRouteResponse;
};

type CanonicalizedPrompt = Exclude<
  Awaited<ReturnType<typeof canonicalizePrompt>>,
  { error: "NOT_A_LEARNING_REQUEST" }
>;

function createInitialRunState(requestId: string, prompt: string): GenerationRunState {
  return generationRunStateSchema.parse({
    request_id: requestId,
    request_route: "POST /api/generate",
    request_started_at: new Date().toISOString(),
    prompt_hash: hashPrompt(prompt),
    prompt,
    canonicalized: null,
    retrieval_candidates: [],
    retrieval_decision: null,
    execution_path: null,
    generated_graph_draft: null,
    validator_outputs: {
      structure: null,
      curriculum: null,
      curriculum_audit_status: null,
    },
    reconciled_graph: null,
    lesson_bundle: null,
    diagnostic_bundle: null,
    visual_bundle: null,
    store_eligibility: {
      eligible: false,
      reason: "not_applicable",
    },
    final_graph_id: null,
    error_log: [],
  });
}

function appendRunLog(
  state: GenerationRunState,
  stage: string,
  event: "start" | "success" | "error" | "retry",
  message: string,
  failureCategory?: GenerationFailureCategory,
  details?: Record<string, unknown>,
): GenerationRunState {
  state.error_log.push({
    request_id: state.request_id,
    stage,
    event,
    level: event === "error" ? "error" : "info",
    message,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    failure_category: failureCategory,
    details: details ?? null,
  });

  return state;
}

function normalizeTopicTitle(topic: string): string {
  return topic
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function classifyError(error: unknown): GenerationFailureCategory {
  if (error instanceof ApiError) {
    const normalizedCode = error.code.toUpperCase();
    if (normalizedCode.includes("CANONICALIZE")) {
      return "canonicalize_error";
    }
    if (normalizedCode.includes("RETRIEV")) {
      return "retrieval_error";
    }
    if (normalizedCode === "LLM_OUTPUT_INVALID") {
      return "llm_output_invalid";
    }
    if (normalizedCode === "LLM_CONTRACT_VIOLATION") {
      return "llm_contract_violation";
    }
    if (normalizedCode === "GRAPH_BOUNDARY_VIOLATION") {
      return "graph_boundary_violation";
    }
    if (normalizedCode === "INPUT_PRECONDITION_FAILED") {
      return "input_precondition_failed";
    }
    if (normalizedCode === "REPAIR_EXHAUSTED") {
      return "repair_exhausted";
    }
    if (normalizedCode === "UPSTREAM_TIMEOUT") {
      return "upstream_timeout";
    }
    if (normalizedCode === "DB_SCHEMA_OUT_OF_SYNC") {
      return "store_error";
    }
    if (normalizedCode.includes("STORE") || normalizedCode.includes("ENRICH")) {
      return "store_error";
    }
  }

  return "unexpected_internal_error";
}

export async function canonicalizeGenerationPrompt(
  prompt: string,
  context: RequestLogContext,
  dependencies: GenerationPipelineDependencies = {},
): Promise<CanonicalizedPrompt> {
  const canonicalized = await canonicalizePrompt(prompt, context, dependencies, {
    mode: "demo",
  });
  if ("error" in canonicalized) {
    throw new ApiError(
      "NOT_A_LEARNING_REQUEST",
      "The prompt could not be mapped to a learning request.",
      400,
    );
  }

  return canonicalized;
}

export async function continueGenerationPipeline(
  input: {
    prompt: string;
    canonicalized: CanonicalizedPrompt;
  },
  context: RequestLogContext,
  dependencies: GenerationPipelineDependencies = {},
): Promise<GenerationPipelineResult> {
  let state = createInitialRunState(context.requestId, input.prompt);

  try {
    logInfo(context, "generate", "start", "Continuing generate orchestrator after canonicalize.");
    state = appendRunLog(state, "generate", "start", "Generate pipeline continued after canonicalize.");
    state.request_route = context.route;
    state.request_started_at = new Date(context.startedAtMs).toISOString();
    state.prompt_hash = hashPrompt(input.prompt);
    state.canonicalized = input.canonicalized;

    const embedding =
      dependencies.precomputedEmbedding ??
      (await embedDescription(input.canonicalized.description, dependencies));

    logInfo(context, "retrieve", "start", "Running retrieval for canonicalized prompt.");
    const retrievalResult = await retrieveGraphId(
      {
        subject: input.canonicalized.subject,
        description: input.canonicalized.description,
      },
      {
        ...dependencies,
        precomputedEmbedding: embedding,
      },
    );

    if (retrievalResult.graph_id) {
      state.execution_path = "cache_hit";
      state.final_graph_id = retrievalResult.graph_id;

      return {
        state: generationRunStateSchema.parse(state),
        response: generateRouteResponseSchema.parse({
          request_id: context.requestId,
          graph_id: retrievalResult.graph_id,
          diagnostic: null,
          status: "ready",
          topic: input.canonicalized.topic,
          cached: true,
        }),
      };
    }

    state.execution_path = "generate";
    state.retrieval_candidates = [];
    state.retrieval_decision = {
      graph_id: null,
      reason: "no_candidates",
      candidate: null,
    };

    const generatedGraphDraft = await runGraphGenerator(
      input.canonicalized,
      context,
      dependencies.graphGeneratorDependencies,
      { validationMode: "demo" },
    );
    state.generated_graph_draft = generatedGraphDraft;

    const structure = await runStructureValidator(
      {
        ...input.canonicalized,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
      },
      context,
      dependencies.structureValidatorDependencies,
      { auditMode: "demo" },
    );

    launchDetachedCurriculumAudit(
      {
        ...input.canonicalized,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
      },
      context,
      runCurriculumValidator,
      dependencies.curriculumValidatorDependencies,
      dependencies.curriculumAuditDependencies,
    );
    const curriculumResult = createDeferredCurriculumResult();
    const curriculum = curriculumResult.output;

    state.validator_outputs.structure = structure;
    state.validator_outputs.curriculum = curriculum;
    state.validator_outputs.curriculum_audit_status = curriculumResult.auditStatus;

    let reconciled: Awaited<ReturnType<typeof runReconciler>>;
    try {
      reconciled = await runReconciler(
        {
          ...input.canonicalized,
          nodes: generatedGraphDraft.nodes,
          edges: generatedGraphDraft.edges,
          structure,
          curriculum,
          curriculumAuditStatus: curriculumResult.auditStatus,
          boundaryPolicy: {
            prerequisite: "error",
            downstream: "warn",
          },
        },
        context,
        dependencies.reconcilerDependencies,
      );
    } catch (error) {
      const fallbackGraph = buildFallbackDagFromDraft(generatedGraphDraft.nodes);
      const fallbackStructure = await runStructureValidator(
        {
          ...input.canonicalized,
          nodes: fallbackGraph.nodes,
          edges: fallbackGraph.edges,
        },
        context,
        dependencies.structureValidatorDependencies,
        { auditMode: "demo" },
      );
      if (!fallbackStructure.valid) {
        throw error;
      }

      logInfo(
        context,
        "reconcile",
        "success",
        "Used fallback DAG after reconcile failure in demo mode.",
        {
          failure_code: error instanceof ApiError ? error.code : "unexpected_reconcile_error",
          original_issue_count: structure.issues.length,
          fallback_node_count: fallbackGraph.nodes.length,
          fallback_edge_count: fallbackGraph.edges.length,
        },
      );

      reconciled = {
        nodes: fallbackGraph.nodes,
        edges: fallbackGraph.edges,
        resolution_summary: [],
        repair_mode: "deterministic_only",
        boundary_warnings: [],
      };
    }

    state.reconciled_graph = {
      nodes: reconciled.nodes,
      edges: reconciled.edges,
      resolution_summary: reconciled.resolution_summary,
    };

    const stored = await storeGraphSkeleton(
      {
        graph: {
          title: normalizeTopicTitle(input.canonicalized.topic),
          subject: input.canonicalized.subject,
          topic: input.canonicalized.topic,
          description: input.canonicalized.description,
        },
        nodes: reconciled.nodes,
        edges: reconciled.edges,
      },
      context,
      {
        ...dependencies,
        precomputedEmbedding: embedding,
      },
    );

    state.final_graph_id = stored.graph_id;
    state.store_eligibility = {
      eligible: true,
      reason: stored.duplicate_of_graph_id ? "duplicate_recheck_hit" : "ready_to_store",
    };

    if (stored.duplicate_of_graph_id) {
      return {
        state: generationRunStateSchema.parse(state),
        response: generateRouteResponseSchema.parse({
          request_id: context.requestId,
          graph_id: stored.duplicate_of_graph_id,
          diagnostic: null,
          status: "ready",
          topic: input.canonicalized.topic,
          cached: true,
        }),
      };
    }

    const initialNodeIds = selectInitialLearningSlice(
      stored.persisted_nodes ?? [],
      stored.persisted_edges ?? [],
      4,
    );
    logInfo(
      context,
      "node_selection",
      "success",
      "Selected deterministic initial enrichment slice.",
      {
        graph_id: stored.graph_id,
        selected_node_ids: initialNodeIds,
        selection_reason:
          "root node by deterministic tie-break, then deterministic hard-edge successors",
      },
    );

    if (dependencies.triggerEnrichment) {
      const triggerEnrichment = dependencies.triggerEnrichment;
      const scheduled = Promise.resolve(
        triggerEnrichment({
          graph_id: stored.graph_id,
          request_id: context.requestId,
        }),
      );
      void scheduled.catch((error) => {
        logError(context, "enrich", "Incremental enrichment trigger rejected.", error, {
          graph_id: stored.graph_id,
        });
      });
    } else {
      logInfo(
        context,
        "enrich",
        "success",
        "Incremental enrichment delegated to POST /api/generate/enrich.",
        {
          graph_id: stored.graph_id,
          selected_node_ids: initialNodeIds,
        },
      );
    }

    const response = generateRouteResponseSchema.parse({
      request_id: context.requestId,
      graph_id: stored.graph_id,
      diagnostic: null,
      status: "ready",
      topic: input.canonicalized.topic,
      cached: false,
    });

    logInfo(context, "generate", "success", "Generate pipeline stored graph skeleton.", {
      graph_id: response.graph_id,
      cached: response.cached,
      initial_node_ids: initialNodeIds,
      boundary_warning_count: reconciled.boundary_warnings?.length ?? 0,
    });

    return {
      state: generationRunStateSchema.parse(state),
      response,
    };
  } catch (error) {
    const failureCategory = classifyError(error);
    appendRunLog(
      state,
      "generate",
      "error",
      error instanceof Error ? error.message : "Generation pipeline failed.",
      failureCategory,
    );
    logError(context, "generate", "Generate pipeline failed.", error, {
      failure_category: failureCategory,
    });
    throw error;
  }
}

export async function runGenerationPipeline(
  prompt: string,
  context: RequestLogContext,
  dependencies: GenerationPipelineDependencies = {},
): Promise<GenerationPipelineResult> {
  const canonicalized = await canonicalizeGenerationPrompt(prompt, context, dependencies);
  return continueGenerationPipeline(
    {
      prompt,
      canonicalized,
    },
    context,
    dependencies,
  );
}
