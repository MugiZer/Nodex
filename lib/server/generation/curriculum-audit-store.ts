import { createHash } from "node:crypto";

import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import { curriculumAuditRecordSchema } from "@/lib/schemas";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";
import type {
  CurriculumAuditRecord,
  GenerationCurriculumAuditStatus,
  GenerationCurriculumOutcomeBucket,
  GenerationEdgeDraft,
  GenerationNodeDraft,
  GenerationFailureCategory,
  SupportedSubject,
} from "@/lib/types";

export type CurriculumAuditStoreDependencies = {
  createServiceClient?: () => FoundationSupabaseClient;
  persistAuditResult?: (record: CurriculumAuditRecord) => Promise<void>;
  fetchAuditResult?: (requestId: string) => Promise<CurriculumAuditRecord | null>;
  runInTests?: boolean;
};

export type CurriculumAuditPersistenceResult =
  | {
      status: "persisted";
    }
  | {
      status: "skipped_missing_table";
    };

export type CurriculumAuditRecordInput = {
  requestId: string;
  subject: SupportedSubject;
  topic: string;
  auditStatus: GenerationCurriculumAuditStatus;
  outcomeBucket: GenerationCurriculumOutcomeBucket;
  attemptCount: number;
  finalFailureCategory: GenerationFailureCategory | null;
  parseErrorSummary: string | null;
  durationMs: number;
  issueCount: number;
  asyncAudit: boolean;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
  description: string;
};

function serializeFingerprintPayload(input: {
  subject: SupportedSubject;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
}): string {
  const nodes = input.nodes
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      title: node.title,
      position: node.position,
    }));

  const edges = input.edges
    .slice()
    .sort((left, right) =>
      left.from_node_id === right.from_node_id
        ? left.to_node_id.localeCompare(right.to_node_id)
        : left.from_node_id.localeCompare(right.from_node_id),
    )
    .map((edge) => ({
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
      type: edge.type,
    }));

  return JSON.stringify({
    subject: input.subject,
    topic: input.topic,
    description: input.description,
    nodes,
    edges,
  });
}

export function createCurriculumAuditFingerprint(input: {
  subject: SupportedSubject;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
}): string {
  return createHash("sha256").update(serializeFingerprintPayload(input)).digest("hex").slice(0, 24);
}

export function createCurriculumAuditRecord(
  input: CurriculumAuditRecordInput,
): CurriculumAuditRecord {
  return {
    request_id: input.requestId,
    request_fingerprint: createCurriculumAuditFingerprint({
      subject: input.subject,
      topic: input.topic,
      description: input.description,
      nodes: input.nodes,
      edges: input.edges,
    }),
    subject: input.subject,
    topic: input.topic,
    audit_status: input.auditStatus,
    outcome_bucket: input.outcomeBucket,
    attempt_count: input.attemptCount,
    failure_category: input.finalFailureCategory,
    parse_error_summary: input.parseErrorSummary,
    duration_ms: input.durationMs,
    issue_count: input.issueCount,
    async_audit: input.asyncAudit,
  };
}

function getServiceClient(
  dependencies: CurriculumAuditStoreDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isMissingCurriculumAuditTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typedError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const message = [typedError.message, typedError.details, getErrorMessage(error)]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  const code = typeof typedError.code === "string" ? typedError.code : "";

  return (
    code === "42P01" ||
    message.includes("could not find the table 'public.generation_curriculum_audits' in the schema cache") ||
    message.includes('relation "public.generation_curriculum_audits" does not exist')
  );
}

export async function persistCurriculumAuditRecord(
  record: CurriculumAuditRecord,
  context: RequestLogContext,
  dependencies: CurriculumAuditStoreDependencies = {},
): Promise<CurriculumAuditPersistenceResult> {
  if (dependencies.persistAuditResult) {
    await dependencies.persistAuditResult(record);
    return {
      status: "persisted",
    };
  }

  const client = getServiceClient(dependencies);
  const { error } = await client
    .from("generation_curriculum_audits")
    .upsert(
      {
        request_id: record.request_id,
        request_fingerprint: record.request_fingerprint,
        subject: record.subject,
        topic: record.topic,
        audit_status: record.audit_status,
        outcome_bucket: record.outcome_bucket,
        attempt_count: record.attempt_count,
        failure_category: record.failure_category,
        parse_error_summary: record.parse_error_summary,
        duration_ms: record.duration_ms,
        issue_count: record.issue_count,
        async_audit: record.async_audit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "request_id" },
    );

  if (error) {
    if (isMissingCurriculumAuditTableError(error)) {
      return {
        status: "skipped_missing_table",
      };
    }

    throw new ApiError(
      "STORE_ERROR",
      "Failed to persist curriculum audit result.",
      500,
      {
        request_id: record.request_id,
        request_fingerprint: record.request_fingerprint,
        cause: error.message,
        route: context.route,
      },
    );
  }

  return {
    status: "persisted",
  };
}

export async function fetchCurriculumAuditRecord(
  requestId: string,
  context: RequestLogContext,
  dependencies: CurriculumAuditStoreDependencies = {},
): Promise<CurriculumAuditRecord | null> {
  if (dependencies.fetchAuditResult) {
    return dependencies.fetchAuditResult(requestId);
  }

  const client = getServiceClient(dependencies);
  const { data, error } = await client
    .from("generation_curriculum_audits")
    .select("*")
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    if (isMissingCurriculumAuditTableError(error)) {
      return null;
    }

    throw new ApiError(
      "STORE_ERROR",
      "Failed to fetch curriculum audit result.",
      500,
      {
        request_id: requestId,
        cause: error.message,
        route: context.route,
      },
    );
  }

  if (!data) {
    return null;
  }

  return curriculumAuditRecordSchema.parse(data);
}
