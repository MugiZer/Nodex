import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo } from "@/lib/logging";
import type {
  GenerationCurriculumOutcomeBucket,
  GenerationEdgeDraft,
  GenerationFailureCategory,
  GenerationNodeDraft,
  SupportedSubject,
} from "@/lib/types";

import type {
  CurriculumAuditStoreDependencies,
} from "./curriculum-audit-store";
import {
  createCurriculumAuditRecord,
  persistCurriculumAuditRecord,
} from "./curriculum-audit-store";
import type { LlmStageDependencies } from "./llm-stage";
import type {
  CurriculumValidatorOutput,
  CurriculumAuditStatus,
} from "./contracts";

export type CurriculumAuditSnapshot = {
  output: CurriculumValidatorOutput;
  auditStatus: CurriculumAuditStatus;
  outcomeBucket: GenerationCurriculumOutcomeBucket;
  attemptCount: number;
  finalFailureCategory: GenerationFailureCategory | null;
  parseErrorSummary: string | null;
  durationMs: number;
  asyncAudit: boolean;
};

export type CurriculumAuditInput = {
  subject: SupportedSubject;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
};

export type DetachedCurriculumValidator = (
  input: CurriculumAuditInput,
  context?: RequestLogContext,
  dependencies?: LlmStageDependencies<CurriculumValidatorOutput>,
  options?: {
    executionMode?: "sync" | "detached";
  },
) => Promise<CurriculumAuditSnapshot>;

export function createDeferredCurriculumResult(): CurriculumAuditSnapshot {
  return {
    output: {
      valid: true,
      issues: [],
    },
    auditStatus: "disabled_async",
    outcomeBucket: "disabled_async",
    attemptCount: 0,
    finalFailureCategory: null,
    parseErrorSummary: null,
    durationMs: 0,
    asyncAudit: false,
  };
}

export function launchDetachedCurriculumAudit(
  input: CurriculumAuditInput,
  context: RequestLogContext,
  runValidator: DetachedCurriculumValidator,
  dependencies?: LlmStageDependencies<CurriculumValidatorOutput>,
  auditDependencies?: CurriculumAuditStoreDependencies,
): void {
  if (process.env.NODE_ENV === "test" && !auditDependencies?.runInTests) {
    return;
  }

  void (async () => {
    const result = await runValidator(input, context, dependencies, {
      executionMode: "detached",
    });

    const record = createCurriculumAuditRecord({
      requestId: context.requestId,
      subject: input.subject,
      topic: input.topic,
      auditStatus: result.auditStatus,
      outcomeBucket: result.outcomeBucket,
      attemptCount: result.attemptCount,
      finalFailureCategory: result.finalFailureCategory,
      parseErrorSummary: result.parseErrorSummary,
      durationMs: result.durationMs,
      issueCount: result.output.issues.length,
      asyncAudit: result.asyncAudit,
      nodes: input.nodes,
      edges: input.edges,
      description: input.description,
    });

    try {
      const persistenceResult = await persistCurriculumAuditRecord(
        record,
        context,
        auditDependencies,
      );
      logInfo(
        context,
        "curriculum_audit_store",
        "success",
        persistenceResult.status === "persisted"
          ? "Curriculum audit persisted."
          : "Curriculum audit storage was unavailable; skipping persistence.",
        {
          audit_status: record.audit_status,
          curriculum_outcome_bucket: record.outcome_bucket,
          attempt_count: record.attempt_count,
          final_failure_category: record.failure_category,
          parse_error_summary: record.parse_error_summary,
          async_audit: record.async_audit,
          request_fingerprint: record.request_fingerprint,
          persistence_status: persistenceResult.status,
        },
      );
    } catch (error) {
      logError(
        context,
        "curriculum_audit_store",
        "Failed to persist curriculum audit result.",
        error,
        {
          audit_status: record.audit_status,
          curriculum_outcome_bucket: record.outcome_bucket,
          attempt_count: record.attempt_count,
          final_failure_category: record.failure_category,
          parse_error_summary: record.parse_error_summary,
          async_audit: record.async_audit,
          request_fingerprint: record.request_fingerprint,
        },
      );
    }
  })().catch((error: unknown) => {
    logError(
      context,
      "curriculum_audit",
      "Curriculum audit failed asynchronously.",
      error,
      {
        async_audit: true,
        curriculum_audit_phase: "async_complete",
      },
    );
  });
}
