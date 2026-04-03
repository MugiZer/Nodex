import { z } from "zod";

import {
  canonicalizeRequestSchema,
  canonicalizeSuccessSchema,
  canonicalizeResolvedSuccessSchema,
  diagnosticQuestionSchema,
  graphSchema,
  generationEdgeDraftSchema,
  generationGraphDraftSchema,
  generationNodeDraftSchema,
  graphReconciliationModeSchema as graphReconciliationModeDefinition,
  lessonStatusSchema,
  progressAttemptSchema,
  quizItemSchema,
  retrievalCandidateSchema,
  supportedSubjectSchema,
  validateVisualP5CodeRestrictions,
} from "@/lib/schemas";
import { createStageResultEnvelopeSchema } from "@/lib/server/generation/stage-contracts";

export const generationFailureCategorySchema = z.enum([
  "canonicalize_error",
  "retrieval_error",
  "llm_output_invalid",
  "llm_contract_violation",
  "graph_boundary_violation",
  "input_precondition_failed",
  "repair_exhausted",
  "upstream_timeout",
  "store_error",
  "unexpected_internal_error",
]);

export const retrievalDecisionReasonSchema = z.enum([
  "below_threshold",
  "usable_unflagged_match",
  "only_flagged_matches",
  "no_candidates",
]);

export const retrievalDecisionSchema = z
  .object({
    graph_id: z.string().uuid().nullable(),
    reason: retrievalDecisionReasonSchema,
    candidate: retrievalCandidateSchema.nullable(),
  })
  .strict();

export const structureIssueTypeSchema = z.enum([
  "circular_dependency",
  "missing_hard_edge",
  "edge_misclassification",
  "redundant_edge",
  "position_inconsistency",
  "orphaned_subgraph",
]);

export const curriculumIssueTypeSchema = z.enum([
  "missing_concept",
  "incorrect_ordering",
  "out_of_scope_concept",
  "pedagogical_misalignment",
  "level_mismatch",
]);

export const validatorSeveritySchema = z.enum(["critical", "major", "minor"]);

export const structureValidatorIssueSchema = z
  .object({
    type: structureIssueTypeSchema,
    severity: validatorSeveritySchema,
    nodes_involved: z.array(generationNodeDraftSchema.shape.id).min(1),
    description: z.string().trim().min(1),
    suggested_fix: z.string().trim().min(1),
  })
  .strict();

export const structureValidatorModelOutputSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(structureValidatorIssueSchema),
  })
  .strict();

export const structureValidatorOutputSchema = structureValidatorModelOutputSchema
  .superRefine((value, ctx) => {
    if (value.valid && value.issues.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structure validator cannot return issues when valid is true.",
        path: ["issues"],
      });
    }

    if (!value.valid && value.issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Structure validator must return issues when valid is false.",
        path: ["issues"],
      });
    }
  });

export function normalizeStructureValidatorOutput(
  value: z.infer<typeof structureValidatorModelOutputSchema>,
): StructureValidatorOutput {
  return structureValidatorOutputSchema.parse({
    valid: value.issues.length === 0,
    issues: value.issues,
  });
}

export const curriculumValidatorIssueSchema = z
  .object({
    type: curriculumIssueTypeSchema,
    severity: validatorSeveritySchema,
    nodes_involved: z.array(generationNodeDraftSchema.shape.id),
    missing_concept_title: z.string().trim().min(1).nullable(),
    description: z.string().trim().min(1).max(160),
    suggested_fix: z.string().trim().min(1).max(140),
    curriculum_basis: z.string().trim().min(1).max(160),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "missing_concept") {
      if (!value.missing_concept_title) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Missing concept issues require missing_concept_title.",
          path: ["missing_concept_title"],
        });
      }
      return;
    }

    if (value.missing_concept_title !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only missing_concept issues may include missing_concept_title.",
        path: ["missing_concept_title"],
      });
    }

    if (value.nodes_involved.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-missing_concept issues must identify nodes_involved.",
        path: ["nodes_involved"],
      });
    }
  });

export const curriculumValidatorModelOutputSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(curriculumValidatorIssueSchema).max(3),
  })
  .strict();

export const curriculumValidatorOutputSchema = curriculumValidatorModelOutputSchema
  .superRefine((value, ctx) => {
    if (value.valid && value.issues.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Curriculum validator cannot return issues when valid is true.",
        path: ["issues"],
      });
    }

    if (!value.valid && value.issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Curriculum validator must return issues when valid is false.",
        path: ["issues"],
      });
    }
  });

export function normalizeCurriculumValidatorOutput(
  value: z.infer<typeof curriculumValidatorModelOutputSchema>,
): CurriculumValidatorOutput {
  return curriculumValidatorOutputSchema.parse({
    valid: value.issues.length === 0,
    issues: value.issues,
  });
}

export const curriculumAuditStatusSchema = z.enum([
  "accepted",
  "skipped_timeout",
  "skipped_contract_failure",
  "disabled_async",
]);

export const curriculumOutcomeBucketSchema = z.enum([
  "accepted_clean",
  "accepted_with_issues",
  "skipped_timeout",
  "skipped_contract_failure",
  "disabled_async",
]);

export const curriculumAuditPhaseSchema = z.enum([
  "synchronous_placeholder",
  "sync_complete",
  "async_complete",
]);

export const graphReconciliationModeSchema = graphReconciliationModeDefinition;

export const resolutionSourceSchema = z.enum([
  "structure_validator",
  "curriculum_validator",
  "both",
]);

export const reconcilerResolutionSchema = z
  .object({
    issue_key: z.string().trim().min(1),
    issue_source: resolutionSourceSchema,
    issue_description: z.string().trim().min(1),
    resolution_action: z.string().trim().min(1),
  })
  .strict();

export const reconcilerOutputSchema = z
  .object({
    nodes: z.array(generationNodeDraftSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
    resolution_summary: z.array(reconcilerResolutionSchema),
  })
  .strict();

export const lessonNodeArtifactSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    lesson_text: z.string().trim().min(1),
    static_diagram: z.string().trim().min(1),
    quiz_json: z.array(quizItemSchema).length(3),
  })
  .strict();

export const lessonStageOutputSchema = z
  .object({
    nodes: z.array(lessonNodeArtifactSchema),
  })
  .strict();

export const lessonEnrichedNodeSchema = generationNodeDraftSchema
  .extend({
    lesson_text: z.string().trim().min(1),
    static_diagram: z.string().trim().min(1),
    quiz_json: z.array(quizItemSchema).length(3),
  })
  .strict();

export const diagnosticNodeArtifactSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    diagnostic_questions: z.array(diagnosticQuestionSchema).length(1),
  })
  .strict();

export const diagnosticStageOutputSchema = z
  .object({
    nodes: z.array(diagnosticNodeArtifactSchema),
  })
  .strict();

export const diagnosticEnrichedNodeSchema = lessonEnrichedNodeSchema
  .extend({
    diagnostic_questions: z.array(diagnosticQuestionSchema).length(1),
  })
  .strict();

export const visualNodeArtifactSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    p5_code: z.string(),
    visual_verified: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.visual_verified) {
      const violations = validateVisualP5CodeRestrictions(value.p5_code);
      if (violations.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Visual code contains restricted snippets: ${violations.join(", ")}.`,
          path: ["p5_code"],
        });
      }
      return;
    }

    const code = value.p5_code.trim();
    if (code.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Verified visuals must include non-empty p5_code.",
        path: ["p5_code"],
      });
    }

    for (const requiredSnippet of [
      "function setup",
      "function draw",
      "createCanvas(480, 320)",
    ]) {
      if (!code.includes(requiredSnippet)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Verified visuals must include ${requiredSnippet}.`,
          path: ["p5_code"],
        });
      }
    }

    const violations = validateVisualP5CodeRestrictions(code);
    if (violations.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Verified visuals must not include restricted snippets: ${violations.join(", ")}.`,
        path: ["p5_code"],
      });
    }
  });

export const visualStageOutputSchema = z
  .object({
    nodes: z.array(visualNodeArtifactSchema),
  })
  .strict();

const stageContextSchema = z
  .object({
    subject: canonicalizeSuccessSchema.shape.subject,
    topic: canonicalizeSuccessSchema.shape.topic,
    description: canonicalizeSuccessSchema.shape.description,
  })
  .strict();

export const lessonsRouteRequestSchema = stageContextSchema
  .extend({
    nodes: z.array(generationNodeDraftSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const diagnosticsRouteRequestSchema = stageContextSchema
  .extend({
    nodes: z.array(lessonEnrichedNodeSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const visualsRouteRequestSchema = stageContextSchema
  .extend({
    nodes: z.array(diagnosticEnrichedNodeSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const generatedNodeArtifactSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    title: generationNodeDraftSchema.shape.title,
    position: generationNodeDraftSchema.shape.position,
    lesson_text: z.string().trim().min(1),
    static_diagram: z.string().trim().min(1),
    p5_code: z.string(),
    visual_verified: z.boolean(),
    quiz_json: z.array(quizItemSchema).length(3),
    diagnostic_questions: z.array(diagnosticQuestionSchema).length(1),
    lesson_status: lessonStatusSchema.optional().default("ready"),
  })
  .strict();

export const generatedGraphArtifactSchema = z
  .object({
    nodes: z.array(generatedNodeArtifactSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const persistedNodeArtifactSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    title: generationNodeDraftSchema.shape.title,
    position: generationNodeDraftSchema.shape.position,
    lesson_text: z.string().trim().min(1).nullable(),
    static_diagram: z.string().trim().min(1).nullable(),
    p5_code: z.string().nullable(),
    visual_verified: z.boolean(),
    quiz_json: z.array(quizItemSchema).length(3).nullable(),
    diagnostic_questions: z.array(diagnosticQuestionSchema).length(1).nullable(),
    lesson_status: lessonStatusSchema.optional().default("ready"),
  })
  .strict();

export const graphMetadataDraftSchema = z
  .object({
    title: z.string().trim().min(1),
    subject: supportedSubjectSchema,
    topic: canonicalizeSuccessSchema.shape.topic,
    description: canonicalizeSuccessSchema.shape.description,
  })
  .strict();

export const storeGraphInputSchema = z.union([
  graphSchema,
  graphMetadataDraftSchema,
]);

export const storeRouteRequestSchema = z
  .object({
    graph: storeGraphInputSchema,
    nodes: z.array(persistedNodeArtifactSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const skeletonStoreNodeSchema = z
  .object({
    id: generationNodeDraftSchema.shape.id,
    title: generationNodeDraftSchema.shape.title,
    position: generationNodeDraftSchema.shape.position,
  })
  .strict();

export const skeletonStoreRequestSchema = z
  .object({
    graph: graphMetadataDraftSchema,
    nodes: z.array(skeletonStoreNodeSchema).min(10).max(25),
    edges: z.array(generationEdgeDraftSchema).min(1),
  })
  .strict();

export const generateEnrichRouteRequestSchema = z
  .object({
    graph_id: z.string().uuid(),
    limit: z.number().int().min(1).max(4).optional(),
    retry_failed: z.boolean().optional(),
  })
  .strict();

export const generateEnrichRouteResponseSchema = z
  .object({
    graph_id: z.string().uuid(),
    request_id: z.string().trim().min(1),
    selected_node_ids: z.array(z.string().uuid()),
    processed_node_ids: z.array(z.string().uuid()),
    ready_node_ids: z.array(z.string().uuid()),
    failed_node_ids: z.array(z.string().uuid()),
    remaining_pending_node_ids: z.array(z.string().uuid()),
  })
  .strict();

export const storeRouteResponseSchema = z
  .object({
    graph_id: z.string().uuid(),
    duplicate_of_graph_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export const lessonsRouteResponseSchema = createStageResultEnvelopeSchema(
  lessonStageOutputSchema,
);

export const diagnosticsRouteResponseSchema = createStageResultEnvelopeSchema(
  diagnosticStageOutputSchema,
);

export const visualsRouteResponseSchema = createStageResultEnvelopeSchema(
  visualStageOutputSchema,
);

export const storeStageDataSchema = z
  .object({
    graph_id: z.string().uuid(),
    duplicate_of_graph_id: z.string().uuid().nullable().optional(),
    write_mode: z.enum(["persisted", "duplicate_recheck_hit"]),
    remapped_node_count: z.number().int().nonnegative(),
    persisted_node_count: z.number().int().nonnegative(),
    persisted_edge_count: z.number().int().nonnegative(),
  })
  .strict();

export const storeStageResponseSchema = createStageResultEnvelopeSchema(
  storeStageDataSchema,
);

export const generateRouteRequestSchema = canonicalizeRequestSchema;

export const generateRouteResponseSchema = z
  .object({
    graph_id: z.string().uuid(),
    cached: z.boolean(),
  })
  .strict();

export const generationStoreEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason: z.string().nullable(),
  })
  .strict();

export const generationLogEntrySchema = z
  .object({
    request_id: z.string().trim().min(1),
    stage: z.string().trim().min(1),
    event: z.enum(["start", "success", "error", "retry"]),
    level: z.enum(["info", "warn", "error"]),
    message: z.string().trim().min(1),
    timestamp: z.string().datetime(),
    duration_ms: z.number().int().nonnegative(),
    failure_category: generationFailureCategorySchema.optional(),
    details: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const generationRunStateSchema = z
  .object({
    request_id: z.string().trim().min(1),
    request_route: z.string().trim().min(1),
    request_started_at: z.string().datetime(),
    prompt_hash: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    canonicalized: canonicalizeResolvedSuccessSchema.nullable(),
    retrieval_candidates: z.array(retrievalCandidateSchema),
    retrieval_decision: retrievalDecisionSchema.nullable(),
    execution_path: z.enum(["cache_hit", "generate"]).nullable(),
    generated_graph_draft: generationGraphDraftSchema.nullable(),
    validator_outputs: z
      .object({
        structure: structureValidatorOutputSchema.nullable(),
        curriculum: curriculumValidatorOutputSchema.nullable(),
        curriculum_audit_status: curriculumAuditStatusSchema.nullable(),
      })
      .strict(),
    reconciled_graph: reconcilerOutputSchema.nullable(),
    lesson_bundle: lessonStageOutputSchema.nullable(),
    diagnostic_bundle: diagnosticStageOutputSchema.nullable(),
    visual_bundle: visualStageOutputSchema.nullable(),
    store_eligibility: generationStoreEligibilitySchema.nullable(),
    final_graph_id: z.string().uuid().nullable(),
    error_log: z.array(generationLogEntrySchema),
  })
  .strict();

export const generationAttemptRecordSchema = z
  .object({
    score: progressAttemptSchema.shape.score,
    timestamp: progressAttemptSchema.shape.timestamp,
  })
  .strict();

export type RetrievalDecision = z.infer<typeof retrievalDecisionSchema>;
export type StructureValidatorOutput = z.infer<typeof structureValidatorOutputSchema>;
export type CurriculumValidatorOutput = z.infer<typeof curriculumValidatorOutputSchema>;
export type CurriculumAuditStatus = z.infer<typeof curriculumAuditStatusSchema>;
export type GraphReconciliationMode = z.infer<typeof graphReconciliationModeSchema>;
export type ReconcilerOutput = z.infer<typeof reconcilerOutputSchema>;
export type LessonNodeArtifact = z.infer<typeof lessonNodeArtifactSchema>;
export type LessonStageOutput = z.infer<typeof lessonStageOutputSchema>;
export type LessonEnrichedNode = z.infer<typeof lessonEnrichedNodeSchema>;
export type DiagnosticNodeArtifact = z.infer<typeof diagnosticNodeArtifactSchema>;
export type DiagnosticStageOutput = z.infer<typeof diagnosticStageOutputSchema>;
export type DiagnosticEnrichedNode = z.infer<typeof diagnosticEnrichedNodeSchema>;
export type VisualNodeArtifact = z.infer<typeof visualNodeArtifactSchema>;
export type VisualStageOutput = z.infer<typeof visualStageOutputSchema>;
export type GeneratedNodeArtifact = z.infer<typeof generatedNodeArtifactSchema>;
export type GeneratedGraphArtifact = z.infer<typeof generatedGraphArtifactSchema>;
export type PersistedNodeArtifact = z.infer<typeof persistedNodeArtifactSchema>;
export type GraphMetadataDraft = z.infer<typeof graphMetadataDraftSchema>;
export type LessonsRouteRequest = z.infer<typeof lessonsRouteRequestSchema>;
export type DiagnosticsRouteRequest = z.infer<typeof diagnosticsRouteRequestSchema>;
export type VisualsRouteRequest = z.infer<typeof visualsRouteRequestSchema>;
export type StoreRouteRequest = z.infer<typeof storeRouteRequestSchema>;
export type StoreRouteResponse = z.infer<typeof storeRouteResponseSchema>;
export type StoreStageData = z.infer<typeof storeStageDataSchema>;
export type GenerateRouteResponse = z.infer<typeof generateRouteResponseSchema>;
export type GenerationFailureCategory = z.infer<typeof generationFailureCategorySchema>;
export type GenerationRunState = z.infer<typeof generationRunStateSchema>;
export type SkeletonStoreRequest = z.infer<typeof skeletonStoreRequestSchema>;
export type GenerateEnrichRouteRequest = z.infer<typeof generateEnrichRouteRequestSchema>;
export type GenerateEnrichRouteResponse = z.infer<typeof generateEnrichRouteResponseSchema>;
