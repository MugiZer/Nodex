import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError } from "@/lib/errors";
import { executeLlmStage } from "@/lib/server/generation/llm-stage";

describe("executeLlmStage", () => {
  it("does not retry timeout errors", async () => {
    let attempts = 0;

    await expect(
      executeLlmStage({
        stage: "curriculum_validate",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ valid: z.boolean() }),
        failureCategory: "llm_contract_violation",
        timeoutMs: 10,
        maxTokens: 64,
        temperature: 0,
        dependencies: {
          callModel: async () => {
            attempts += 1;
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { valid: true };
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    } satisfies Partial<ApiError>);

    expect(attempts).toBe(1);
  });

  it("supports a single-attempt mode for detached audits", async () => {
    let attempts = 0;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        executeLlmStage({
          stage: "curriculum_validate",
          systemPrompt: "system",
          userPrompt: "user",
          schema: z.object({ valid: z.boolean(), issues: z.array(z.string()) }),
          failureCategory: "llm_contract_violation",
          maxAttempts: 1,
          timeoutMs: 10,
          maxTokens: 64,
          temperature: 0,
          dependencies: {
            callModel: async () => {
              attempts += 1;
              return { valid: true } as never;
            },
          },
        }),
      ).rejects.toMatchObject({
        code: "LLM_SCHEMA_INVALID",
      });

      expect(attempts).toBe(1);
      const loggedMessages = consoleErrorSpy.mock.calls
        .map((call) => call.map((value) => String(value)).join(" "))
        .join(" ");
      expect(loggedMessages).not.toContain("retrying once");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("does not retry deterministic provider preflight failures", async () => {
    let attempts = 0;

    await expect(
      executeLlmStage({
        stage: "lessons",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ id: z.string() }),
        failureCategory: "llm_output_invalid",
        maxTokens: 1800,
        dependencies: {
          callModel: async () => {
            attempts += 1;
            throw new ApiError(
              "UPSTREAM_PROVIDER",
              "Streaming is required for operations that may take longer than 10 minutes.",
              502,
              {
                provider: "anthropic",
                subtype: "sdk_preflight_streaming_required",
                retryable: false,
              },
            );
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "UPSTREAM_PROVIDER",
    } satisfies Partial<ApiError>);

    expect(attempts).toBe(1);
  });

  it("classifies parse failures when the model returns a non-object payload", async () => {
    await expect(
      executeLlmStage({
        stage: "lessons",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ id: z.string() }),
        failureCategory: "llm_output_invalid",
        maxAttempts: 1,
        maxTokens: 1800,
        dependencies: {
          callModel: async () => null as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "LLM_PARSE_FAILURE",
      details: expect.objectContaining({
        output_kind: "null",
      }),
    } satisfies Partial<ApiError>);
  });

  it("classifies schema failures when the model returns the wrong object shape", async () => {
    await expect(
      executeLlmStage({
        stage: "lessons",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ id: z.string(), quiz_json: z.array(z.string()).length(3) }),
        failureCategory: "llm_output_invalid",
        maxAttempts: 1,
        maxTokens: 1800,
        dependencies: {
          callModel: async () =>
            ({
              id: "node_1",
            }) as never,
        },
      }),
    ).rejects.toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      details: expect.objectContaining({
        output_kind: "object",
      }),
    } satisfies Partial<ApiError>);
  });

  it("classifies Anthropic structured-output JSON parse failures as parse failures", async () => {
    await expect(
      executeLlmStage({
        stage: "lessons",
        systemPrompt: "system",
        userPrompt: "user",
        schema: z.object({ id: z.string() }),
        failureCategory: "llm_output_invalid",
        maxAttempts: 1,
        maxTokens: 1800,
        dependencies: {
          callModel: async () => {
            throw new Error(
              "Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 4388 (line 1 column 4389)",
            );
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "LLM_PARSE_FAILURE",
      details: expect.objectContaining({
        provider: "anthropic",
        subtype: "structured_output_json_parse_failure",
        parse_subtype: "unterminated_string",
      }),
    } satisfies Partial<ApiError>);
  });
});
