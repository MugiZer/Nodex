import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import {
  hashPrompt,
  logError,
  logInfo,
} from "@/lib/logging";
import { decideRetrievalCandidate } from "@/lib/domain/retrieval";
import {
  canonicalizePrompt,
  type CanonicalizeDependencies,
} from "@/lib/server/canonicalize";
import {
  embedDescription,
  loadRetrievalCandidates,
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
    if (normalizedCode.includes("STORE") || normalizedCode.includes("ENRICH")) {
      return "store_error";
    }
  }

  return "unexpected_internal_error";
}

export async function runGenerationPipeline(
  prompt: string,
  context: RequestLogContext,
  dependencies: GenerationPipelineDependencies = {},
): Promise<GenerationPipelineResult> {
  let state = createInitialRunState(context.requestId, prompt);

  try {
    logInfo(context, "generate", "start", "Starting generate orchestrator.");
    state = appendRunLog(state, "generate", "start", "Generate pipeline started.");

    const canonicalized = await canonicalizePrompt(prompt, context, dependencies);
    if ("error" in canonicalized) {
      throw new ApiError(
        "NOT_A_LEARNING_REQUEST",
        "The prompt could not be mapped to a learning request.",
        400,
      );
    }

    state.request_route = context.route;
    state.request_started_at = new Date(context.startedAtMs).toISOString();
    state.prompt_hash = hashPrompt(prompt);
    state.canonicalized = canonicalized;

    logInfo(context, "retrieve", "start", "Running retrieval for canonicalized prompt.");
    const embedding = await embedDescription(canonicalized.description, dependencies);
    const retrievalCandidates = await loadRetrievalCandidates(
      canonicalized.subject,
      embedding,
      dependencies,
    );
    const retrievalDecision = decideRetrievalCandidate(retrievalCandidates);

    state.retrieval_candidates = retrievalCandidates;
    state.retrieval_decision = retrievalDecision;

    if (retrievalDecision.graph_id) {
      state.execution_path = "cache_hit";
      state.final_graph_id = retrievalDecision.graph_id;

      return {
        state: generationRunStateSchema.parse(state),
        response: generateRouteResponseSchema.parse({
          graph_id: retrievalDecision.graph_id,
          cached: true,
        }),
      };
    }

    state.execution_path = "generate";

    const generatedGraphDraft = await runGraphGenerator(
      canonicalized,
      context,
      dependencies.graphGeneratorDependencies,
    );
    state.generated_graph_draft = generatedGraphDraft;

    const structure = await runStructureValidator(
      {
        ...canonicalized,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
      },
      context,
      dependencies.structureValidatorDependencies,
    );

    launchDetachedCurriculumAudit(
      {
        ...canonicalized,
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

    const reconciled = await runReconciler(
      {
        ...canonicalized,
        nodes: generatedGraphDraft.nodes,
        edges: generatedGraphDraft.edges,
        structure,
        curriculum,
        curriculumAuditStatus: curriculumResult.auditStatus,
      },
      context,
      dependencies.reconcilerDependencies,
    );

    state.reconciled_graph = {
      nodes: reconciled.nodes,
      edges: reconciled.edges,
      resolution_summary: reconciled.resolution_summary,
    };

    const stored = await storeGraphSkeleton(
      {
        graph: {
          title: normalizeTopicTitle(canonicalized.topic),
          subject: canonicalized.subject,
          topic: canonicalized.topic,
          description: canonicalized.description,
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
          graph_id: stored.duplicate_of_graph_id,
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
      graph_id: stored.graph_id,
      cached: false,
    });

    logInfo(context, "generate", "success", "Generate pipeline stored graph skeleton.", {
      graph_id: response.graph_id,
      cached: response.cached,
      initial_node_ids: initialNodeIds,
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
