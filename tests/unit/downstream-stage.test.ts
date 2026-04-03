import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/errors";
import { mapDownstreamStageError } from "@/lib/server/generation/downstream-stage";

describe("downstream stage error mapping", () => {
  const codes = {
    input_invalid: "LESSONS_INPUT_INVALID" as const,
    timeout: "LESSONS_TIMEOUT" as const,
    provider_error: "LESSONS_PROVIDER_ERROR" as const,
    parse_failure: "LESSONS_PARSE_FAILURE" as const,
    schema_invalid: "LESSONS_SCHEMA_INVALID" as const,
    empty_output: "LESSONS_EMPTY_OUTPUT" as const,
    node_mismatch: "LESSONS_NODE_MISMATCH" as const,
    unexpected_internal: "LESSONS_UNEXPECTED_INTERNAL" as const,
  };

  it("maps upstream provider preflight failures to provider errors without retrying", () => {
    const mapped = mapDownstreamStageError(
      new ApiError(
        "UPSTREAM_PROVIDER",
        "Streaming is required for operations that may take longer than 10 minutes.",
        502,
        {
          provider: "anthropic",
          subtype: "sdk_preflight_streaming_required",
          retryable: false,
        },
      ),
      codes,
    );

    expect(mapped).toMatchObject({
      code: "LESSONS_PROVIDER_ERROR",
      category: "upstream_provider",
      stage: "lessons",
      message: "Streaming is required for operations that may take longer than 10 minutes.",
      details: {
        provider: "anthropic",
        subtype: "sdk_preflight_streaming_required",
        retryable: false,
      },
    });
    expect(mapped.retryable).toBe(false);
  });

  it("maps parse failures, schema failures, node mismatches, and timeouts distinctly", () => {
    expect(
      mapDownstreamStageError(
        new ApiError("LLM_PARSE_FAILURE", "bad json", 502, { output_kind: "null" }),
        codes,
      ),
    ).toMatchObject({ code: "LESSONS_PARSE_FAILURE" });

    expect(
      mapDownstreamStageError(
        new ApiError("LLM_SCHEMA_INVALID", "bad schema", 502, {
          validation_error: { fieldErrors: { quiz_json: ["Required"] } },
        }),
        codes,
      ),
    ).toMatchObject({ code: "LESSONS_SCHEMA_INVALID" });

    expect(
      mapDownstreamStageError(
        new ApiError("LLM_CONTRACT_VIOLATION", "coverage mismatch", 502, {
          expected: ["node_1"],
          actual: ["node_2"],
        }),
        codes,
      ),
    ).toMatchObject({ code: "LESSONS_NODE_MISMATCH" });

    expect(
      mapDownstreamStageError(
        new ApiError("UPSTREAM_TIMEOUT", "timed out", 504),
        codes,
      ),
    ).toMatchObject({ code: "LESSONS_TIMEOUT" });
  });
});
