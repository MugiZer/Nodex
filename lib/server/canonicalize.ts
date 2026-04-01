import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import {
  canonicalizeResultSchema,
  validateCanonicalDescription,
} from "@/lib/schemas";
import type { CanonicalizeResult } from "@/lib/types";
import { ApiError } from "@/lib/errors";
import { createAnthropicClient } from "@/lib/server/anthropic-client";

import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo } from "@/lib/logging";

const canonicalizeResponseSchema = canonicalizeResultSchema;

const canonicalizePromptSchema = z.string().trim().min(1);

const canonicalizeSystemPrompt = [
  "You are the Foundation canonicalizer.",
  "Convert a learner prompt into exactly one of two raw JSON objects with no markdown and no extra prose.",
  'On success, return {"subject":"...","topic":"...","description":"..."}.',
  'On failure for a non-learning request, return exactly {"error":"NOT_A_LEARNING_REQUEST"}.',
  "Subject must be one of: mathematics, physics, chemistry, biology, computer_science, economics, statistics, finance, engineering, philosophy, general.",
  "Topic must be lowercase and use underscores only.",
  "Description must be exactly four sentences and must follow the contract: sentence 1 starts with the topic name and 'is the study of'; sentence 2 starts with 'It encompasses'; sentence 3 starts with 'It assumes prior knowledge of' and includes 'and serves as a foundation for'; sentence 4 starts with 'Within' and ends with 'introductory level.', 'intermediate level.', or 'advanced level.'.",
  "Never invent a topic that is not a real academic concept.",
  "Never include markdown fences, headings, comments, or explanation text.",
].join(" ");

export type CanonicalizeDependencies = {
  callModel?: (prompt: string) => Promise<CanonicalizeResult>;
};

function buildCanonicalizeUserPrompt(prompt: string): string {
  return `Learner prompt:\n${prompt}`;
}

function parseCanonicalizeResult(value: unknown): CanonicalizeResult {
  const parsed = canonicalizeResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "CANONICALIZE_INVALID_OUTPUT",
      "Claude returned canonicalize output that did not match the required schema.",
      502,
      parsed.error.flatten(),
    );
  }

  if ("description" in parsed.data && !validateCanonicalDescription(parsed.data.description)) {
    throw new ApiError(
      "CANONICALIZE_INVALID_OUTPUT",
      "Claude returned a canonical description that failed the four-sentence contract.",
      502,
    );
  }

  return parsed.data;
}

async function callCanonicalizeModel(prompt: string): Promise<CanonicalizeResult> {
  const client = createAnthropicClient();
  const response = await client.messages.parse({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    temperature: 0,
    system: canonicalizeSystemPrompt,
    messages: [
      {
        role: "user",
        content: buildCanonicalizeUserPrompt(prompt),
      },
    ],
    output_config: {
      format: zodOutputFormat(canonicalizeResponseSchema),
    },
  });

  return parseCanonicalizeResult(
    (response as typeof response & { parsed_output?: unknown }).parsed_output,
  );
}

export async function canonicalizePrompt(
  prompt: string,
  context?: RequestLogContext,
  dependencies: CanonicalizeDependencies = {},
): Promise<CanonicalizeResult> {
  const validatedPrompt = canonicalizePromptSchema.parse(prompt);
  let lastError: unknown = null;
  const modelCaller = dependencies.callModel ?? callCanonicalizeModel;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      logInfo(context ?? { requestId: "canonicalize", route: "canonicalize", startedAtMs: Date.now() }, "canonicalize", attempt === 1 ? "start" : "retry", "Starting canonicalize", {
        attempt,
      });
      const result = await modelCaller(validatedPrompt);
      logInfo(context ?? { requestId: "canonicalize", route: "canonicalize", startedAtMs: Date.now() }, "canonicalize", "success", "Canonicalize succeeded");
      return result;
    } catch (error) {
      lastError = error;
      logError(
        context ?? { requestId: "canonicalize", route: "canonicalize", startedAtMs: Date.now() },
        "canonicalize",
        attempt === 1 ? "Canonicalize attempt failed; retrying once." : "Canonicalize failed after retry.",
        error,
        { attempt },
      );

      if (attempt === 2) {
        break;
      }
    }
  }

  throw new ApiError(
    "CANONICALIZE_FAILED",
    "Canonicalization failed after a retry.",
    502,
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}
