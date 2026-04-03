import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeError, ApiError } from "@/lib/errors";
import {
  createStageResultEnvelopeSchema,
  stageErrorSchema,
  stageRunSummarySchema,
  stageWarningSchema,
} from "@/lib/schemas";
import { computeStageTimeout } from "@/lib/server/generation/timeout-model";

import {
  assertStageErrorCode,
  createStageError,
  createStageErrorResult,
  createStageRunSummary,
  createStageSuccessResult,
  createStageWarning,
  summarizeFailedStageRuns,
} from "../harness/stage-contracts";

describe("stage contracts", () => {
  const lessonsTimeoutMs = computeStageTimeout(32000);

  it("creates typed stage envelopes and summaries", () => {
    const dataSchema = z.object({
      nodes: z.array(z.object({ id: z.string() })),
    });

    const success = createStageSuccessResult({
      stage: "visuals",
      request_id: "request-1",
      duration_ms: 44,
      attempts: 1,
      data: {
        nodes: [{ id: "node_1" }],
      },
      warnings: [
        createStageWarning(
          "VISUALS_FALLBACK_ACTIVATED",
          "Visuals fell back to the static diagram.",
          { node_id: "node_1" },
        ),
      ],
    });

    expect(createStageResultEnvelopeSchema(dataSchema).parse(success)).toEqual(success);
    expect(stageWarningSchema.parse(success.warnings[0])).toEqual(success.warnings[0]);

    const summary = createStageRunSummary(success);
    expect(stageRunSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).toMatchObject({
      request_id: "request-1",
      stage: "visuals",
      ok: true,
      code: null,
      category: null,
      retryable: null,
      inspect_next: "Inspect the static diagram fallback and the visual verification criteria.",
    });

    const error = createStageError(
      "STORE_NODE_REMAP_FAILED",
      "Unable to remap node ids before persistence.",
      { node_id: "node_1" },
    );

    assertStageErrorCode(error, "STORE_NODE_REMAP_FAILED");
    expect(stageErrorSchema.parse(error)).toEqual(error);

    const failure = createStageErrorResult({
      stage: "store",
      request_id: "request-2",
      duration_ms: 8,
      attempts: 1,
      error,
    });

    expect(createStageResultEnvelopeSchema(z.null()).parse(failure)).toEqual(failure);

    const failureSummary = createStageRunSummary(failure);
    expect(stageRunSummarySchema.parse(failureSummary)).toEqual(failureSummary);
    expect(failureSummary).toMatchObject({
      request_id: "request-2",
      stage: "store",
      ok: false,
      code: "STORE_NODE_REMAP_FAILED",
      category: "id_remap_failure",
      retryable: false,
      details: {
        node_id: "node_1",
      },
      inspect_next: "Inspect the temporary node id remap map and any embedded node_id references.",
    });
  });

  it("groups failed runs by request_id and stage", () => {
    const grouped = summarizeFailedStageRuns([
      createStageErrorResult({
        stage: "lessons",
        request_id: "request-1",
        duration_ms: 20,
        attempts: 1,
        error: createStageError(
          "LESSONS_TIMEOUT",
          `lessons timed out after ${lessonsTimeoutMs}ms.`,
          { timeout_ms: lessonsTimeoutMs },
        ),
      }),
      createStageErrorResult({
        stage: "lessons",
        request_id: "request-1",
        duration_ms: 22,
        attempts: 2,
        error: createStageError(
          "LESSONS_SCHEMA_INVALID",
          "Lessons output failed schema validation.",
          { missing_field: "quiz_json" },
        ),
      }),
      createStageErrorResult({
        stage: "store",
        request_id: "request-1",
        duration_ms: 8,
        attempts: 1,
        error: createStageError(
          "STORE_PARTIAL_WRITE_PREVENTED",
          "Partial writes are not allowed.",
          { graph_id: "graph_1" },
        ),
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped).toEqual([
      expect.objectContaining({
        request_id: "request-1",
        stage: "lessons",
        ok: false,
        code: "LESSONS_SCHEMA_INVALID",
        category: "contract_validation",
      }),
      expect.objectContaining({
        request_id: "request-1",
        stage: "store",
        ok: false,
        code: "STORE_PARTIAL_WRITE_PREVENTED",
        category: "store_failure",
      }),
    ]);
  });

  it("normalizes stage errors into descriptive API errors", () => {
    const apiError = normalizeError(
      createStageError(
        "VISUALS_VERIFICATION_FAILED",
        "Interactive sketch verification failed.",
        { node_id: "node_2" },
      ),
    );

    expect(apiError).toBeInstanceOf(ApiError);
    expect(apiError).toMatchObject({
      code: "VISUALS_VERIFICATION_FAILED",
      status: 422,
      message: "Interactive sketch verification failed.",
      details: {
        stage: "visuals",
        category: "deterministic_validation",
        retryable: false,
        details: {
          node_id: "node_2",
        },
      },
    });
  });
});
