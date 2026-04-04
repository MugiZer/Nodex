import { z } from "zod";

import {
  CANONICALIZATION_VERSION,
  CANONICALIZATION_SOURCES,
  CANDIDATE_CONFIDENCE_BANDS,
  CANONICALIZE_LEVELS,
  STAGE_ERROR_CODES,
  STAGE_ERROR_CATEGORIES,
  STAGE_NAMES,
  SUPPORTED_SUBJECTS,
  STAGE_WARNING_CODES,
} from "@/lib/types";
import type {
  StageError,
  StageLogEntry,
  StageResultEnvelope,
  StageRunSummary,
  StageWarning,
} from "@/lib/types";

export const supportedSubjectSchema = z.enum(SUPPORTED_SUBJECTS);
export const edgeTypeSchema = z.enum(["hard", "soft"]);
export const lessonStatusSchema = z.enum(["pending", "ready", "failed"]);

function normalizeDbTimestamp(value: string): string {
  let normalized = value.trim();

  normalized = normalized.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/,
    "$1T$2",
  );

  normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
  normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }

  return normalized;
}

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const dbTimestampSchema = z
  .string()
  .transform(normalizeDbTimestamp)
  .pipe(isoTimestampSchema);

export const progressAttemptSchema = z.object({
  score: z.number().int().min(0),
  timestamp: dbTimestampSchema,
});

const fourOptionArraySchema = z.array(z.string().min(1)).length(4);

export const quizItemSchema = z.object({
  question: z.string().min(1),
  options: fourOptionArraySchema,
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
}).strict();

export const diagnosticQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: fourOptionArraySchema,
    correct_index: z.number().int().min(0).max(3),
    difficulty_order: z.number().int(),
    node_id: z.string().min(1),
  })
  .strict();

export const graphSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  subject: supportedSubjectSchema,
  topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  version: z.number().int().min(1),
  flagged_for_review: z.boolean(),
  created_at: dbTimestampSchema,
}).strict();

export const nodeSchema = z.object({
  id: z.string().uuid(),
  graph_id: z.string().uuid(),
  graph_version: z.number().int().min(1),
  title: z.string().min(1),
  lesson_text: z.string().nullable(),
  static_diagram: z.string().nullable(),
  p5_code: z.string().nullable(),
  visual_verified: z.boolean(),
  quiz_json: z.array(quizItemSchema).length(3).nullable(),
  diagnostic_questions: z.array(diagnosticQuestionSchema).length(1).nullable(),
  lesson_status: lessonStatusSchema,
  position: z.number().int().min(0),
  attempt_count: z.number().int().min(0),
  pass_count: z.number().int().min(0),
}).strict();

export const edgeSchema = z.object({
  from_node_id: z.string().uuid(),
  to_node_id: z.string().uuid(),
  type: edgeTypeSchema,
}).strict();

export const userProgressSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  node_id: z.string().uuid(),
  graph_version: z.number().int().min(1),
  completed: z.boolean(),
  attempts: z.array(progressAttemptSchema),
}).strict();

export const graphPayloadSchema = z.object({
  graph: graphSchema,
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  progress: z.array(userProgressSchema),
}).strict();

export const prerequisiteDiagnosticSessionQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: fourOptionArraySchema,
    correctIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
  })
  .strict();

export const prerequisiteDiagnosticSessionGroupSchema = z
  .object({
    name: z.string().min(1),
    questions: z.array(prerequisiteDiagnosticSessionQuestionSchema).length(2),
  })
  .strict();

export const storedPrerequisiteLessonSchema = z
  .object({
    name: z.string().trim().min(1),
    lesson: z.unknown(),
  })
  .strict();

export const storedGraphDiagnosticResultSchema = z
  .object({
    requestId: z.string().trim().min(1),
    graphId: z.string().uuid(),
    topic: z.string().trim().min(1),
    gapNames: z.array(z.string().trim().min(1)),
    gapPrerequisites: z.array(prerequisiteDiagnosticSessionGroupSchema),
    gapPrerequisiteLessons: z.array(storedPrerequisiteLessonSchema),
    completedGapNodeIds: z.array(z.string().trim().min(1)),
  })
  .strict();

export const appendedPrerequisiteNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    position: z.number().int(),
    lesson_text: z.string().min(1),
    isPrerequisite: z.literal(true),
  })
  .strict();

export const graphDiagnosticRouteResponseSchema = storedGraphDiagnosticResultSchema;

export const lessonResolverRouteResponseSchema = z
  .object({
    ready: z.boolean(),
    source: z.enum(["graph", "prerequisite"]),
    node: z.union([nodeSchema, appendedPrerequisiteNodeSchema]).nullable(),
    graph_diagnostic_result: storedGraphDiagnosticResultSchema.nullable(),
  })
  .strict();

export function validateCanonicalDescription(description: string): boolean {
  const normalized = description.replace(/\s+/g, " ").trim();
  const marker1 = " is the study of ";
  const marker2 = ". It encompasses ";
  const marker3 = ". It assumes prior knowledge of ";
  const marker4 = " and serves as a foundation for ";
  const marker5 = ". Within ";
  const marker6 = ", it is typically encountered at the ";
  const levelSuffix = " level.";

  const index1 = normalized.indexOf(marker1);
  const index2 = normalized.indexOf(marker2);
  const index3 = normalized.indexOf(marker3);
  const index4 = normalized.indexOf(marker4);
  const index5 = normalized.indexOf(marker5);
  const index6 = normalized.indexOf(marker6);

  if (
    index1 <= 0 ||
    index2 <= index1 ||
    index3 <= index2 ||
    index4 <= index3 ||
    index5 <= index4 ||
    index6 <= index5 ||
    !normalized.endsWith(levelSuffix)
  ) {
    return false;
  }

  const topicLabel = normalized.slice(0, index1);
  const scopeSummary = normalized.slice(index1 + marker1.length, index2);
  const coreConcepts = normalized.slice(index2 + marker2.length, index3);
  const prerequisites = normalized.slice(index3 + marker3.length, index4);
  const downstreamTopics = normalized.slice(index4 + marker4.length, index5);
  const subject = normalized.slice(index5 + marker5.length, index6);
  const level = normalized.slice(index6 + marker6.length, -levelSuffix.length);

  return (
    /^[A-Z][A-Za-z.\s]+$/.test(topicLabel) &&
    scopeSummary.length > 0 &&
    coreConcepts.length > 0 &&
    prerequisites.length > 0 &&
    downstreamTopics.length > 0 &&
    /^[a-z_]+$/.test(subject) &&
    /^(introductory|intermediate|advanced)$/.test(level)
  );
}

export type CanonicalDescriptionParts = {
  topic_label: string;
  scope_summary: string;
  core_concepts: string[];
  prerequisites: string[];
  downstream_topics: string[];
  subject: string;
  level: "introductory" | "intermediate" | "advanced";
};

function splitCanonicalList(segment: string): string[] {
  return segment
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseCanonicalDescription(
  description: string,
): CanonicalDescriptionParts | null {
  const normalized = description.replace(/\s+/g, " ").trim();
  const marker1 = " is the study of ";
  const marker2 = ". It encompasses ";
  const marker3 = ". It assumes prior knowledge of ";
  const marker4 = " and serves as a foundation for ";
  const marker5 = ". Within ";
  const marker6 = ", it is typically encountered at the ";
  const levelSuffix = " level.";

  const index1 = normalized.indexOf(marker1);
  const index2 = normalized.indexOf(marker2);
  const index3 = normalized.indexOf(marker3);
  const index4 = normalized.indexOf(marker4);
  const index5 = normalized.indexOf(marker5);
  const index6 = normalized.indexOf(marker6);

  if (
    index1 <= 0 ||
    index2 <= index1 ||
    index3 <= index2 ||
    index4 <= index3 ||
    index5 <= index4 ||
    index6 <= index5 ||
    !normalized.endsWith(levelSuffix)
  ) {
    return null;
  }

  const level = normalized.slice(index6 + marker6.length, -levelSuffix.length);
  if (
    level !== "introductory" &&
    level !== "intermediate" &&
    level !== "advanced"
  ) {
    return null;
  }

  return {
    topic_label: normalized.slice(0, index1),
    scope_summary: normalized.slice(index1 + marker1.length, index2),
    core_concepts: splitCanonicalList(
      normalized.slice(index2 + marker2.length, index3),
    ),
    prerequisites: splitCanonicalList(
      normalized.slice(index3 + marker3.length, index4),
    ),
    downstream_topics: splitCanonicalList(
      normalized.slice(index4 + marker4.length, index5),
    ),
    subject: normalized.slice(index5 + marker5.length, index6),
    level,
  };
}

const DISALLOWED_P5_SNIPPETS = [
  "import ",
  "export ",
  "<script",
  "fetch(",
  "loadImage(",
  "loadJSON(",
  "loadFont(",
  "http://",
  "https://",
] as const;

export function validateVisualP5CodeRestrictions(code: string): string[] {
  const violations: string[] = [];
  for (const snippet of DISALLOWED_P5_SNIPPETS) {
    if (code.includes(snippet)) {
      violations.push(snippet);
    }
  }
  return violations;
}

export const canonicalizeLevelSchema = z.enum(CANONICALIZE_LEVELS);
export const canonicalizationSourceSchema = z.enum(CANONICALIZATION_SOURCES);
export const candidateConfidenceBandSchema = z.enum(CANDIDATE_CONFIDENCE_BANDS);

const canonicalizeListItemSchema = z.string().trim().min(1);

export const canonicalizePublicSuccessSchema = z
  .object({
    subject: supportedSubjectSchema,
    topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
  })
  .refine((value) => validateCanonicalDescription(value.description), {
    message: "Description must follow the exact four-sentence canonical contract.",
    path: ["description"],
  })
  .strict();

export const canonicalizeModelSuccessDraftSchema = z
  .object({
    subject: supportedSubjectSchema,
    topic: z.string().trim().min(1),
    scope_summary: z.string().trim().min(1),
    core_concepts: z.array(canonicalizeListItemSchema).min(1).max(12),
    prerequisites: z.array(canonicalizeListItemSchema).min(1).max(8),
    downstream_topics: z.array(canonicalizeListItemSchema).min(3).max(8),
    level: canonicalizeLevelSchema,
  })
  .strict();

export const canonicalizeInventoryEntrySchema = canonicalizeModelSuccessDraftSchema
  .extend({
    aliases: z.array(canonicalizeListItemSchema).min(1),
    broad_prompt_aliases: z.array(canonicalizeListItemSchema),
    starter_for_subject: supportedSubjectSchema.nullable(),
  })
  .strict();

export const canonicalizeResolvedSuccessSchema = canonicalizePublicSuccessSchema
  .extend({
    scope_summary: z.string().trim().min(1),
    core_concepts: z.array(canonicalizeListItemSchema).min(4).max(8),
    prerequisites: z.array(canonicalizeListItemSchema).min(1).max(6),
    downstream_topics: z.array(canonicalizeListItemSchema).min(3).max(8),
    level: canonicalizeLevelSchema,
    canonicalization_source: canonicalizationSourceSchema,
    inventory_candidate_topics: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(5),
    candidate_confidence_band: candidateConfidenceBandSchema,
    canonicalization_version: z.literal(CANONICALIZATION_VERSION),
  })
  .strict();

export const canonicalizeSuccessSchema = canonicalizePublicSuccessSchema;
export const canonicalizeFailureSchema = z.object({
  error: z.literal("NOT_A_LEARNING_REQUEST"),
}).strict();

export const canonicalizeResultSchema = z.union([
  canonicalizeSuccessSchema,
  canonicalizeFailureSchema,
]);

export const canonicalizeModelResultSchema = z.union([
  canonicalizeModelSuccessDraftSchema,
  canonicalizeFailureSchema,
]);

export const canonicalizeResolvedResultSchema = z.union([
  canonicalizeResolvedSuccessSchema,
  canonicalizeFailureSchema,
]);

export const canonicalizeRequestSchema = z.object({
  prompt: z.string().trim().min(1),
}).strict();

export const retrieveRequestSchema = z.object({
  subject: supportedSubjectSchema,
  description: z.string().trim().min(1),
}).strict();

export const retrieveResponseSchema = z.object({
  graph_id: z.string().uuid().nullable(),
}).strict();

export const graphRouteRequestSchema = z.object({
  subject: supportedSubjectSchema,
  topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().trim().min(1),
  prerequisites: z.array(canonicalizeListItemSchema).min(1).max(6).optional(),
  downstream_topics: z.array(canonicalizeListItemSchema).min(3).max(8).optional(),
}).strict();

export const retrievalCandidateSchema = z.object({
  id: z.string().uuid(),
  similarity: z.number().min(-1).max(1),
  flagged_for_review: z.boolean(),
  version: z.number().int().min(1),
  created_at: dbTimestampSchema,
}).strict();

export const retrievalDecisionSchema = z
  .object({
    graph_id: z.string().uuid().nullable(),
    reason: z.enum([
      "below_threshold",
      "usable_unflagged_match",
      "only_flagged_matches",
      "no_candidates",
    ]),
    candidate: z.lazy(() => retrievalCandidateSchema).nullable(),
  })
  .strict();

export const progressWriteRequestSchema = z.object({
  graph_id: z.string().uuid(),
  node_id: z.string().uuid(),
  score: z.number().int().min(0).max(3),
  timestamp: isoTimestampSchema.optional(),
}).strict();

export const progressWriteResponseSchema = z.object({
  progress: userProgressSchema,
  available_node_ids: z.array(z.string().uuid()),
  flagged_for_review: z.boolean(),
}).strict();

export const generationNodeDraftSchema = z.object({
  id: z.string().regex(/^node_[1-9][0-9]*$/),
  title: z.string().min(1),
  position: z.number().int().min(0),
}).strict();

export const generationEdgeDraftSchema = z.object({
  from_node_id: z.string().regex(/^node_[1-9][0-9]*$/),
  to_node_id: z.string().regex(/^node_[1-9][0-9]*$/),
  type: edgeTypeSchema,
}).strict();

export const generationGraphDraftSchema = z.object({
  nodes: z.array(generationNodeDraftSchema).min(4).max(25),
  edges: z.array(generationEdgeDraftSchema).min(1),
}).strict();

export const graphRouteResponseSchema = generationGraphDraftSchema;

export const generationCurriculumAuditStatusSchema = z.enum([
  "accepted",
  "skipped_timeout",
  "skipped_contract_failure",
  "disabled_async",
]);

export const generationCurriculumOutcomeBucketSchema = z.enum([
  "accepted_clean",
  "accepted_with_issues",
  "skipped_timeout",
  "skipped_contract_failure",
  "disabled_async",
]);

export const generationCurriculumAuditPhaseSchema = z.enum([
  "synchronous_placeholder",
  "sync_complete",
  "async_complete",
]);

export const generationStageNameSchema = z.enum([
  "canonicalize",
  "retrieve",
  "graph_generator",
  "structure_validator",
  "curriculum_validator",
  "reconciler",
  "lessons",
  "diagnostics",
  "visuals",
  "store",
]);

export const generationExecutionPathSchema = z.enum(["cache_hit", "generate"]);

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

export const generationLogLevelSchema = z.enum(["info", "warn", "error"]);

export const generationLogEventSchema = z.enum([
  "start",
  "success",
  "retry",
  "error",
]);

export const generationStoreEligibilityReasonSchema = z.enum([
  "ready_to_store",
  "cache_hit",
  "duplicate_recheck_hit",
  "missing_required_artifact",
  "validation_failed",
  "repair_failure",
  "store_error",
  "not_applicable",
]);

export const generationStructureIssueTypeSchema = z.enum([
  "circular_dependency",
  "boundary_violation",
  "missing_hard_edge",
  "edge_misclassification",
  "redundant_edge",
  "position_inconsistency",
  "orphaned_subgraph",
]);

export const generationStructureIssueSeveritySchema = z.enum([
  "critical",
  "major",
  "minor",
]);

export const generationStructureIssueSchema = z
  .object({
    type: generationStructureIssueTypeSchema,
    severity: generationStructureIssueSeveritySchema,
    nodes_involved: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    suggested_fix: z.string().min(1),
  })
  .strict();

export const generationStructureValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(generationStructureIssueSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.valid && value.issues.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valid=true requires an empty issues array.",
      });
    }

    if (!value.valid && value.issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valid=false requires at least one issue.",
      });
    }
  });

export const generationCurriculumIssueTypeSchema = z.enum([
  "missing_concept",
  "incorrect_ordering",
  "out_of_scope_concept",
  "pedagogical_misalignment",
  "level_mismatch",
]);

export const generationCurriculumIssueSeveritySchema = z.enum([
  "critical",
  "major",
  "minor",
]);

export const generationCurriculumIssueSchema = z
  .object({
    type: generationCurriculumIssueTypeSchema,
    severity: generationCurriculumIssueSeveritySchema,
    nodes_involved: z.array(z.string().min(1)),
    missing_concept_title: z.string().min(1).nullable(),
    description: z.string().trim().min(1).max(160),
    suggested_fix: z.string().trim().min(1).max(140),
    curriculum_basis: z.string().trim().min(1).max(160),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "missing_concept") {
      if (value.missing_concept_title === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "missing_concept issues require missing_concept_title.",
        });
      }
      return;
    }

    if (value.missing_concept_title !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-missing_concept issues must set missing_concept_title to null.",
      });
    }

    if (value.nodes_involved.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-missing_concept issues require at least one node id.",
      });
    }
  });

export const generationCurriculumValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(generationCurriculumIssueSchema).max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.valid && value.issues.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valid=true requires an empty issues array.",
      });
    }

    if (!value.valid && value.issues.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valid=false requires at least one issue.",
      });
    }
  });

export const generationResolutionSourceSchema = z.enum([
  "structure_validator",
  "curriculum_validator",
  "both",
]);

export const generationResolutionSummaryEntrySchema = z
  .object({
    issue_key: z.string().min(1),
    issue_source: generationResolutionSourceSchema,
    issue_description: z.string().min(1),
    resolution_action: z.string().min(1),
  })
  .strict();

export const graphReconciliationModeSchema = z.enum([
  "deterministic_only",
  "deterministic_only_repaired",
  "llm_reconcile",
  "repair_fallback",
]);

export const graphRouteIssueCountMapSchema = z.record(
  z.string().min(1),
  z.number().int().nonnegative(),
);

export const graphRouteOutcomeBucketSchema = z.enum([
  "deterministic_only_clean",
  "deterministic_only_repaired",
  "llm_reconcile_due_to_structure",
  "llm_reconcile_due_to_curriculum",
]);

export const graphRouteTelemetrySchema = z
  .object({
    outcome_bucket: graphRouteOutcomeBucketSchema,
    repair_mode: graphReconciliationModeSchema,
    curriculum_audit_status: generationCurriculumAuditStatusSchema,
    curriculum_outcome_bucket: generationCurriculumOutcomeBucketSchema,
    structure_issue_type_counts: graphRouteIssueCountMapSchema,
    structure_issue_key_counts: graphRouteIssueCountMapSchema,
    curriculum_issue_type_counts: graphRouteIssueCountMapSchema,
    curriculum_issue_key_counts: graphRouteIssueCountMapSchema,
    resolution_summary_issue_key_counts: graphRouteIssueCountMapSchema,
  })
  .strict();

export const generationReconciledGraphSchema = generationGraphDraftSchema.extend({
  resolution_summary: z.array(generationResolutionSummaryEntrySchema),
});

export const graphRouteDebugTimingSchema = z
  .object({
    graph_generate_ms: z.number().int().nonnegative(),
    structure_validate_ms: z.number().int().nonnegative(),
    curriculum_validate_ms: z.number().int().nonnegative(),
    reconcile_ms: z.number().int().nonnegative(),
    total_ms: z.number().int().nonnegative(),
  })
  .strict();

export const graphRouteDebugSchema = z
  .object({
    request_id: z.string().trim().min(1),
    structure: generationStructureValidationResultSchema,
    curriculum: generationCurriculumValidationResultSchema,
    audit_status: generationCurriculumAuditStatusSchema,
    curriculum_audit_phase: generationCurriculumAuditPhaseSchema,
    telemetry: graphRouteTelemetrySchema,
    reconciliation: z
      .object({
        resolution_summary: z.array(generationResolutionSummaryEntrySchema),
        repair_mode: graphReconciliationModeSchema,
      })
      .strict(),
    timings: graphRouteDebugTimingSchema,
  })
  .strict();

export const graphRouteDebugResponseSchema = generationGraphDraftSchema.extend({
  debug: graphRouteDebugSchema,
});

export const curriculumAuditRecordSchema = z
  .object({
    request_id: z.string().trim().min(1),
    request_fingerprint: z.string().trim().min(1),
    subject: supportedSubjectSchema,
    topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
    audit_status: generationCurriculumAuditStatusSchema,
    outcome_bucket: generationCurriculumOutcomeBucketSchema,
    attempt_count: z.number().int().nonnegative(),
    failure_category: generationFailureCategorySchema.nullable(),
    parse_error_summary: z.string().nullable(),
    duration_ms: z.number().int().nonnegative(),
    issue_count: z.number().int().nonnegative(),
    async_audit: z.boolean(),
    created_at: dbTimestampSchema,
    updated_at: dbTimestampSchema,
  })
  .strict();

export const graphCurriculumAuditReadResponseSchema = z
  .object({
    request_id: z.string().trim().min(1),
    audit: curriculumAuditRecordSchema.nullable(),
  })
  .strict();

export const lessonNodeSchema = nodeSchema.extend({
  lesson_text: z.string().min(1),
  static_diagram: z.string().min(1),
  quiz_json: z.array(quizItemSchema).length(3),
});

export const generationLessonBundleSchema = z
  .object({
    nodes: z.array(lessonNodeSchema).min(4).max(25),
  })
  .strict();

export const diagnosticNodeSchema = nodeSchema.extend({
  diagnostic_questions: z.array(diagnosticQuestionSchema).length(1),
});

export const generationDiagnosticBundleSchema = z
  .object({
    nodes: z.array(diagnosticNodeSchema).min(4).max(25),
  })
  .strict();

export const visualNodeSchema = nodeSchema
  .extend({
    p5_code: z.string(),
    visual_verified: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.visual_verified && value.p5_code.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "visual_verified=true requires non-empty p5_code.",
      });
    }
  });

export const generationVisualBundleSchema = z
  .object({
    nodes: z.array(visualNodeSchema).min(4).max(25),
  })
  .strict();

export const generationStoreEligibilitySchema = z
  .object({
    eligible: z.boolean(),
    reason: generationStoreEligibilityReasonSchema,
  })
  .strict();

export const generateRequestSchema = z
  .object({
    prompt: z.string().trim().min(1),
  })
  .strict();

export const generateResponseSchema = z
  .object({
    graph_id: z.string().uuid(),
    cached: z.boolean(),
  })
  .strict();

export const storeRequestSchema = z
  .object({
    graph: graphSchema,
    nodes: z.array(nodeSchema).min(4).max(25),
    edges: z.array(edgeSchema).min(1),
  })
  .strict();

export const storeResponseSchema = z
  .object({
    graph_id: z.string().uuid(),
  })
  .strict();

export const apiErrorEnvelopeSchema = z
  .object({
    error: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().nullable(),
  })
  .strict();

export const generationLogEntrySchema = z
  .object({
    request_id: z.string().min(1),
    stage: generationStageNameSchema,
    event: generationLogEventSchema,
    level: generationLogLevelSchema,
    message: z.string().min(1),
    timestamp: isoTimestampSchema,
    duration_ms: z.number().int().nonnegative(),
    details: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

export const generationRunStateSchema = z
  .object({
    request_id: z.string().min(1),
    request_route: z.string().min(1),
    request_started_at: isoTimestampSchema,
    prompt_hash: z.string().min(1),
    prompt: z.string().min(1),
    canonicalized: canonicalizeResolvedSuccessSchema.nullable(),
    retrieval_candidates: z.array(retrievalCandidateSchema),
    retrieval_decision: retrievalDecisionSchema.nullable(),
    execution_path: generationExecutionPathSchema.nullable(),
    generated_graph_draft: generationGraphDraftSchema.nullable(),
    validator_outputs: z
      .object({
        structure: generationStructureValidationResultSchema.nullable(),
        curriculum: generationCurriculumValidationResultSchema.nullable(),
        curriculum_audit_status: generationCurriculumAuditStatusSchema.nullable(),
      })
      .strict(),
    reconciled_graph: generationReconciledGraphSchema.nullable(),
    lesson_bundle: generationLessonBundleSchema.nullable(),
    diagnostic_bundle: generationDiagnosticBundleSchema.nullable(),
    visual_bundle: generationVisualBundleSchema.nullable(),
    store_eligibility: generationStoreEligibilitySchema.nullable(),
    final_graph_id: z.string().uuid().nullable(),
    error_log: z.array(generationLogEntrySchema),
  })
  .strict();

export const stageNameSchema = z.enum(STAGE_NAMES);
export const stageErrorCategorySchema = z.enum(STAGE_ERROR_CATEGORIES);
export const stageErrorCodeSchema = z.enum(STAGE_ERROR_CODES);
export const stageWarningCodeSchema = z.enum(STAGE_WARNING_CODES);

const stageDetailsSchema = z.record(z.string(), z.unknown());

export const stageWarningSchema = z
  .object({
    code: stageWarningCodeSchema,
    category: stageErrorCategorySchema,
    stage: stageNameSchema,
    message: z.string().trim().min(1),
    details: stageDetailsSchema.optional(),
  })
  .strict();

export const stageErrorSchema = z
  .object({
    code: stageErrorCodeSchema,
    category: stageErrorCategorySchema,
    stage: stageNameSchema,
    message: z.string().trim().min(1),
    details: stageDetailsSchema.optional(),
    retryable: z.boolean(),
  })
  .strict();

export function createStageResultEnvelopeSchema<TData>(
  dataSchema: z.ZodType<TData>,
): z.ZodType<StageResultEnvelope<TData>> {
  return z
    .object({
      ok: z.boolean(),
      stage: stageNameSchema,
      request_id: z.string().trim().min(1),
      duration_ms: z.number().int().nonnegative(),
      attempts: z.number().int().positive(),
      data: dataSchema.nullable(),
      warnings: z.array(stageWarningSchema),
      error: stageErrorSchema.nullable(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.ok && value.error !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Successful stage results must not carry an error.",
          path: ["error"],
        });
      }

      if (!value.ok && value.error === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Failed stage results must include an error.",
          path: ["error"],
        });
      }
    });
}

export const stageRunSummarySchema = z
  .object({
    request_id: z.string().trim().min(1),
    stage: stageNameSchema,
    ok: z.boolean(),
    duration_ms: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    code: stageErrorCodeSchema.nullable(),
    category: stageErrorCategorySchema.nullable(),
    retryable: z.boolean().nullable(),
    details: stageDetailsSchema.nullable(),
    warnings: z.array(stageWarningSchema),
    inspect_next: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ok && value.code !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Successful stage summaries must not include an error code.",
        path: ["code"],
      });
    }

    if (!value.ok && value.code === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed stage summaries must include an error code.",
        path: ["code"],
      });
    }
  });

export const stageLogEntrySchema = z
  .object({
    request_id: z.string().trim().min(1),
    stage: stageNameSchema,
    event: z.enum(["start", "success", "error"]),
    level: z.enum(["info", "warn", "error"]),
    message: z.string().trim().min(1),
    timestamp: isoTimestampSchema,
    duration_ms: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    details: stageDetailsSchema.nullable(),
    warnings: z.array(stageWarningSchema),
    error: stageErrorSchema.nullable(),
  })
  .strict();
