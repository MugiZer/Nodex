import { ApiError } from "@/lib/errors";
import {
  CANONICALIZATION_VERSION,
  type CandidateConfidenceBand,
  type CanonicalizationSource,
  type CanonicalizeModelSuccessDraft,
  type CanonicalizePublicSuccess,
  type CanonicalizeResolvedSuccess,
} from "@/lib/types";

export type CanonicalizeResolutionMetadata = {
  canonicalization_source: CanonicalizationSource;
  inventory_candidate_topics: string[];
  candidate_confidence_band: CandidateConfidenceBand;
};

const DEFAULT_RESOLUTION_METADATA: CanonicalizeResolutionMetadata = {
  canonicalization_source: "model_only",
  inventory_candidate_topics: [],
  candidate_confidence_band: "none",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function normalizePhrase(value: string): string {
  return stripTrailingPunctuation(normalizeWhitespace(value));
}

function createPhraseKey(value: string): string {
  return normalizePhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function countWords(value: string): number {
  return normalizeWhitespace(value).split(" ").filter((part) => part.length > 0).length;
}

export function normalizeTopicSlug(topic: string): string {
  const normalized = normalizeWhitespace(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized;
}

function normalizeList(
  label: string,
  values: string[],
  options: { min: number; max: number },
): string[] {
  const normalized = values
    .map((value) => normalizePhrase(value))
    .filter((value) => value.length > 0);

  const deduped = new Map<string, string>();
  for (const value of normalized) {
    const key = createPhraseKey(value);
    if (key.length === 0 || deduped.has(key)) {
      continue;
    }
    deduped.set(key, value);
  }

  const ordered = [...deduped.values()];

  if (ordered.length < options.min || ordered.length > options.max) {
    throw new ApiError(
      "CANONICALIZE_INVALID_DRAFT",
      `Canonical ${label} must contain between ${options.min} and ${options.max} distinct entries after normalization.`,
      502,
      { label, count: ordered.length, values: ordered },
    );
  }

  return ordered;
}

function ensureNormalizedTopic(topic: string): string {
  const normalized = normalizeTopicSlug(topic);
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new ApiError(
      "CANONICALIZE_INVALID_DRAFT",
      "Canonical topic could not be normalized into a valid lowercase underscore slug.",
      502,
      { topic },
    );
  }

  return normalized;
}

function normalizeScopeSummary(summary: string): string {
  const normalized = normalizePhrase(summary);
  const wordCount = countWords(normalized);
  if (wordCount < 8 || wordCount > 24) {
    throw new ApiError(
      "CANONICALIZE_INVALID_DRAFT",
      "Canonical scope_summary must be a short topic-boundary phrase of 8 to 24 words after normalization.",
      502,
      { scope_summary: normalized, word_count: wordCount },
    );
  }

  return normalized;
}

function renderTopicLabel(topic: string): string {
  const segments = topic.split("_");
  const labels: string[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    const pair = `${segment}_${nextSegment ?? ""}`;

    if (pair === "u_s") {
      labels.push("U.S.");
      index += 1;
      continue;
    }

    if (segment === "us") {
      labels.push("U.S.");
      continue;
    }

    if (segment === "uk") {
      labels.push("U.K.");
      continue;
    }

    if (segment === "eu") {
      labels.push("E.U.");
      continue;
    }

    labels.push(`${segment.charAt(0).toUpperCase()}${segment.slice(1)}`);
  }

  return labels.join(" ");
}

function joinList(values: string[]): string {
  return values.join(", ");
}

export function renderCanonicalDescription(
  input: Pick<
    CanonicalizeResolvedSuccess,
    | "subject"
    | "topic"
    | "scope_summary"
    | "core_concepts"
    | "prerequisites"
    | "downstream_topics"
    | "level"
  >,
): string {
  const topicLabel = renderTopicLabel(input.topic);
  return [
    `${topicLabel} is the study of ${input.scope_summary}.`,
    `It encompasses ${joinList(input.core_concepts)}.`,
    `It assumes prior knowledge of ${joinList(input.prerequisites)} and serves as a foundation for ${joinList(input.downstream_topics)}.`,
    `Within ${input.subject}, it is typically encountered at the ${input.level} level.`,
  ].join(" ");
}

export function validateCanonicalDescription(description: string): boolean {
  const normalized = normalizeWhitespace(description);
  const marker1 = " is the study of ";
  const marker2 = ". It encompasses ";
  const marker3 = ". It assumes prior knowledge of ";
  const marker4 = " and serves as a foundation for ";
  const marker5 = ". Within ";
  const marker6 = ", it is typically encountered at the ";
  const levelSuffix = " level.";

  const index1 = normalized.indexOf(marker1);
  const index2 = normalized.indexOf(marker2);
  const index3 = normalized.indexOf(marker3);
  const index4 = normalized.indexOf(marker4);
  const index5 = normalized.indexOf(marker5);
  const index6 = normalized.indexOf(marker6);

  if (
    index1 <= 0 ||
    index2 <= index1 ||
    index3 <= index2 ||
    index4 <= index3 ||
    index5 <= index4 ||
    index6 <= index5 ||
    !normalized.endsWith(levelSuffix)
  ) {
    return false;
  }

  const topicLabel = normalized.slice(0, index1);
  const scopeSummary = normalized.slice(index1 + marker1.length, index2);
  const coreConcepts = normalized.slice(index2 + marker2.length, index3);
  const prerequisites = normalized.slice(index3 + marker3.length, index4);
  const downstreamTopics = normalized.slice(index4 + marker4.length, index5);
  const subject = normalized.slice(index5 + marker5.length, index6);
  const level = normalized.slice(index6 + marker6.length, -levelSuffix.length);

  return (
    /^[A-Z][A-Za-z.\s]+$/.test(topicLabel) &&
    scopeSummary.length > 0 &&
    coreConcepts.length > 0 &&
    prerequisites.length > 0 &&
    downstreamTopics.length > 0 &&
    /^[a-z_]+$/.test(subject) &&
    /^(introductory|intermediate|advanced)$/.test(level)
  );
}

export function resolveCanonicalizeDraft(
  draft: CanonicalizeModelSuccessDraft,
  metadata: CanonicalizeResolutionMetadata = DEFAULT_RESOLUTION_METADATA,
): CanonicalizeResolvedSuccess {
  const topic = ensureNormalizedTopic(draft.topic);
  const scopeSummary = normalizeScopeSummary(draft.scope_summary);
  const coreConcepts = normalizeList("core_concepts", draft.core_concepts, {
    min: 4,
    max: 8,
  });
  const prerequisites = normalizeList("prerequisites", draft.prerequisites, {
    min: 1,
    max: 6,
  });
  const downstreamTopics = normalizeList(
    "downstream_topics",
    draft.downstream_topics,
    {
      min: 3,
      max: 8,
    },
  );

  const resolved: CanonicalizeResolvedSuccess = {
    subject: draft.subject,
    topic,
    description: "",
    scope_summary: scopeSummary,
    core_concepts: coreConcepts,
    prerequisites,
    downstream_topics: downstreamTopics,
    level: draft.level,
    canonicalization_source: metadata.canonicalization_source,
    inventory_candidate_topics: metadata.inventory_candidate_topics,
    candidate_confidence_band: metadata.candidate_confidence_band,
    canonicalization_version: CANONICALIZATION_VERSION,
  };

  const description = renderCanonicalDescription(resolved);
  if (!validateCanonicalDescription(description)) {
    throw new ApiError(
      "CANONICALIZE_RENDER_FAILED",
      "Rendered canonical description did not satisfy the public four-sentence contract.",
      502,
      { description },
    );
  }

  return {
    ...resolved,
    description,
  };
}

export function toPublicCanonicalizeSuccess(
  resolved: CanonicalizeResolvedSuccess,
): CanonicalizePublicSuccess {
  return {
    subject: resolved.subject,
    topic: resolved.topic,
    description: resolved.description,
  };
}
