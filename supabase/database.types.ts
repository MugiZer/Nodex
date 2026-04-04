import type {
  CurriculumAuditRecord,
  DiagnosticQuestion,
  Edge,
  Graph,
  GenerationCurriculumAuditStatus,
  GenerationCurriculumOutcomeBucket,
  GenerationFailureCategory,
  ProgressAttempt,
  ProgressWriteResponse,
  QuizItem,
  RetrievalCandidate,
  LessonStatus,
  SupportedSubject,
  UserProgress,
} from "@/lib/types";

export type JsonPrimitive = string | number | boolean | null;
export type Json = JsonPrimitive | { [key: string]: Json } | Json[];

export type Database = {
  public: {
    Tables: {
      graphs: {
        Row: GraphDbRow;
        Insert: GraphInsert;
        Update: GraphUpdate;
        Relationships: [];
      };
      nodes: {
        Row: NodeDbRow;
        Insert: NodeInsert;
        Update: NodeUpdate;
        Relationships: [];
      };
      edges: {
        Row: EdgeDbRow;
        Insert: EdgeInsert;
        Update: EdgeUpdate;
        Relationships: [];
      };
      user_progress: {
        Row: UserProgressDbRow;
        Insert: UserProgressInsert;
        Update: UserProgressUpdate;
        Relationships: [];
      };
      generation_curriculum_audits: {
        Row: CurriculumAuditDbRow;
        Insert: CurriculumAuditInsert;
        Update: CurriculumAuditUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_graph_candidates: {
        Args: {
          p_subject: SupportedSubject;
          p_embedding: string;
          p_limit?: number;
        };
        Returns: RetrievalCandidate[];
      };
      record_progress_attempt: {
        Args: {
          p_graph_id: string;
          p_node_id: string;
          p_user_id: string;
          p_score: number;
          p_timestamp: string;
        };
        Returns: ProgressWriteResponse;
      };
      store_generated_graph: {
        Args: {
          p_graph: Json;
          p_nodes: Json;
          p_edges: Json;
          p_embedding: string;
        };
        Returns: {
          graph_id: string;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type GraphDbRow = Graph & {
  embedding: number[] | null;
};

type GraphInsert = {
  id?: string;
  title: string;
  subject: SupportedSubject;
  topic: string;
  description: string;
  embedding?: number[] | null;
  version: number;
  flagged_for_review?: boolean;
  created_at?: string;
};

type GraphUpdate = Partial<GraphInsert>;

type NodeDbRow = {
  id: string;
  graph_id: string;
  graph_version: number;
  title: string;
  lesson_text: string | null;
  static_diagram: string | null;
  p5_code: string | null;
  visual_verified: boolean;
  quiz_json: QuizItem[] | null;
  diagnostic_questions: DiagnosticQuestion[] | null;
  lesson_status: LessonStatus;
  position: number;
  attempt_count: number;
  pass_count: number;
};

type NodeInsert = Partial<NodeDbRow> & {
  graph_id: string;
  graph_version: number;
  title: string;
  position: number;
};

type NodeUpdate = Partial<NodeDbRow>;

type EdgeDbRow = Edge;
type EdgeInsert = Edge;
type EdgeUpdate = Partial<Edge>;

type UserProgressDbRow = UserProgress;
type UserProgressInsert = {
  id?: string;
  user_id: string;
  node_id: string;
  graph_version: number;
  completed?: boolean;
  attempts?: ProgressAttempt[];
};
type UserProgressUpdate = Partial<UserProgressInsert>;

type CurriculumAuditDbRow = CurriculumAuditRecord & {
  failure_category: GenerationFailureCategory | null;
  created_at: string;
  updated_at: string;
};

type CurriculumAuditInsert = {
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

type CurriculumAuditUpdate = Partial<CurriculumAuditInsert>;
