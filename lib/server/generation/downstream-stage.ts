import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import {
  createStageErrorResult,
  createStageSuccessResult,
  type StageError,
  type StageErrorCode,
  type StageName,
  type StageResultEnvelope,
} from "@/lib/server/generation/stage-contracts";
import {
  createStageFailureFromCode,
  logStageError,
  logStageStart,
  logStageSuccess,
} from "@/lib/server/generation/stage-logging";

const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_SINGLE_ATTEMPT = 1;

function mergeStageErrorDetails(
  errorDetails: unknown,
  stageDetails?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const normalizedErrorDetails =
    errorDetails && typeof errorDetails === "object"
      ? (errorDetails as Record<string, unknown>)
      : undefined;

  if (normalizedErrorDetails && stageDetails) {
    return {
      ...stageDetails,
      ...normalizedErrorDetails,
    };
  }

  return normalizedErrorDetails ?? stageDetails;
}

export type DownstreamStageErrorMap = {
  input_invalid: StageErrorCode;
  timeout: StageErrorCode;
  provider_error?: StageErrorCode;
  parse_failure: StageErrorCode;
  schema_invalid: StageErrorCode;
  empty_output: StageErrorCode;
  node_mismatch?: StageErrorCode;
  unexpected_internal: StageErrorCode;
};

export function createStageInputError<TData = null>(input: {
  stage: StageName;
  request_id: string;
  duration_ms?: number;
  attempts?: number;
  code: StageErrorCode;
  message: string;
  details?: Record<string, unknown>;
  warnings?: StageResultEnvelope<TData>["warnings"];
}): StageResultEnvelope<TData> {
  const durationMs = input.duration_ms ?? 0;
  const attempts = input.attempts ?? DEFAULT_SINGLE_ATTEMPT;
  return createStageErrorResult({
    stage: input.stage,
    request_id: input.request_id,
    duration_ms: durationMs,
    attempts,
    warnings: input.warnings,
    error: createStageFailureFromCode(input.code, input.message, input.details),
  });
}

export function mapDownstreamStageError(
  error: unknown,
  codes: DownstreamStageErrorMap,
  details?: Record<string, unknown>,
): ReturnType<typeof createStageFailureFromCode> {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "category" in error &&
    "stage" in error &&
    "retryable" in error
  ) {
    return error as StageError;
  }

  if (error instanceof ApiError) {
    if (
      error.code === codes.input_invalid ||
      error.code === codes.timeout ||
      error.code === codes.schema_invalid ||
      error.code === codes.empty_output ||
      error.code === codes.node_mismatch
    ) {
      return createStageFailureFromCode(
        error.code as StageErrorCode,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "UPSTREAM_TIMEOUT") {
      return createStageFailureFromCode(
        codes.timeout,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "UPSTREAM_PROVIDER") {
      return createStageFailureFromCode(
        codes.provider_error ?? codes.unexpected_internal,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "LLM_PARSE_FAILURE") {
      return createStageFailureFromCode(
        codes.parse_failure,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "LLM_SCHEMA_INVALID") {
      return createStageFailureFromCode(
        codes.schema_invalid,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "LLM_CONTRACT_VIOLATION") {
      return createStageFailureFromCode(
        codes.node_mismatch ?? codes.schema_invalid,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    if (error.code === "LLM_OUTPUT_INVALID") {
      return createStageFailureFromCode(
        codes.schema_invalid,
        error.message,
        mergeStageErrorDetails(error.details, details),
      );
    }

    return createStageFailureFromCode(
      codes.unexpected_internal,
      error.message,
      details,
    );
  }

  if (error instanceof Error) {
    return createStageFailureFromCode(
      codes.unexpected_internal,
      error.message,
      details,
    );
  }

  return createStageFailureFromCode(
    codes.unexpected_internal,
    "An unexpected error occurred.",
    details,
  );
}

export function inferStageAttempts(error: unknown): number {
  if (error instanceof ApiError && error.code === "UPSTREAM_TIMEOUT") {
    return DEFAULT_SINGLE_ATTEMPT;
  }

  if (
    error instanceof ApiError &&
    error.code === "UPSTREAM_PROVIDER" &&
    error.details &&
    typeof error.details === "object" &&
    "retryable" in error.details &&
    (error.details as { retryable?: unknown }).retryable === false
  ) {
    return DEFAULT_SINGLE_ATTEMPT;
  }

  if (error instanceof ApiError && error.code === "LLM_CONTRACT_VIOLATION") {
    return DEFAULT_SINGLE_ATTEMPT;
  }

  return DEFAULT_RETRY_ATTEMPTS;
}

export async function executeDownstreamStage<TData>(input: {
  stage: StageName;
  context: RequestLogContext;
  action: () => Promise<TData>;
  validateEmpty?: (data: TData) => boolean;
  emptyErrorCode?: StageErrorCode;
  emptyMessage?: string;
  successMessage: string;
  startDetails?: Record<string, unknown>;
  successDetails?: (data: TData) => Record<string, unknown>;
  warnings?: (data: TData) => StageResultEnvelope<TData>["warnings"];
  mapError: (error: unknown) => ReturnType<typeof createStageFailureFromCode>;
}): Promise<StageResultEnvelope<TData>> {
  const startedAtMs = Date.now();
  logStageStart(input.context, {
    stage: input.stage,
    attempts: DEFAULT_SINGLE_ATTEMPT,
    duration_ms: 0,
    details: input.startDetails,
  });

  try {
    const data = await input.action();

    if (
      input.validateEmpty?.(data) &&
      input.emptyErrorCode &&
      input.emptyMessage
    ) {
      const durationMs = Date.now() - startedAtMs;
      const error = createStageFailureFromCode(
        input.emptyErrorCode,
        input.emptyMessage,
        input.startDetails,
      );
      const result = createStageErrorResult<TData>({
        stage: input.stage,
        request_id: input.context.requestId,
        duration_ms: durationMs,
        attempts: DEFAULT_SINGLE_ATTEMPT,
        error,
      });
      logStageError(input.context, {
        stage: input.stage,
        attempts: result.attempts,
        duration_ms: durationMs,
        details: input.startDetails,
        error,
      });
      return result;
    }

    const durationMs = Date.now() - startedAtMs;
    const warnings = input.warnings?.(data) ?? [];
    const result = createStageSuccessResult({
      stage: input.stage,
      request_id: input.context.requestId,
      duration_ms: durationMs,
      attempts: DEFAULT_SINGLE_ATTEMPT,
      data,
      warnings,
    });

    logStageSuccess(input.context, {
      stage: input.stage,
      attempts: result.attempts,
      duration_ms: durationMs,
      details: input.successDetails?.(data),
      warnings,
      message: input.successMessage,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const stageError = input.mapError(error);
    const attempts = inferStageAttempts(error);
    const result = createStageErrorResult<TData>({
      stage: input.stage,
      request_id: input.context.requestId,
      duration_ms: durationMs,
      attempts,
      error: stageError,
    });

    logStageError(input.context, {
      stage: input.stage,
      attempts,
      duration_ms: durationMs,
      details: stageError.details,
      error: stageError,
    });

    return result;
  }
}
