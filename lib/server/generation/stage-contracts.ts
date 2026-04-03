import {
  createStageResultEnvelopeSchema,
  stageErrorCategorySchema,
  stageErrorCodeSchema,
  stageErrorSchema,
  stageLogEntrySchema,
  stageNameSchema,
  stageRunSummarySchema,
  stageWarningCodeSchema,
  stageWarningSchema,
} from "@/lib/schemas";
import type {
  StageError,
  StageErrorCategory,
  StageErrorCode,
  StageLogEntry,
  StageName,
  StageResultEnvelope,
  StageRunSummary,
  StageWarning,
  StageWarningCode,
} from "@/lib/types";

export {
  createStageResultEnvelopeSchema,
  stageErrorCategorySchema,
  stageErrorCodeSchema,
  stageErrorSchema,
  stageLogEntrySchema,
  stageNameSchema,
  stageRunSummarySchema,
  stageWarningCodeSchema,
  stageWarningSchema,
};

export type {
  StageError,
  StageErrorCategory,
  StageErrorCode,
  StageLogEntry,
  StageName,
  StageResultEnvelope,
  StageRunSummary,
  StageWarning,
  StageWarningCode,
};

type StageErrorMeta = {
  stage: StageName;
  category: StageErrorCategory;
  retryable: boolean;
  inspect_next: string;
};

type StageWarningMeta = {
  stage: StageName;
  category: StageErrorCategory;
  inspect_next: string;
};

function createErrorMeta(
  stage: StageName,
  category: StageErrorCategory,
  retryable: boolean,
  inspectNext: string,
): StageErrorMeta {
  return {
    stage,
    category,
    retryable,
    inspect_next: inspectNext,
  };
}

function createWarningMeta(
  stage: StageName,
  category: StageErrorCategory,
  inspectNext: string,
): StageWarningMeta {
  return {
    stage,
    category,
    inspect_next: inspectNext,
  };
}

export const STAGE_ERROR_CATALOGUE = {
  LESSONS_INPUT_INVALID: createErrorMeta(
    "lessons",
    "input_validation",
    false,
    "Check the lessons request payload and the reconciled graph bundle.",
  ),
  LESSONS_DEPENDENCY_MISSING: createErrorMeta(
    "lessons",
    "dependency_missing",
    false,
    "Check the lessons stage dependencies and upstream graph artifacts.",
  ),
  LESSONS_TIMEOUT: createErrorMeta(
    "lessons",
    "upstream_timeout",
    true,
    "Check provider latency, token budget, and the lessons timeout budget.",
  ),
  LESSONS_PROVIDER_ERROR: createErrorMeta(
    "lessons",
    "upstream_provider",
    true,
    "Check the Anthropic response, rate limits, and prompt size.",
  ),
  LESSONS_PARSE_FAILURE: createErrorMeta(
    "lessons",
    "parse_failure",
    true,
    "Inspect the raw lessons JSON and the schema parse failure details.",
  ),
  LESSONS_SCHEMA_INVALID: createErrorMeta(
    "lessons",
    "contract_validation",
    true,
    "Inspect the lessons output schema, node coverage, quiz shape, and static diagram payload.",
  ),
  LESSONS_EMPTY_OUTPUT: createErrorMeta(
    "lessons",
    "contract_validation",
    false,
    "Inspect the prompt contract and verify the model returned content for every node.",
  ),
  LESSONS_NODE_MISMATCH: createErrorMeta(
    "lessons",
    "artifact_consistency",
    false,
    "Inspect the lessons output node ids and ensure each input node receives exactly one artifact bundle.",
  ),
  LESSONS_UNEXPECTED_INTERNAL: createErrorMeta(
    "lessons",
    "unexpected_internal",
    false,
    "Inspect the lessons service implementation and local invariant checks.",
  ),
  DIAGNOSTICS_INPUT_INVALID: createErrorMeta(
    "diagnostics",
    "input_validation",
    false,
    "Check the diagnostics request payload and node linkage inputs.",
  ),
  DIAGNOSTICS_DEPENDENCY_MISSING: createErrorMeta(
    "diagnostics",
    "dependency_missing",
    false,
    "Check the diagnostics stage dependencies and upstream graph artifacts.",
  ),
  DIAGNOSTICS_TIMEOUT: createErrorMeta(
    "diagnostics",
    "upstream_timeout",
    true,
    "Check provider latency, token budget, and the diagnostics timeout budget.",
  ),
  DIAGNOSTICS_PROVIDER_ERROR: createErrorMeta(
    "diagnostics",
    "upstream_provider",
    true,
    "Check the Anthropic response, rate limits, and prompt size.",
  ),
  DIAGNOSTICS_PARSE_FAILURE: createErrorMeta(
    "diagnostics",
    "parse_failure",
    true,
    "Inspect the raw diagnostics JSON and the schema parse failure details.",
  ),
  DIAGNOSTICS_SCHEMA_INVALID: createErrorMeta(
    "diagnostics",
    "contract_validation",
    true,
    "Inspect the diagnostics output schema, option tuple shape, and node_id linkage.",
  ),
  DIAGNOSTICS_EMPTY_OUTPUT: createErrorMeta(
    "diagnostics",
    "contract_validation",
    false,
    "Inspect the diagnostics prompt contract and verify the model returned one question for every node.",
  ),
  DIAGNOSTICS_NODE_MISMATCH: createErrorMeta(
    "diagnostics",
    "artifact_consistency",
    false,
    "Inspect the emitted diagnostic node ids and ensure each output maps back to exactly one input node.",
  ),
  DIAGNOSTICS_UNEXPECTED_INTERNAL: createErrorMeta(
    "diagnostics",
    "unexpected_internal",
    false,
    "Inspect the diagnostics service implementation and linkage checks.",
  ),
  VISUALS_INPUT_INVALID: createErrorMeta(
    "visuals",
    "input_validation",
    false,
    "Check the visuals request payload and lesson-enriched node inputs.",
  ),
  VISUALS_DEPENDENCY_MISSING: createErrorMeta(
    "visuals",
    "dependency_missing",
    false,
    "Check the visuals stage dependencies and upstream lesson bundle.",
  ),
  VISUALS_TIMEOUT: createErrorMeta(
    "visuals",
    "upstream_timeout",
    true,
    "Check provider latency, token budget, and the visuals timeout budget.",
  ),
  VISUALS_PROVIDER_ERROR: createErrorMeta(
    "visuals",
    "upstream_provider",
    true,
    "Check the Anthropic response, rate limits, and prompt size.",
  ),
  VISUALS_PARSE_FAILURE: createErrorMeta(
    "visuals",
    "parse_failure",
    true,
    "Inspect the raw visuals JSON and the schema parse failure details.",
  ),
  VISUALS_SCHEMA_INVALID: createErrorMeta(
    "visuals",
    "contract_validation",
    true,
    "Inspect the visuals output schema, p5 code restrictions, and fallback payload shape.",
  ),
  VISUALS_EMPTY_OUTPUT: createErrorMeta(
    "visuals",
    "contract_validation",
    false,
    "Inspect the visuals prompt contract and verify the model returned one visual payload for every node.",
  ),
  VISUALS_NODE_MISMATCH: createErrorMeta(
    "visuals",
    "artifact_consistency",
    false,
    "Inspect the emitted visual node ids and ensure each output maps back to exactly one input node.",
  ),
  VISUALS_VERIFICATION_FAILED: createErrorMeta(
    "visuals",
    "deterministic_validation",
    false,
    "Inspect the interactive sketch verification rules and the static-diagram fallback path.",
  ),
  VISUALS_UNEXPECTED_INTERNAL: createErrorMeta(
    "visuals",
    "unexpected_internal",
    false,
    "Inspect the visuals service implementation and verification checks.",
  ),
  STORE_INPUT_INVALID: createErrorMeta(
    "store",
    "input_validation",
    false,
    "Check the store request payload and graph artifact shape.",
  ),
  STORE_DEPENDENCY_MISSING: createErrorMeta(
    "store",
    "dependency_missing",
    false,
    "Check the store stage dependencies and Supabase client wiring.",
  ),
  STORE_AUTH_FAILURE: createErrorMeta(
    "store",
    "auth_failure",
    false,
    "Check the authenticated session and service-role access path.",
  ),
  STORE_NODE_REMAP_FAILED: createErrorMeta(
    "store",
    "id_remap_failure",
    false,
    "Inspect the temporary node id remap map and any embedded node_id references.",
  ),
  STORE_NODE_UPDATE_FAILED: createErrorMeta(
    "store",
    "store_failure",
    true,
    "Inspect the incremental node update payload, node status transition, and database error details.",
  ),
  STORE_GRAPH_INSERT_FAILED: createErrorMeta(
    "store",
    "store_failure",
    true,
    "Inspect the graph insert RPC, row payloads, and database error details.",
  ),
  STORE_PARTIAL_WRITE_PREVENTED: createErrorMeta(
    "store",
    "store_failure",
    false,
    "Inspect the atomic write guard and any attempted partial persistence path.",
  ),
  STORE_PERSISTENCE_UNAVAILABLE: createErrorMeta(
    "store",
    "persistence_unavailable",
    true,
    "Inspect Supabase connectivity, database availability, and service-role access.",
  ),
  STORE_UNEXPECTED_INTERNAL: createErrorMeta(
    "store",
    "unexpected_internal",
    false,
    "Inspect the store service implementation and write-integrity checks.",
  ),
} as const satisfies Record<StageErrorCode, StageErrorMeta>;

export const STAGE_WARNING_CATALOGUE = {
  VISUALS_FALLBACK_ACTIVATED: createWarningMeta(
    "visuals",
    "fallback_activated",
    "Inspect the static diagram fallback and the visual verification criteria.",
  ),
} as const satisfies Record<StageWarningCode, StageWarningMeta>;

export function createStageError(
  code: StageErrorCode,
  message: string,
  details?: Record<string, unknown>,
): StageError {
  const metadata = STAGE_ERROR_CATALOGUE[code];
  const retryableOverride =
    details && typeof details.retryable === "boolean" ? details.retryable : undefined;
  return {
    code,
    category: metadata.category,
    stage: metadata.stage,
    message,
    details,
    retryable: retryableOverride ?? metadata.retryable,
  };
}

export function createStageWarning(
  code: StageWarningCode,
  message: string,
  details?: Record<string, unknown>,
): StageWarning {
  const metadata = STAGE_WARNING_CATALOGUE[code];
  return {
    code,
    category: metadata.category,
    stage: metadata.stage,
    message,
    details,
  };
}

export function createStageSuccessResult<TData>(input: {
  stage: StageName;
  request_id: string;
  duration_ms: number;
  attempts: number;
  data: TData;
  warnings?: StageWarning[];
}): StageResultEnvelope<TData> {
  return {
    ok: true,
    stage: input.stage,
    request_id: input.request_id,
    duration_ms: input.duration_ms,
    attempts: input.attempts,
    data: input.data,
    warnings: input.warnings ?? [],
    error: null,
  };
}

export function createStageErrorResult<TData = null>(input: {
  stage: StageName;
  request_id: string;
  duration_ms: number;
  attempts: number;
  error: StageError;
  warnings?: StageWarning[];
  data?: TData | null;
}): StageResultEnvelope<TData> {
  return {
    ok: false,
    stage: input.stage,
    request_id: input.request_id,
    duration_ms: input.duration_ms,
    attempts: input.attempts,
    data: (input.data ?? null) as TData | null,
    warnings: input.warnings ?? [],
    error: input.error,
  };
}

export function createStageRunSummary<TData>(
  result: StageResultEnvelope<TData>,
): StageRunSummary {
  if (result.ok && result.error !== null) {
    throw new Error(`Stage result for ${result.stage} cannot be ok=true with an error.`);
  }

  if (!result.ok && result.error === null) {
    throw new Error(`Stage result for ${result.stage} cannot be ok=false without an error.`);
  }

  if (result.error) {
    const metadata = STAGE_ERROR_CATALOGUE[result.error.code];
    return {
      request_id: result.request_id,
      stage: result.stage,
      ok: result.ok,
      duration_ms: result.duration_ms,
      attempts: result.attempts,
      code: result.error.code,
      category: result.error.category,
      retryable: result.error.retryable,
      details: result.error.details ?? null,
      warnings: [...result.warnings],
      inspect_next: metadata.inspect_next,
    };
  }

  const warning = result.warnings[0];
  const inspectNext =
    warning === undefined ? null : STAGE_WARNING_CATALOGUE[warning.code].inspect_next;

  return {
    request_id: result.request_id,
    stage: result.stage,
    ok: result.ok,
    duration_ms: result.duration_ms,
    attempts: result.attempts,
    code: null,
    category: null,
    retryable: null,
    details: warning?.details ?? null,
    warnings: [...result.warnings],
    inspect_next: inspectNext,
  };
}

export function summarizeFailedStageRuns<TData>(
  results: Array<StageResultEnvelope<TData>>,
): StageRunSummary[] {
  const grouped = new Map<string, StageRunSummary>();

  for (const result of results) {
    const summary = createStageRunSummary(result);
    if (summary.ok) {
      continue;
    }

    grouped.set(`${summary.request_id}::${summary.stage}`, summary);
  }

  return [...grouped.values()].sort((left, right) =>
    left.request_id === right.request_id
      ? left.stage.localeCompare(right.stage)
      : left.request_id.localeCompare(right.request_id),
  );
}

export function assertStageErrorCode(
  error: StageError | null | undefined,
  code: StageErrorCode,
): asserts error is StageError {
  if (!error || error.code !== code) {
    throw new Error(
      `Expected stage error code ${code} but received ${error ? error.code : "null"}.`,
    );
  }
}

export function assertStageWarningCode(
  warning: StageWarning | null | undefined,
  code: StageWarningCode,
): asserts warning is StageWarning {
  if (!warning || warning.code !== code) {
    throw new Error(
      `Expected stage warning code ${code} but received ${warning ? warning.code : "null"}.`,
    );
  }
}
