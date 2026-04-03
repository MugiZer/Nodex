import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo, logWarn } from "@/lib/logging";

import {
  STAGE_ERROR_CATALOGUE,
  STAGE_WARNING_CATALOGUE,
  createStageError,
  createStageWarning,
} from "./stage-contracts";
import type {
  StageError,
  StageErrorCode,
  StageLogEntry,
  StageName,
  StageWarning,
  StageWarningCode,
} from "./stage-contracts";

type StageLogInput = {
  stage: StageName;
  attempts: number;
  duration_ms: number;
  message?: string;
  details?: Record<string, unknown>;
  warnings?: StageWarning[];
};

function createLogEntry(
  context: RequestLogContext,
  input: StageLogInput,
  event: StageLogEntry["event"],
  level: StageLogEntry["level"],
  error: StageError | null,
): StageLogEntry {
  return {
    request_id: context.requestId,
    stage: input.stage,
    event,
    level,
    message: input.message ?? `${input.stage} ${event}.`,
    timestamp: new Date().toISOString(),
    duration_ms: input.duration_ms,
    attempts: input.attempts,
    details: input.details ?? null,
    warnings: input.warnings ?? [],
    error,
  };
}

export function logStageStart(
  context: RequestLogContext,
  input: StageLogInput,
): StageLogEntry {
  logInfo(context, input.stage, "start", input.message ?? `${input.stage} started.`, {
    attempts: input.attempts,
    ...input.details,
  });

  return createLogEntry(context, input, "start", "info", null);
}

export function logStageSuccess(
  context: RequestLogContext,
  input: StageLogInput,
): StageLogEntry {
  const hasWarnings = (input.warnings ?? []).length > 0;
  const warningCodes = (input.warnings ?? []).map((warning) => warning.code);
  const warningCatalogInspectNext = warningCodes.map(
    (code) => STAGE_WARNING_CATALOGUE[code as StageWarningCode].inspect_next,
  );
  const data = {
    attempts: input.attempts,
    stage_duration_ms: input.duration_ms,
    warnings: input.warnings ?? [],
    warning_codes: warningCodes,
    warning_inspect_next: warningCatalogInspectNext,
    ...input.details,
  };

  if (hasWarnings) {
    logWarn(
      context,
      input.stage,
      "success",
      input.message ?? `${input.stage} completed with warnings.`,
      data,
    );
  } else {
    logInfo(
      context,
      input.stage,
      "success",
      input.message ?? `${input.stage} completed successfully.`,
      data,
    );
  }

  return createLogEntry(context, input, "success", hasWarnings ? "warn" : "info", null);
}

export function logStageError(
  context: RequestLogContext,
  input: StageLogInput & { error: StageError },
): StageLogEntry {
  const warningCodes = (input.warnings ?? []).map((warning) => warning.code);
  const errorMetadata = STAGE_ERROR_CATALOGUE[input.error.code as StageErrorCode];

  logError(context, input.stage, input.message ?? `${input.stage} failed.`, input.error, {
    attempts: input.attempts,
    stage_duration_ms: input.duration_ms,
    error_code: input.error.code,
    error_category: input.error.category,
    error_retryable: input.error.retryable,
    inspect_next: errorMetadata.inspect_next,
    warning_codes: warningCodes,
    warnings: input.warnings ?? [],
    ...input.details,
  });

  return createLogEntry(context, input, "error", "error", input.error);
}

export function createVisualFallbackWarning(details?: Record<string, unknown>): StageWarning {
  return createStageWarning(
    "VISUALS_FALLBACK_ACTIVATED",
    "Visuals fell back to the static diagram.",
    details,
  );
}

export function createStageFailureFromCode(
  code: StageErrorCode,
  message: string,
  details?: Record<string, unknown>,
): StageError {
  return createStageError(code, message, details);
}
