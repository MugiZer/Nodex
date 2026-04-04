export const SUPPORTED_SUBJECTS = [
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "computer_science",
  "economics",
  "financial_literacy",
  "statistics",
  "engineering",
  "philosophy",
  "general",
] as const;

export const CANONICALIZE_LEVELS = [
  "introductory",
  "intermediate",
  "advanced",
] as const;

export const CANONICALIZATION_SOURCES = [
  "grounded_match",
  "grounded_plus_model",
  "model_only",
] as const;

export const CANDIDATE_CONFIDENCE_BANDS = [
  "none",
  "low",
  "medium",
  "high",
] as const;

export const CANONICALIZATION_VERSION =
  "v3_grounded_hybrid_structured_rendered_description" as const;

export type SupportedSubject = (typeof SUPPORTED_SUBJECTS)[number];
export type CanonicalizeLevel = (typeof CANONICALIZE_LEVELS)[number];
export type CanonicalizationSource = (typeof CANONICALIZATION_SOURCES)[number];
export type CandidateConfidenceBand = (typeof CANDIDATE_CONFIDENCE_BANDS)[number];
export type EdgeType = "hard" | "soft";
export type LessonStatus = "pending" | "ready" | "failed";

export type GenerationStageName =
  | "canonicalize"
  | "retrieve"
  | "graph_generator"
  | "structure_validator"
  | "curriculum_validator"
  | "reconciler"
  | "lessons"
  | "diagnostics"
  | "visuals"
  | "store";

export type GenerationExecutionPath = "cache_hit" | "generate";

export const STAGE_NAMES = [
  "lessons",
  "diagnostics",
  "visuals",
  "store",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const STAGE_ERROR_CATEGORIES = [
  "input_validation",
  "dependency_missing",
  "upstream_timeout",
  "upstream_provider",
  "parse_failure",
  "contract_validation",
  "deterministic_validation",
  "artifact_consistency",
  "fallback_activated",
  "id_remap_failure",
  "store_failure",
  "persistence_unavailable",
  "auth_failure",
  "unexpected_internal",
] as const;

export type StageErrorCategory = (typeof STAGE_ERROR_CATEGORIES)[number];

export const STAGE_ERROR_CODES = [
  "LESSONS_INPUT_INVALID",
  "LESSONS_DEPENDENCY_MISSING",
  "LESSONS_TIMEOUT",
  "LESSONS_PROVIDER_ERROR",
  "LESSONS_PARSE_FAILURE",
  "LESSONS_SCHEMA_INVALID",
  "LESSONS_EMPTY_OUTPUT",
  "LESSONS_NODE_MISMATCH",
  "LESSONS_UNEXPECTED_INTERNAL",
  "DIAGNOSTICS_INPUT_INVALID",
  "DIAGNOSTICS_DEPENDENCY_MISSING",
  "DIAGNOSTICS_TIMEOUT",
  "DIAGNOSTICS_PROVIDER_ERROR",
  "DIAGNOSTICS_PARSE_FAILURE",
  "DIAGNOSTICS_SCHEMA_INVALID",
  "DIAGNOSTICS_EMPTY_OUTPUT",
  "DIAGNOSTICS_NODE_MISMATCH",
  "DIAGNOSTICS_UNEXPECTED_INTERNAL",
  "VISUALS_INPUT_INVALID",
  "VISUALS_DEPENDENCY_MISSING",
  "VISUALS_TIMEOUT",
  "VISUALS_PROVIDER_ERROR",
  "VISUALS_PARSE_FAILURE",
  "VISUALS_SCHEMA_INVALID",
  "VISUALS_EMPTY_OUTPUT",
  "VISUALS_NODE_MISMATCH",
  "VISUALS_VERIFICATION_FAILED",
  "VISUALS_UNEXPECTED_INTERNAL",
  "STORE_INPUT_INVALID",
  "STORE_DEPENDENCY_MISSING",
  "STORE_AUTH_FAILURE",
  "STORE_NODE_REMAP_FAILED",
  "STORE_NODE_UPDATE_FAILED",
  "STORE_GRAPH_INSERT_FAILED",
  "STORE_PARTIAL_WRITE_PREVENTED",
  "STORE_PERSISTENCE_UNAVAILABLE",
  "STORE_UNEXPECTED_INTERNAL",
] as const;

export type StageErrorCode = (typeof STAGE_ERROR_CODES)[number];

export const STAGE_WARNING_CODES = [
  "VISUALS_FALLBACK_ACTIVATED",
] as const;

export type StageWarningCode = (typeof STAGE_WARNING_CODES)[number];

export type StageWarning = {
  code: StageWarningCode;
  category: StageErrorCategory;
  stage: StageName;
  message: string;
  details?: Record<string, unknown>;
};

export type StageError = {
  code: StageErrorCode;
  category: StageErrorCategory;
  stage: StageName;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
};

export type StageResultEnvelope<TData = unknown> = {
  ok: boolean;
  stage: StageName;
  request_id: string;
  duration_ms: number;
  attempts: number;
  data: TData | null;
  warnings: StageWarning[];
  error: StageError | null;
};

export type StageRunSummary = {
  request_id: string;
  stage: StageName;
  ok: boolean;
  duration_ms: number;
  attempts: number;
  code: StageErrorCode | null;
  category: StageErrorCategory | null;
  retryable: boolean | null;
  details: Record<string, unknown> | null;
  warnings: StageWarning[];
  inspect_next: string | null;
};

export type StageLogEvent = "start" | "success" | "error";
export type StageLogLevel = GenerationLogLevel;

export type StageLogEntry = {
  request_id: string;
  stage: StageName;
  event: StageLogEvent;
  level: StageLogLevel;
  message: string;
  timestamp: string;
  duration_ms: number;
  attempts: number;
  details: Record<string, unknown> | null;
  warnings: StageWarning[];
  error: StageError | null;
};

export type GenerationFailureCategory =
  | "canonicalize_error"
  | "retrieval_error"
  | "llm_output_invalid"
  | "llm_contract_violation"
  | "graph_boundary_violation"
  | "input_precondition_failed"
  | "repair_exhausted"
  | "upstream_timeout"
  | "store_error"
  | "unexpected_internal_error";

export type GenerationLogLevel = "info" | "warn" | "error";
export type GenerationLogEvent = "start" | "success" | "retry" | "error";

export type GenerationStoreEligibilityReason =
  | "ready_to_store"
  | "cache_hit"
  | "duplicate_recheck_hit"
  | "missing_required_artifact"
  | "validation_failed"
  | "repair_failure"
  | "store_error"
  | "not_applicable";

export type GenerationStoreEligibility = {
  eligible: boolean;
  reason: GenerationStoreEligibilityReason;
};

export type ProgressAttempt = {
  score: number;
  timestamp: string;
};

export type QuizItem = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

export type FlagshipLessonStep = {
  action: string;
  result: string;
};

export type FlagshipLessonWhatIfOption = {
  text: string;
  isCorrect: boolean;
  explanation: string;
};

export type FlagshipLessonMasteryOption = {
  text: string;
  isCorrect: boolean;
  feedback: string;
};

export type FlagshipLesson = {
  version: "flagship-v1";
  predictionTrap: {
    question: string;
    obviousAnswer: string;
    correctAnswer: string;
    whyWrong: string;
  };
  guidedInsight: {
    ground: string;
    mechanism: string;
    surprise: string;
    reframe: string;
  };
  workedExample: {
    setup: string;
    naiveAttempt: string;
    steps: FlagshipLessonStep[];
    takeaway: string;
  };
  whatIf: {
    question: string;
    options: FlagshipLessonWhatIfOption[];
  };
  masteryCheck: {
    stem: string;
    options: FlagshipLessonMasteryOption[];
    forwardHook: string;
  };
  anchor: {
    summary: string;
    bridge: string;
  };
};

export type DiagnosticQuestion = {
  question: string;
  options: string[];
  correct_index: number;
  difficulty_order: number;
  node_id: string;
};

export type PrerequisiteDiagnosticQuestion = {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

export type PrerequisiteDiagnosticGroup = {
  name: string;
  questions: [PrerequisiteDiagnosticQuestion, PrerequisiteDiagnosticQuestion];
};

export type PrerequisiteDiagnostic = {
  prerequisites: PrerequisiteDiagnosticGroup[];
};

export type GenerationNodeDraft = {
  id: string;
  title: string;
  position: number;
};

export type GenerationEdgeDraft = Edge;

export type GenerationGraphDraft = {
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
};

export type GenerationStructureIssueType =
  | "circular_dependency"
  | "boundary_violation"
  | "missing_hard_edge"
  | "edge_misclassification"
  | "redundant_edge"
  | "position_inconsistency"
  | "orphaned_subgraph";

export type GenerationStructureIssueSeverity = "critical" | "major" | "minor";

export type GenerationStructureIssue = {
  type: GenerationStructureIssueType;
  severity: GenerationStructureIssueSeverity;
  nodes_involved: string[];
  description: string;
  suggested_fix: string;
};

export type GenerationStructureValidationResult = {
  valid: boolean;
  issues: GenerationStructureIssue[];
};

export type GenerationCurriculumIssueType =
  | "missing_concept"
  | "incorrect_ordering"
  | "out_of_scope_concept"
  | "pedagogical_misalignment"
  | "level_mismatch";

export type GenerationCurriculumIssueSeverity = "critical" | "major" | "minor";

export type GenerationCurriculumIssue = {
  type: GenerationCurriculumIssueType;
  severity: GenerationCurriculumIssueSeverity;
  nodes_involved: string[];
  missing_concept_title: string | null;
  description: string;
  suggested_fix: string;
  curriculum_basis: string;
};

export type GenerationCurriculumValidationResult = {
  valid: boolean;
  issues: GenerationCurriculumIssue[];
};

export type GenerationCurriculumAuditStatus =
  | "accepted"
  | "skipped_timeout"
  | "skipped_contract_failure"
  | "disabled_async";

export type GenerationCurriculumOutcomeBucket =
  | "accepted_clean"
  | "accepted_with_issues"
  | "skipped_timeout"
  | "skipped_contract_failure"
  | "disabled_async";

export type GenerationCurriculumAuditPhase =
  | "synchronous_placeholder"
  | "sync_complete"
  | "async_complete";

export type GenerationResolutionSource =
  | "structure_validator"
  | "curriculum_validator"
  | "both";

export type GenerationResolutionSummaryEntry = {
  issue_key: string;
  issue_source: GenerationResolutionSource;
  issue_description: string;
  resolution_action: string;
};

export type CurriculumAuditRecord = {
  request_id: string;
  request_fingerprint: string;
  subject: SupportedSubject;
  topic: string;
  audit_status: GenerationCurriculumAuditStatus;
  outcome_bucket: GenerationCurriculumOutcomeBucket;
  attempt_count: number;
  failure_category: GenerationFailureCategory | null;
  parse_error_summary: string | null;
  duration_ms: number;
  issue_count: number;
  async_audit: boolean;
  created_at?: string;
  updated_at?: string;
};

export type GenerationReconciledGraph = GenerationGraphDraft & {
  resolution_summary: GenerationResolutionSummaryEntry[];
};

export type Graph = {
  id: string;
  title: string;
  subject: SupportedSubject;
  topic: string;
  description: string;
  version: number;
  flagged_for_review: boolean;
  created_at: string;
};

export type GraphRow = Graph & {
  embedding?: number[] | null;
};

export type NodeArtifactFields = {
  lesson_text: string | null;
  static_diagram: string | null;
  p5_code: string | null;
  visual_verified: boolean;
  quiz_json: QuizItem[] | null;
  diagnostic_questions: DiagnosticQuestion[] | null;
  lesson_status: LessonStatus;
};

export type Node = NodeArtifactFields & {
  id: string;
  graph_id: string;
  graph_version: number;
  title: string;
  position: number;
  attempt_count: number;
  pass_count: number;
};

export type LessonNode = Omit<
  Node,
  "lesson_text" | "static_diagram" | "quiz_json"
> & {
  lesson_text: string;
  static_diagram: string;
  quiz_json: QuizItem[];
};

export type GenerationLessonBundle = {
  nodes: LessonNode[];
};

export type DiagnosticNode = Omit<Node, "diagnostic_questions"> & {
  diagnostic_questions: DiagnosticQuestion[];
};

export type GenerationDiagnosticBundle = {
  nodes: DiagnosticNode[];
};

export type VisualNode = Omit<Node, "p5_code" | "visual_verified"> & {
  p5_code: string;
  visual_verified: boolean;
};

export type GenerationVisualBundle = {
  nodes: VisualNode[];
};

export type Edge = {
  from_node_id: string;
  to_node_id: string;
  type: EdgeType;
};

export type UserProgress = {
  id: string;
  user_id: string;
  node_id: string;
  graph_version: number;
  completed: boolean;
  attempts: ProgressAttempt[];
};

export type CanonicalizePublicSuccess = {
  subject: SupportedSubject;
  topic: string;
  description: string;
};

export type CanonicalBoundaryFields = {
  prerequisites?: string[];
  downstream_topics?: string[];
};

export type CanonicalizeModelSuccessDraft = {
  subject: SupportedSubject;
  topic: string;
  scope_summary: string;
  core_concepts: string[];
  prerequisites: string[];
  downstream_topics: string[];
  level: CanonicalizeLevel;
};

export type CanonicalizeInventoryEntry = CanonicalizeModelSuccessDraft & {
  aliases: string[];
  broad_prompt_aliases: string[];
  starter_for_subject: SupportedSubject | null;
};

export type CanonicalizeResolvedSuccess = CanonicalizePublicSuccess & {
  scope_summary: string;
  core_concepts: string[];
  prerequisites: string[];
  downstream_topics: string[];
  level: CanonicalizeLevel;
  canonicalization_source: CanonicalizationSource;
  inventory_candidate_topics: string[];
  candidate_confidence_band: CandidateConfidenceBand;
  canonicalization_version: typeof CANONICALIZATION_VERSION;
};

export type CanonicalizeSuccess = CanonicalizePublicSuccess & CanonicalBoundaryFields;
export type CanonicalizeFailure = {
  error: "NOT_A_LEARNING_REQUEST";
};

export type CanonicalizeModelResult =
  | CanonicalizeModelSuccessDraft
  | CanonicalizeFailure;

export type CanonicalizeResolvedResult =
  | CanonicalizeResolvedSuccess
  | CanonicalizeFailure;

export type CanonicalizeResult = CanonicalizeSuccess | CanonicalizeFailure;

export type RetrieveRequest = {
  subject: SupportedSubject;
  description: string;
};

export type RetrieveResponse = {
  graph_id: string | null;
};

export type GraphPayload = {
  graph: Graph;
  nodes: Node[];
  edges: Edge[];
  progress: UserProgress[];
};

export type ProgressWriteRequest = {
  graph_id: string;
  node_id: string;
  score: number;
  timestamp?: string;
};

export type ProgressWriteResponse = {
  progress: UserProgress;
  available_node_ids: string[];
  flagged_for_review: boolean;
};

export type RetrievalCandidate = {
  id: string;
  similarity: number;
  flagged_for_review: boolean;
  version: number;
  created_at: string;
};

export type RetrievalDecision = {
  graph_id: string | null;
  reason:
    | "below_threshold"
    | "usable_unflagged_match"
    | "only_flagged_matches"
    | "no_candidates";
  candidate: RetrievalCandidate | null;
};

export type NodeState =
  | "locked"
  | "available"
  | "completed"
  | "recommended"
  | "active";

export type DiagnosticAnswer = {
  node_id: string;
  correct: boolean;
};

export type DiagnosticRunResult = {
  start_node_id: string | null;
  asked_node_ids: string[];
  recommended_node_id: string | null;
};

export type GenerationLogEntry = {
  request_id: string;
  stage: GenerationStageName;
  event: GenerationLogEvent;
  level: GenerationLogLevel;
  message: string;
  timestamp: string;
  duration_ms: number;
  details: Record<string, unknown> | null;
};

export type GenerationRunState = {
  request_id: string;
  request_route: string;
  request_started_at: string;
  prompt_hash: string;
  prompt: string;
  canonicalized: CanonicalizeResolvedSuccess | null;
  retrieval_candidates: RetrievalCandidate[];
  retrieval_decision: RetrievalDecision | null;
  execution_path: GenerationExecutionPath | null;
  generated_graph_draft: GenerationGraphDraft | null;
  validator_outputs: {
    structure: GenerationStructureValidationResult | null;
    curriculum: GenerationCurriculumValidationResult | null;
    curriculum_audit_status: GenerationCurriculumAuditStatus | null;
  };
  reconciled_graph: GenerationReconciledGraph | null;
  lesson_bundle: GenerationLessonBundle | null;
  diagnostic_bundle: GenerationDiagnosticBundle | null;
  visual_bundle: GenerationVisualBundle | null;
  store_eligibility: {
    eligible: boolean;
    reason: GenerationStoreEligibilityReason;
  } | null;
  final_graph_id: string | null;
  error_log: GenerationLogEntry[];
};

export type GenerateRequest = {
  prompt: string;
};

export type GenerateResponse = {
  request_id: string;
  graph_id: string | null;
  diagnostic: PrerequisiteDiagnostic | null;
  status: "generating" | "ready";
  topic: string;
  cached: boolean;
};

export type StoreRequest = {
  graph: Graph;
  nodes: Node[];
  edges: Edge[];
};

export type StoreResponse = {
  graph_id: string;
};

export type ApiErrorEnvelope = {
  error: string;
  message: string;
  details: unknown | null;
};
