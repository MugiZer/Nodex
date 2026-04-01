export const SUPPORTED_SUBJECTS = [
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "computer_science",
  "economics",
  "statistics",
  "finance",
  "engineering",
  "philosophy",
  "general",
] as const;

export type SupportedSubject = (typeof SUPPORTED_SUBJECTS)[number];
export type EdgeType = "hard" | "soft";
export type ProgressAttempt = {
  score: number;
  timestamp: string;
};

export type QuizItem = {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  explanation: string;
};

export type DiagnosticQuestion = {
  question: string;
  options: [string, string, string, string];
  correct_index: number;
  difficulty_order: number;
  node_id: string;
};

export type GenerationNodeDraft = {
  id: string;
  title: string;
  position: number;
};

export type GenerationEdgeDraft = Edge;

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

export type CanonicalizeSuccess = {
  subject: SupportedSubject;
  topic: string;
  description: string;
};

export type CanonicalizeFailure = {
  error: "NOT_A_LEARNING_REQUEST";
};

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
  start_node_id: string;
  asked_node_ids: string[];
  recommended_node_id: string;
};

export type GenerationLogEntry = {
  stage: string;
  event: "start" | "success" | "error" | "retry";
  message: string;
  timestamp: string;
};

export type GenerationRunState = {
  request_id: string;
  prompt: string;
  canonicalized: CanonicalizeSuccess | null;
  retrieval_candidates: RetrievalCandidate[];
  retrieval_decision: RetrievalDecision | null;
  execution_path: "cache_hit" | "generate" | null;
  generated_graph_draft: {
    nodes: GenerationNodeDraft[];
    edges: GenerationEdgeDraft[];
  } | null;
  validator_outputs: {
    structure: unknown | null;
    curriculum: unknown | null;
  };
  reconciled_graph: {
    nodes: GenerationNodeDraft[];
    edges: GenerationEdgeDraft[];
  } | null;
  lesson_bundle: Node[] | null;
  diagnostic_bundle: Node[] | null;
  visual_bundle: Node[] | null;
  store_eligibility: {
    eligible: boolean;
    reason: string | null;
  };
  final_graph_id: string | null;
  error_log: GenerationLogEntry[];
};
