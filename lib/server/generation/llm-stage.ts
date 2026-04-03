import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

import { ApiError } from "@/lib/errors";
import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo } from "@/lib/logging";

import type { GenerationFailureCategory } from "./contracts";

type LlmUsage = {
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  input_tokens: number;
  output_tokens: number;
};

type LlmStageResult<TOutput> = {
  __llm_stage_result: true;
  output: TOutput;
  usage: LlmUsage | null;
};

type ClassifiedLlmError = {
  error: ApiError;
  retryable: boolean;
};

type CallStageModel<TOutput> = (args: {
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<TOutput>;
  maxTokens?: number;
  temperature?: number;
}) => Promise<TOutput | LlmStageResult<TOutput>>;

export type LlmStageDependencies<TOutput> = {
  callModel?: CallStageModel<TOutput>;
};

export type ExecuteLlmStageOptions<TOutput> = {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<TOutput>;
  failureCategory: GenerationFailureCategory;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  maxAttempts?: number;
  context?: RequestLogContext;
  logDetails?: Record<string, unknown>;
  dependencies?: LlmStageDependencies<TOutput>;
};

export async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number | undefined,
  createTimeoutError: () => ApiError,
): Promise<T> {
  if (timeoutMs === undefined) {
    return operation;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(createTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function defaultCallStageModel<TOutput>({
  systemPrompt,
  userPrompt,
  schema,
  maxTokens,
  temperature,
}: {
  systemPrompt: string;
  userPrompt: string;
  schema: ZodType<TOutput>;
  maxTokens?: number;
  temperature?: number;
}): Promise<TOutput | LlmStageResult<TOutput>> {
  const client = getAnthropicClient();
  let response: unknown;
  try {
    response = await client.messages
      .stream({
        model: getAnthropicModel(),
        max_tokens: maxTokens ?? 2048,
        temperature: temperature ?? 0,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
        output_config: {
          format: zodOutputFormat(schema),
        },
      })
      .finalMessage();
  } catch (error) {
    throw normalizeAnthropicExecutionError(error);
  }

  const parsedResponse = response as typeof response & {
    parsed_output?: unknown;
    usage?: LlmUsage;
  };

  return {
    __llm_stage_result: true as const,
    output: parsedResponse.parsed_output as TOutput,
    usage: parsedResponse.usage ?? null,
  };
}

function normalizeAnthropicExecutionError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Streaming is required")) {
    return new ApiError(
      "UPSTREAM_PROVIDER",
      message,
      502,
      {
        provider: "anthropic",
        subtype: "sdk_preflight_streaming_required",
        retryable: false,
      },
    );
  }

  if (isStructuredOutputParseFailure(message)) {
    return new ApiError(
      "LLM_PARSE_FAILURE",
      message,
      502,
      {
        provider: "anthropic",
        subtype: "structured_output_json_parse_failure",
        parse_subtype: inferStructuredOutputParseSubtype(message),
        raw_message: message,
      },
    );
  }

  return error;
}

function isStructuredOutputParseFailure(message: string): boolean {
  return (
    message.includes("Failed to parse structured output") ||
    message.includes("Failed to parse structured output as JSON") ||
    message.includes("Unterminated string in JSON")
  );
}

function inferStructuredOutputParseSubtype(message: string): string {
  if (message.includes("Unterminated string in JSON")) {
    return "unterminated_string";
  }

  if (message.includes("Failed to parse structured output as JSON")) {
    return "invalid_json";
  }

  return "structured_output_parse_failure";
}

function describeValueKind(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function validateStageOutput<TOutput>(
  stage: string,
  schema: ZodType<TOutput>,
  candidate: unknown,
): TOutput {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  const details = {
    output_kind: describeValueKind(candidate),
    validation_error: parsed.error.flatten(),
  };

  if (candidate === null || candidate === undefined || typeof candidate !== "object") {
    throw new ApiError(
      "LLM_PARSE_FAILURE",
      `${stage} returned output that could not be parsed.`,
      502,
      details,
    );
  }

  throw new ApiError(
    "LLM_SCHEMA_INVALID",
    `${stage} returned output that did not match the expected schema.`,
    502,
    details,
  );
}

function classifyLlmError(
  error: unknown,
  stage: string,
): ClassifiedLlmError {
  const normalizedError = normalizeAnthropicExecutionError(error);

  if (normalizedError instanceof ApiError) {
    error = normalizedError;
  }

  if (error instanceof ApiError) {
    if (error.code === "UPSTREAM_TIMEOUT") {
      return { error, retryable: false };
    }

    if (error.code === "UPSTREAM_PROVIDER") {
      const retryable =
        !(
          error.details &&
          typeof error.details === "object" &&
          "retryable" in error.details &&
          (error.details as { retryable?: unknown }).retryable === false
        );

      return { error, retryable };
    }

    if (error.code === "LLM_CONTRACT_VIOLATION") {
      return { error, retryable: false };
    }

    if (error.code === "LLM_PARSE_FAILURE" || error.code === "LLM_SCHEMA_INVALID") {
      return { error, retryable: true };
    }

    return {
      error: new ApiError(
        "LLM_UNEXPECTED_INTERNAL",
        error.message,
        error.status,
        error.details,
      ),
      retryable: false,
    };
  }

  if (error instanceof Error) {
    return {
      error: new ApiError(
        "LLM_UNEXPECTED_INTERNAL",
        error.message,
        502,
      ),
      retryable: false,
    };
  }

  return {
    error: new ApiError(
      "LLM_UNEXPECTED_INTERNAL",
      `${stage} failed with an unknown error.`,
      502,
      { value: String(error) },
    ),
    retryable: false,
  };
}

function createFallbackContext(stage: string): RequestLogContext {
  return {
    requestId: stage,
    route: stage,
    startedAtMs: Date.now(),
  };
}

export async function executeLlmStage<TOutput>({
  stage,
  systemPrompt,
  userPrompt,
  schema,
  failureCategory,
  timeoutMs,
  maxTokens,
  temperature,
  maxAttempts = 2,
  context,
  logDetails,
  dependencies,
}: ExecuteLlmStageOptions<TOutput>): Promise<TOutput> {
  const logContext = context ?? createFallbackContext(stage);
  const callModel = dependencies?.callModel ?? defaultCallStageModel<TOutput>;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const stageStartedAtMs = Date.now();
      logInfo(
        logContext,
        stage,
        attempt === 1 ? "start" : "retry",
        `${stage} attempt ${attempt} started.`,
        { attempt, ...logDetails },
      );

      const result = await runWithTimeout(
        callModel({
          systemPrompt,
          userPrompt,
          schema,
          maxTokens,
          temperature,
        }),
        timeoutMs,
        () =>
          new ApiError(
            "UPSTREAM_TIMEOUT",
            `${stage} timed out after ${timeoutMs}ms.`,
            504,
          ),
      );

      const output = validateStageOutput(
        stage,
        schema,
        isLlmStageResult(result) ? result.output : result,
      );
      const usage = isLlmStageResult(result) ? result.usage : null;
      const stageDurationMs = Date.now() - stageStartedAtMs;
      const outputTokens = usage?.output_tokens ?? null;
      const observedThroughputTokensPerSecond =
        outputTokens === null || stageDurationMs <= 0
          ? null
          : outputTokens / (stageDurationMs / 1000);

      logInfo(logContext, stage, "success", `${stage} completed successfully.`, {
        attempt,
        stage_duration_ms: stageDurationMs,
        response_tokens: outputTokens,
        observed_throughput_tokens_per_sec:
          observedThroughputTokensPerSecond === null
            ? null
            : Number(observedThroughputTokensPerSecond.toFixed(2)),
        ...logDetails,
      });

      return output;
    } catch (error) {
      const classified = classifyLlmError(error, stage);
      lastError = classified.error;

      if (!classified.retryable) {
        logError(
          logContext,
          stage,
          `${stage} failed without retry.`,
          classified.error,
          {
            attempt,
            failure_code: classified.error.code,
            failure_category: failureCategory,
            ...logDetails,
          },
        );
        throw classified.error;
      }

      logError(
        logContext,
        stage,
        attempt === 1
          ? maxAttempts > 1
            ? `${stage} failed validation or generation; retrying once.`
            : `${stage} failed validation or generation without retry.`
          : `${stage} failed after retry.`,
        classified.error,
        {
          attempt,
          failure_code: classified.error.code,
          failure_category: failureCategory,
          ...logDetails,
        },
      );
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  throw new ApiError(
    failureCategory.toUpperCase(),
    `${stage} failed after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}.`,
    502,
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

function isLlmStageResult<TOutput>(
  value: TOutput | LlmStageResult<TOutput>,
): value is LlmStageResult<TOutput> {
  return (
    typeof value === "object" &&
    value !== null &&
    "__llm_stage_result" in value &&
    (value as { __llm_stage_result?: unknown }).__llm_stage_result === true
  );
}
