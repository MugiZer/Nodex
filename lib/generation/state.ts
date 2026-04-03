import { hashPrompt } from "@/lib/logging";
import {
  generationRunStateSchema,
  generationLogLevelSchema,
  generationLogEventSchema,
  generationStageNameSchema,
} from "@/lib/schemas";
import type {
  CanonicalizeResolvedSuccess,
  GenerationDiagnosticBundle,
  GenerationExecutionPath,
  GenerationGraphDraft,
  GenerationLessonBundle,
  GenerationLogEntry,
  GenerationReconciledGraph,
  GenerationRunState,
  GenerationStoreEligibility,
  GenerationVisualBundle,
  GenerationCurriculumValidationResult,
  GenerationStructureValidationResult,
  RetrievalCandidate,
  RetrievalDecision,
} from "@/lib/types";

type CreationInput = {
  requestId: string;
  prompt: string;
  requestRoute?: string;
  startedAt?: string;
};

type LogEntryInput = Omit<GenerationLogEntry, "details"> & {
  details?: Record<string, unknown> | null;
};

function parseState(nextState: GenerationRunState): GenerationRunState {
  return generationRunStateSchema.parse(nextState) as GenerationRunState;
}

function normalizeRoute(requestRoute?: string): string {
  return requestRoute ?? "POST /api/generate";
}

function normalizeStartedAt(startedAt?: string): string {
  return startedAt ?? new Date().toISOString();
}

export function createGenerationRunState(input: CreationInput): GenerationRunState {
  return parseState({
    request_id: input.requestId,
    request_route: normalizeRoute(input.requestRoute),
    request_started_at: normalizeStartedAt(input.startedAt),
    prompt_hash: hashPrompt(input.prompt),
    prompt: input.prompt,
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
    store_eligibility: null,
    final_graph_id: null,
    error_log: [],
  });
}

export function appendGenerationLogEntry(
  state: GenerationRunState,
  entry: LogEntryInput,
): GenerationRunState {
  const validatedEntry = {
    request_id: entry.request_id,
    stage: generationStageNameSchema.parse(entry.stage),
    event: generationLogEventSchema.parse(entry.event),
    level: generationLogLevelSchema.parse(entry.level),
    message: entry.message,
    timestamp: entry.timestamp,
    duration_ms: entry.duration_ms,
    details: entry.details ?? null,
  };

  return parseState({
    ...state,
    error_log: [...state.error_log, validatedEntry],
  });
}

export function withGenerationExecutionPath(
  state: GenerationRunState,
  executionPath: GenerationExecutionPath,
): GenerationRunState {
  return parseState({
    ...state,
    execution_path: executionPath,
  });
}

export function withCanonicalizedPrompt(
  state: GenerationRunState,
  canonicalized: CanonicalizeResolvedSuccess,
): GenerationRunState {
  return parseState({
    ...state,
    canonicalized,
  });
}

export function withRetrievalDecision(
  state: GenerationRunState,
  retrievalCandidates: RetrievalCandidate[],
  retrievalDecision: RetrievalDecision,
): GenerationRunState {
  return parseState({
    ...state,
    retrieval_candidates: retrievalCandidates,
    retrieval_decision: retrievalDecision,
  });
}

export function withGeneratedGraphDraft(
  state: GenerationRunState,
  generatedGraphDraft: GenerationGraphDraft,
): GenerationRunState {
  return parseState({
    ...state,
    generated_graph_draft: generatedGraphDraft,
  });
}

export function withValidatorOutputs(
  state: GenerationRunState,
  structure: GenerationStructureValidationResult,
  curriculum: GenerationCurriculumValidationResult,
  curriculumAuditStatus: GenerationRunState["validator_outputs"]["curriculum_audit_status"] = "accepted",
): GenerationRunState {
  return parseState({
    ...state,
    validator_outputs: {
      structure,
      curriculum,
      curriculum_audit_status: curriculumAuditStatus,
    },
  });
}

export function withReconciledGraph(
  state: GenerationRunState,
  reconciledGraph: GenerationReconciledGraph,
): GenerationRunState {
  return parseState({
    ...state,
    reconciled_graph: reconciledGraph,
  });
}

export function withLessonBundle(
  state: GenerationRunState,
  lessonBundle: GenerationLessonBundle,
): GenerationRunState {
  return parseState({
    ...state,
    lesson_bundle: lessonBundle,
  });
}

export function withDiagnosticBundle(
  state: GenerationRunState,
  diagnosticBundle: GenerationDiagnosticBundle,
): GenerationRunState {
  return parseState({
    ...state,
    diagnostic_bundle: diagnosticBundle,
  });
}

export function withVisualBundle(
  state: GenerationRunState,
  visualBundle: GenerationVisualBundle,
): GenerationRunState {
  return parseState({
    ...state,
    visual_bundle: visualBundle,
  });
}

export function withStoreEligibility(
  state: GenerationRunState,
  storeEligibility: GenerationStoreEligibility,
): GenerationRunState {
  return parseState({
    ...state,
    store_eligibility: storeEligibility,
  });
}

export function withFinalGraphId(
  state: GenerationRunState,
  finalGraphId: string,
): GenerationRunState {
  return parseState({
    ...state,
    final_graph_id: finalGraphId,
  });
}
