import type {
  StoredGraphDiagnosticResult,
  StoredPrerequisiteLesson,
} from "@/lib/diagnostic-session";

type GenerateRequestStatus = "generating" | "ready" | "failed";
type PrerequisiteLessonStatus = "pending" | "ready" | "failed";

type GenerateRequestRecord = {
  request_id: string;
  prompt: string;
  topic: string;
  status: GenerateRequestStatus;
  graph_id: string | null;
  cached: boolean;
  prerequisite_lessons: StoredPrerequisiteLesson[] | null;
  prerequisite_lessons_status: PrerequisiteLessonStatus;
  graph_diagnostic_result: StoredGraphDiagnosticResult | null;
  updated_at: string;
};

declare global {
  var __foundationGenerateRequestStore:
    | Map<string, GenerateRequestRecord>
    | undefined;
}

function getStore(): Map<string, GenerateRequestRecord> {
  globalThis.__foundationGenerateRequestStore ??= new Map<
    string,
    GenerateRequestRecord
  >();

  return globalThis.__foundationGenerateRequestStore;
}

export function createGenerateRequestRecord(input: {
  request_id: string;
  prompt: string;
  topic: string;
  status?: GenerateRequestStatus;
  graph_id?: string | null;
  cached?: boolean;
  prerequisite_lessons?: StoredPrerequisiteLesson[] | null;
  prerequisite_lessons_status?: PrerequisiteLessonStatus;
  graph_diagnostic_result?: StoredGraphDiagnosticResult | null;
}): GenerateRequestRecord {
  const record: GenerateRequestRecord = {
    request_id: input.request_id,
    prompt: input.prompt,
    topic: input.topic,
    status: input.status ?? "generating",
    graph_id: input.graph_id ?? null,
    cached: input.cached ?? false,
    prerequisite_lessons: input.prerequisite_lessons ?? null,
    prerequisite_lessons_status: input.prerequisite_lessons_status ?? "pending",
    graph_diagnostic_result: input.graph_diagnostic_result ?? null,
    updated_at: new Date().toISOString(),
  };

  getStore().set(record.request_id, record);
  return record;
}

export function updateGenerateRequestRecord(
  requestId: string,
  patch: Partial<Omit<GenerateRequestRecord, "request_id">>,
): GenerateRequestRecord | null {
  const current = getStore().get(requestId);
  if (!current) {
    return null;
  }

  const next: GenerateRequestRecord = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const mergedPrerequisiteLessons =
    patch.prerequisite_lessons ?? current.prerequisite_lessons;
  const mergedGraphDiagnosticResult =
    patch.graph_diagnostic_result ?? current.graph_diagnostic_result;

  if (mergedGraphDiagnosticResult) {
    next.graph_diagnostic_result = {
      ...mergedGraphDiagnosticResult,
      graphId: next.graph_id ?? mergedGraphDiagnosticResult.graphId,
      gapPrerequisiteLessons:
        mergedPrerequisiteLessons ?? mergedGraphDiagnosticResult.gapPrerequisiteLessons,
    };
  }

  getStore().set(requestId, next);
  return next;
}

export function getGenerateRequestRecord(
  requestId: string,
): GenerateRequestRecord | null {
  return getStore().get(requestId) ?? null;
}

export function getGenerateRequestRecordByGraphId(
  graphId: string,
): GenerateRequestRecord | null {
  let match: GenerateRequestRecord | null = null;

  for (const record of getStore().values()) {
    if (record.graph_id !== graphId) {
      continue;
    }

    if (!match || record.updated_at > match.updated_at) {
      match = record;
    }
  }

  return match;
}
