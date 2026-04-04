import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { canonicalizeModelSuccessDraftSchema } from "@/lib/schemas";
import type {
  CanonicalizeModelResult,
  CanonicalizeInventoryEntry,
  CanonicalizeModelSuccessDraft,
  CanonicalizeResolvedResult,
  CanonicalizeResolvedSuccess,
} from "@/lib/types";
import { ApiError } from "@/lib/errors";
import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import { hashPrompt, type RequestLogContext } from "@/lib/logging";
import { logError, logInfo, logWarn } from "@/lib/logging";
import {
  planGroundedCanonicalization,
  type CanonicalizeGroundingPlan,
  type RankedCanonicalizeInventoryCandidate,
} from "@/lib/server/canonicalize-inventory";
import {
  resolveCanonicalizeDraft,
  type CanonicalizeResolutionMetadata,
} from "@/lib/server/canonicalize-output";
import { runWithTimeout } from "@/lib/server/generation/llm-stage";

const CANONICALIZE_MODEL_TIMEOUT_MS = 8000;

const canonicalizePromptSchema = z.string().trim().min(1);
const canonicalizeProviderResponseSchema = z
  .object({
    status: z.enum(["accepted", "rejected"]),
    subject: z.string(),
    topic: z.string(),
    scope_summary: z.string(),
    core_concepts: z.array(z.string()),
    prerequisites: z.array(z.string()),
    downstream_topics: z.array(z.string()),
    level: z.string(),
    rejection_reason: z.string(),
  })
  .strict();

const canonicalizeDraftSystemPrompt = [
  "You are the Foundation canonicalizer.",
  "Convert a learner prompt into exactly one raw JSON object with no markdown and no extra prose.",
  'Always return this flat schema: {"status":"accepted|rejected","subject":"...","topic":"...","scope_summary":"...","core_concepts":["..."],"prerequisites":["..."],"downstream_topics":["..."],"level":"introductory|intermediate|advanced","rejection_reason":"..."}',
  'If accepted, set "status":"accepted" and set "rejection_reason" to an empty string.',
  'If the prompt is not a learning request, set "status":"rejected", set "rejection_reason":"NOT_A_LEARNING_REQUEST", and set the other fields to empty strings or empty arrays.',
  "Subject must be one of: mathematics, physics, chemistry, biology, computer_science, economics, financial_literacy, statistics, engineering, philosophy, general.",
  "Topic must name a real academic concept and be appropriate for a 4 to 25 node graph.",
  "scope_summary must be one short topic-boundary phrase or sentence fragment, 8 to 24 words, with no trailing punctuation.",
  "core_concepts must list 4 to 8 distinct core subtopics or concepts.",
  "prerequisites must list the prior knowledge needed for the topic.",
  "downstream_topics must list the 3 to 8 most important topics this becomes a foundation for, not every plausible downstream area.",
  "Preserve model-selected pedagogical salience in list order.",
  "If approved candidate topics are provided, choose one of them unless the prompt is not a learning request.",
  "If the learner prompt is broad or underspecified, choose the most likely self-directed starting topic. Examples: calculus -> differential_calculus, math -> algebra, physics -> classical_mechanics.",
  "Never include a description field.",
  "Never include markdown fences, headings, comments, or explanation text.",
].join(" ");

const canonicalizeRepairSystemPrompt = [
  "You are the Foundation canonicalizer repairer.",
  "Return only raw JSON.",
  "Repair the provided canonicalization draft so it satisfies the semantic canonicalization contract.",
  'Always return this flat schema: {"status":"accepted|rejected","subject":"...","topic":"...","scope_summary":"...","core_concepts":["..."],"prerequisites":["..."],"downstream_topics":["..."],"level":"introductory|intermediate|advanced","rejection_reason":"..."}',
  'If accepted, set "status":"accepted" and set "rejection_reason" to an empty string.',
  'If the prompt is not a learning request, set "status":"rejected", set "rejection_reason":"NOT_A_LEARNING_REQUEST", and set the other fields to empty strings or empty arrays.',
  "Subject must be one of: mathematics, physics, chemistry, biology, computer_science, economics, financial_literacy, statistics, engineering, philosophy, general.",
  "Topic must name a real academic concept, remain lowercase_with_underscores after normalization, and be appropriate for a 4 to 25 node graph.",
  "scope_summary must be one short topic-boundary phrase or sentence fragment, 8 to 24 words, with no trailing punctuation.",
  "core_concepts must list 4 to 8 distinct core subtopics or concepts.",
  "prerequisites must list 1 to 6 prior-knowledge topics required for the topic.",
  "downstream_topics must list 3 to 8 important topics this becomes a foundation for.",
  "level must be exactly introductory, intermediate, or advanced.",
  "Preserve the original topic intent while fixing formatting, normalization, missing list structure, duplicates, or underspecified semantic fields.",
  "If approved candidate topics are provided, keep the repaired topic within that approved set.",
  "Do not invent new semantic content that is absent from the prompt unless it is required to restate the same already-implied topic boundary.",
  "Do not change a topic to a narrower starting topic during repair; broad-prompt narrowing belongs to the initial canonicalization pass.",
  "Do not include a description field.",
].join(" ");

type CanonicalizeModelCallInput = {
  prompt: string;
  mode: "draft" | "repair";
  validationErrors?: string[];
  invalidDraft?: CanonicalizeModelSuccessDraft | null;
  groundedCandidates?: CanonicalizeInventoryEntry[];
};

export type CanonicalizeDependencies = {
  callModel?: (input: CanonicalizeModelCallInput) => Promise<CanonicalizeModelResult>;
};

export type CanonicalizeExecutionMode = "strict" | "demo";

function buildGroundedCandidatesBlock(candidates?: CanonicalizeInventoryEntry[]): string[] {
  if (!candidates || candidates.length === 0) {
    return [];
  }

  return [
    "Approved candidate topics:",
    ...candidates.map((candidate, index) =>
      `${index + 1}. ${candidate.topic} (${candidate.subject}) - ${candidate.scope_summary}`,
    ),
    "Choose one approved candidate topic if the learner prompt supports it.",
  ];
}

function buildCanonicalizeUserPrompt(input: CanonicalizeModelCallInput): string {
  return [
    `Learner prompt:\n${input.prompt}`,
    ...buildGroundedCandidatesBlock(input.groundedCandidates),
  ].join("\n\n");
}

function buildCanonicalizeRepairPrompt(input: CanonicalizeModelCallInput): string {
  return [
    `Learner prompt:\n${input.prompt}`,
    ...buildGroundedCandidatesBlock(input.groundedCandidates),
    "Validation failures:",
    ...(input.validationErrors && input.validationErrors.length > 0
      ? input.validationErrors
      : ["The prior draft did not satisfy the canonicalization contract."]),
    "Previous draft JSON:",
    input.invalidDraft ? JSON.stringify(input.invalidDraft, null, 2) : "Unavailable",
  ].join("\n\n");
}

export function parseCanonicalizeModelResult(value: unknown): CanonicalizeModelResult {
  const parsed = canonicalizeProviderResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "CANONICALIZE_INVALID_MODEL_OUTPUT",
      "Claude returned canonicalize output that did not match the provider response schema.",
      502,
      parsed.error.flatten(),
    );
  }

  if (parsed.data.status === "rejected") {
    if (parsed.data.rejection_reason !== "NOT_A_LEARNING_REQUEST") {
      throw new ApiError(
        "CANONICALIZE_INVALID_MODEL_OUTPUT",
        "Claude rejected canonicalization with an unsupported rejection reason.",
        502,
        { rejection_reason: parsed.data.rejection_reason },
      );
    }

    return { error: "NOT_A_LEARNING_REQUEST" };
  }

  const successDraft = canonicalizeModelSuccessDraftSchema.safeParse({
    subject: parsed.data.subject,
    topic: parsed.data.topic,
    scope_summary: parsed.data.scope_summary,
    core_concepts: parsed.data.core_concepts,
    prerequisites: parsed.data.prerequisites,
    downstream_topics: parsed.data.downstream_topics,
    level: parsed.data.level,
  });

  if (!successDraft.success) {
    throw new ApiError(
      "CANONICALIZE_INVALID_MODEL_OUTPUT",
      "Claude returned an accepted canonicalize payload that did not match the semantic draft schema.",
      502,
      {
        ...successDraft.error.flatten(),
        raw_candidate: truncateForLog({
          subject: parsed.data.subject,
          topic: parsed.data.topic,
          level: parsed.data.level,
        }),
      },
    );
  }

  return successDraft.data;
}

async function callCanonicalizeModel(
  input: CanonicalizeModelCallInput,
): Promise<CanonicalizeModelResult> {
  const client = getAnthropicClient();
  const response = await client.messages.parse({
    model: getAnthropicModel(),
    max_tokens: 1024,
    temperature: 0,
    system:
      input.mode === "repair"
        ? canonicalizeRepairSystemPrompt
        : canonicalizeDraftSystemPrompt,
    messages: [
      {
        role: "user",
        content:
          input.mode === "repair"
            ? buildCanonicalizeRepairPrompt(input)
            : buildCanonicalizeUserPrompt(input),
      },
    ],
    output_config: {
      format: zodOutputFormat(canonicalizeProviderResponseSchema),
    },
  });

  return parseCanonicalizeModelResult(
    (response as typeof response & { parsed_output?: unknown }).parsed_output,
  );
}

function createFallbackContext(): RequestLogContext {
  return {
    requestId: "canonicalize",
    route: "canonicalize",
    startedAtMs: Date.now(),
  };
}

function extractValidationErrors(error: unknown): string[] {
  if (error instanceof ApiError) {
    const details = error.details;
    if (typeof details === "string") {
      return [details];
    }
    if (details && typeof details === "object") {
      return [JSON.stringify(details)];
    }
    return [error.message];
  }

  if (error instanceof Error) {
    return [error.message];
  }

  return [String(error)];
}

function truncateForLog(value: unknown, maxStringLength = 240, depth = 0): unknown {
  if (depth > 3) {
    return "[truncated_depth]";
  }

  if (typeof value === "string") {
    if (value.length <= maxStringLength) {
      return value;
    }

    return `${value.slice(0, maxStringLength)}...[truncated ${value.length - maxStringLength} chars]`;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 10).map((entry) =>
      truncateForLog(entry, maxStringLength, depth + 1),
    );
    if (value.length > 10) {
      items.push(`[truncated ${value.length - 10} items]`);
    }
    return items;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 12).map(([key, entry]) => [
        key,
        truncateForLog(entry, maxStringLength, depth + 1),
      ]),
    );
  }

  return value;
}

function summarizeRankedCandidates(
  rankedCandidates: RankedCanonicalizeInventoryCandidate[],
): Array<{ topic: string; score: number; reasons: string[] }> {
  return rankedCandidates.slice(0, 5).map((candidate) => ({
    topic: candidate.entry.topic,
    score: candidate.score,
    reasons: candidate.reasons,
  }));
}

function createResolutionMetadata(input: {
  source: CanonicalizeResolutionMetadata["canonicalization_source"];
  inventoryCandidateTopics: string[];
  candidateConfidenceBand: CanonicalizeResolutionMetadata["candidate_confidence_band"];
}): CanonicalizeResolutionMetadata {
  return {
    canonicalization_source: input.source,
    inventory_candidate_topics: input.inventoryCandidateTopics,
    candidate_confidence_band: input.candidateConfidenceBand,
  };
}

function extractCanonicalizeFailureSubtype(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "UPSTREAM_TIMEOUT") {
      return "draft_timeout";
    }
    if (error.code === "CANONICALIZE_INVALID_MODEL_OUTPUT") {
      return "repair_semantic_invalid";
    }
    if (error.code === "CANONICALIZE_CONSTRAINED_TOPIC_MISMATCH") {
      return "repair_topic_mismatch";
    }
  }

  if (error instanceof Error) {
    return "unexpected_internal";
  }

  return "unknown_failure";
}

function extractInvalidFieldSummary(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError)) {
    return null;
  }

  const details = error.details;
  if (!details || typeof details !== "object") {
    return null;
  }

  const candidate = details as {
    fieldErrors?: unknown;
    raw_candidate?: unknown;
  };

  return truncateForLog({
    fieldErrors: candidate.fieldErrors ?? null,
    raw_candidate: candidate.raw_candidate ?? null,
  }) as Record<string, unknown>;
}

function extractLearningTopicPhrase(prompt: string): string | null {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:i want to|i'd like to|please help me)\s+(?:learn|study|understand|master|explore)\s+(.+)$/i,
    /(?:learn|study|understand|master|explore)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const phrase = match?.[1]
      ?.replace(/[.?!]+$/g, "")
      .replace(/^(about|the)\s+/i, "")
      .trim();
    if (phrase) {
      return phrase;
    }
  }

  return null;
}

function createHeuristicFallbackDraft(prompt: string): CanonicalizeModelSuccessDraft | null {
  const phrase = extractLearningTopicPhrase(prompt);
  if (!phrase) {
    return null;
  }

  const topic = phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!/^[a-z][a-z0-9_]*$/.test(topic)) {
    return null;
  }

  return {
    subject: "general",
    topic,
    scope_summary: `core ideas, vocabulary, methods, and practical applications involved in ${phrase}`,
    core_concepts: [
      `foundational ideas of ${phrase}`,
      `key terminology in ${phrase}`,
      `core methods in ${phrase}`,
      `common representations of ${phrase}`,
      `typical problem types in ${phrase}`,
      `practical applications of ${phrase}`,
    ],
    prerequisites: ["basic reading comprehension"],
    downstream_topics: [
      `advanced ${phrase}`,
      "applied problem solving",
      "interdisciplinary study",
    ],
    level: "introductory",
  };
}

function buildDemoFallbackDraft(
  prompt: string,
  groundingPlan: CanonicalizeGroundingPlan,
): { draft: CanonicalizeModelSuccessDraft; mode: "grounded_candidate" | "heuristic_general" } | null {
  if (groundingPlan.grounded_candidates.length > 0) {
    return {
      draft: groundingPlan.grounded_candidates[0]!,
      mode: "grounded_candidate",
    };
  }

  const heuristicDraft = createHeuristicFallbackDraft(prompt);
  if (heuristicDraft) {
    return {
      draft: heuristicDraft,
      mode: "heuristic_general",
    };
  }

  return null;
}

function assertGroundedTopicChoice(
  draft: CanonicalizeModelSuccessDraft,
  groundedCandidates: CanonicalizeInventoryEntry[],
): void {
  if (groundedCandidates.length === 0) {
    return;
  }

  const groundedTopics = new Set(groundedCandidates.map((candidate) => candidate.topic));
  const normalizedTopic = draft.topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (groundedTopics.has(normalizedTopic)) {
    return;
  }

  throw new ApiError(
    "CANONICALIZE_CONSTRAINED_TOPIC_MISMATCH",
    "Canonicalizer returned a topic outside the approved grounded candidate set.",
    502,
    {
      topic: normalizedTopic,
      approved_topics: [...groundedTopics],
    },
  );
}

function resolveDraftOrThrow(
  draft: CanonicalizeModelSuccessDraft,
  context: RequestLogContext,
  metadata: CanonicalizeResolutionMetadata,
): CanonicalizeResolvedSuccess {
  const draftInput = {
    subject: draft.subject,
    topic: draft.topic,
    scope_summary: draft.scope_summary,
    core_concepts: draft.core_concepts,
    prerequisites: draft.prerequisites,
    downstream_topics: draft.downstream_topics,
    level: draft.level,
  };
  const validatedDraft = canonicalizeModelSuccessDraftSchema.safeParse(draftInput);
  if (!validatedDraft.success) {
    throw new ApiError(
      "CANONICALIZE_INVALID_MODEL_OUTPUT",
      "Claude returned an accepted canonicalize payload that did not match the semantic draft schema.",
      502,
      {
        ...validatedDraft.error.flatten(),
        raw_candidate: truncateForLog({
          subject: draftInput.subject,
          topic: draftInput.topic,
          level: draftInput.level,
        }),
      },
    );
  }

  logInfo(context, "canonicalize", "success", "Canonicalize draft parsed.", {
    prompt_hash: hashPrompt(JSON.stringify(validatedDraft.data)),
    raw_draft: truncateForLog(validatedDraft.data),
    canonicalization_source: metadata.canonicalization_source,
    candidate_confidence_band: metadata.candidate_confidence_band,
    inventory_candidate_topics: metadata.inventory_candidate_topics,
  });

  const resolved = resolveCanonicalizeDraft(validatedDraft.data, metadata);

  logInfo(context, "canonicalize", "success", "Canonicalize draft resolved.", {
    normalized_draft: {
      subject: resolved.subject,
      topic: resolved.topic,
      scope_summary: resolved.scope_summary,
      core_concepts: resolved.core_concepts,
      prerequisites: resolved.prerequisites,
      downstream_topics: resolved.downstream_topics,
      level: resolved.level,
      canonicalization_source: resolved.canonicalization_source,
      inventory_candidate_topics: resolved.inventory_candidate_topics,
      candidate_confidence_band: resolved.candidate_confidence_band,
      canonicalization_version: resolved.canonicalization_version,
    },
    description_hash: hashPrompt(resolved.description),
  });

  return resolved;
}

export async function canonicalizePrompt(
  prompt: string,
  context?: RequestLogContext,
  dependencies: CanonicalizeDependencies = {},
  options: { mode?: CanonicalizeExecutionMode } = {},
): Promise<CanonicalizeResolvedResult> {
  const validatedPrompt = canonicalizePromptSchema.parse(prompt);
  const logContext = context ?? createFallbackContext();
  const modelCaller = dependencies.callModel ?? callCanonicalizeModel;
  const executionMode = options.mode ?? "strict";

  logInfo(logContext, "canonicalize", "start", "Starting canonicalize.", {
    prompt_hash: hashPrompt(validatedPrompt),
  });

  const groundingPlan = planGroundedCanonicalization(validatedPrompt);
  logInfo(logContext, "canonicalize", "success", "Canonicalize grounding plan prepared.", {
    canonicalization_source: groundingPlan.source,
    candidate_confidence_band: groundingPlan.candidate_confidence_band,
    inventory_candidate_topics: groundingPlan.inventory_candidate_topics,
    candidate_set_size: groundingPlan.inventory_candidate_topics.length,
    ranked_candidates: summarizeRankedCandidates(groundingPlan.ranked_candidates),
    model_choice_mode:
      groundingPlan.source === "grounded_plus_model" ? "candidate_constrained" : "free_choice",
  });

  if (groundingPlan.grounded_match) {
    const groundedMetadata = createResolutionMetadata({
      source: "grounded_match",
      inventoryCandidateTopics: groundingPlan.inventory_candidate_topics,
      candidateConfidenceBand: groundingPlan.candidate_confidence_band,
    });
    const resolved = resolveDraftOrThrow(
      groundingPlan.grounded_match,
      logContext,
      groundedMetadata,
    );
    logInfo(logContext, "canonicalize", "success", "Canonicalize resolved from grounded inventory.", {
      canonicalization_version: resolved.canonicalization_version,
      description_hash: hashPrompt(resolved.description),
      candidate_set_size: groundingPlan.inventory_candidate_topics.length,
    });
    return resolved;
  }

  let firstDraft: CanonicalizeModelSuccessDraft | null = null;
  let firstError: unknown = null;
  const modelMetadata = createResolutionMetadata({
    source: groundingPlan.source,
    inventoryCandidateTopics: groundingPlan.inventory_candidate_topics,
    candidateConfidenceBand: groundingPlan.candidate_confidence_band,
  });

  try {
    const firstResult = await runWithTimeout(
      modelCaller({
        prompt: validatedPrompt,
        mode: "draft",
        groundedCandidates:
          groundingPlan.source === "grounded_plus_model"
            ? groundingPlan.grounded_candidates
            : undefined,
      }),
      CANONICALIZE_MODEL_TIMEOUT_MS,
        () =>
          new ApiError(
            "UPSTREAM_TIMEOUT",
            `canonicalize draft timed out after ${CANONICALIZE_MODEL_TIMEOUT_MS}ms.`,
            504,
          ),
    );

    if ("error" in firstResult) {
      logInfo(logContext, "canonicalize", "success", "Canonicalize rejected non-learning prompt.");
      return firstResult;
    }

    firstDraft = firstResult;
    if (groundingPlan.source === "grounded_plus_model") {
      assertGroundedTopicChoice(firstResult, groundingPlan.grounded_candidates);
    }
    const resolved = resolveDraftOrThrow(firstResult, logContext, modelMetadata);
    logInfo(logContext, "canonicalize", "success", "Canonicalize succeeded.", {
      canonicalization_source: resolved.canonicalization_source,
      candidate_confidence_band: resolved.candidate_confidence_band,
      inventory_candidate_topics: resolved.inventory_candidate_topics,
      candidate_set_size: resolved.inventory_candidate_topics.length,
      model_choice_mode:
        groundingPlan.source === "grounded_plus_model" ? "candidate_constrained" : "free_choice",
      canonicalization_version: resolved.canonicalization_version,
      local_repair_policy:
        "trim_whitespace,dedupe_preserve_order,strip_trailing_punctuation,slug_normalize_topic,drop_empty_items_only",
      description_hash: hashPrompt(resolved.description),
    });
    return resolved;
  } catch (error) {
    firstError = error;
    logError(
      logContext,
      "canonicalize",
      "Canonicalize draft failed validation; attempting targeted repair.",
      error,
      {
        failure_subtype: extractCanonicalizeFailureSubtype(error),
        repair_mode: "targeted",
        invalid_draft: truncateForLog(firstDraft),
        validation_errors: truncateForLog(extractValidationErrors(firstError)),
        invalid_field_summary: extractInvalidFieldSummary(error),
      },
    );
  }

  try {
    const repairResult = await runWithTimeout(
      modelCaller({
        prompt: validatedPrompt,
        mode: "repair",
        invalidDraft: firstDraft,
        validationErrors: extractValidationErrors(firstError),
        groundedCandidates:
          groundingPlan.source === "grounded_plus_model"
            ? groundingPlan.grounded_candidates
            : undefined,
      }),
      CANONICALIZE_MODEL_TIMEOUT_MS,
        () =>
          new ApiError(
            "UPSTREAM_TIMEOUT",
            `canonicalize repair timed out after ${CANONICALIZE_MODEL_TIMEOUT_MS}ms.`,
            504,
          ),
    );

    if ("error" in repairResult) {
      throw new ApiError(
        "CANONICALIZE_REPAIR_INVALID_OUTPUT",
        "Canonicalize repair returned a non-learning response after an initial learning draft.",
        502,
      );
    }

    if (groundingPlan.source === "grounded_plus_model") {
      assertGroundedTopicChoice(repairResult, groundingPlan.grounded_candidates);
    }

    const resolved = resolveDraftOrThrow(repairResult, logContext, modelMetadata);
    logInfo(logContext, "canonicalize", "success", "Canonicalize succeeded after targeted repair.", {
      canonicalization_source: resolved.canonicalization_source,
      candidate_confidence_band: resolved.candidate_confidence_band,
      inventory_candidate_topics: resolved.inventory_candidate_topics,
      candidate_set_size: resolved.inventory_candidate_topics.length,
      canonicalization_version: resolved.canonicalization_version,
      description_hash: hashPrompt(resolved.description),
    });
    return resolved;
  } catch (error) {
    logError(
      logContext,
      "canonicalize",
      "Canonicalize failed after targeted repair.",
      error,
      {
        failure_subtype: extractCanonicalizeFailureSubtype(error),
        validation_errors: truncateForLog(extractValidationErrors(firstError)),
        invalid_draft: truncateForLog(firstDraft),
        invalid_field_summary: extractInvalidFieldSummary(error),
      },
    );

    if (
      executionMode === "demo" &&
      extractCanonicalizeFailureSubtype(firstError) === "draft_timeout"
    ) {
      const fallback = buildDemoFallbackDraft(validatedPrompt, groundingPlan);
      if (fallback) {
        const fallbackMetadata = createResolutionMetadata({
          source:
            fallback.mode === "grounded_candidate" ? "grounded_match" : "model_only",
          inventoryCandidateTopics:
            fallback.mode === "grounded_candidate"
              ? groundingPlan.inventory_candidate_topics
              : [],
          candidateConfidenceBand:
            fallback.mode === "grounded_candidate"
              ? groundingPlan.candidate_confidence_band
              : "none",
        });
        const resolved = resolveDraftOrThrow(fallback.draft, logContext, fallbackMetadata);
        logWarn(
          logContext,
          "canonicalize",
          "success",
          "Canonicalize used demo fallback after draft timeout and repair failure.",
          {
            fallback_mode: fallback.mode,
            initial_failure_subtype: extractCanonicalizeFailureSubtype(firstError),
            repair_failure_subtype: extractCanonicalizeFailureSubtype(error),
            canonicalization_source: resolved.canonicalization_source,
            topic: resolved.topic,
            subject: resolved.subject,
          },
        );
        return resolved;
      }
    }

    throw new ApiError(
      "CANONICALIZE_FAILED",
      "Canonicalization failed after targeted repair.",
      502,
      {
        initial_error: firstError instanceof Error ? firstError.message : String(firstError),
        repair_error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
