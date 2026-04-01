import type { RetrievalCandidate, RetrievalDecision } from "@/lib/types";

export const RETRIEVAL_THRESHOLD = 0.85;

export function sortRetrievalCandidates(
  candidates: RetrievalCandidate[],
): RetrievalCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.similarity !== left.similarity) {
      return right.similarity - left.similarity;
    }

    if (left.flagged_for_review !== right.flagged_for_review) {
      return Number(left.flagged_for_review) - Number(right.flagged_for_review);
    }

    if (right.version !== left.version) {
      return right.version - left.version;
    }

    return Date.parse(right.created_at) - Date.parse(left.created_at);
  });
}

export function decideRetrievalCandidate(
  candidates: RetrievalCandidate[],
  threshold = RETRIEVAL_THRESHOLD,
): RetrievalDecision {
  if (candidates.length === 0) {
    return { graph_id: null, reason: "no_candidates", candidate: null };
  }

  const sorted = sortRetrievalCandidates(candidates);
  const thresholdMatches = sorted.filter((candidate) => candidate.similarity >= threshold);

  if (thresholdMatches.length === 0) {
    return {
      graph_id: null,
      reason: "below_threshold",
      candidate: sorted[0] ?? null,
    };
  }

  const unflaggedMatch = thresholdMatches.find(
    (candidate) => !candidate.flagged_for_review,
  );

  if (!unflaggedMatch) {
    return {
      graph_id: null,
      reason: "only_flagged_matches",
      candidate: thresholdMatches[0] ?? null,
    };
  }

  return {
    graph_id: unflaggedMatch.id,
    reason: "usable_unflagged_match",
    candidate: unflaggedMatch,
  };
}
