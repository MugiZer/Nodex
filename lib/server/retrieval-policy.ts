import type { RetrievalCandidate, RetrievalDecision, SupportedSubject } from "@/lib/types";
import { ApiError } from "@/lib/errors";
import { RETRIEVAL_THRESHOLD, decideRetrievalCandidate } from "@/lib/domain/retrieval";
import { embedDescription } from "@/lib/server/openai-embedding";
import { createRetrieveSource } from "@/lib/server/retrieve-source";

export { RETRIEVAL_THRESHOLD };

export type RetrieveInput = {
  subject: SupportedSubject;
  description: string;
};

export type RetrieveDependencies = {
  embedDescription?: typeof embedDescription;
  fetchRetrievalCandidates?: (input: {
    subject: SupportedSubject;
    embedding: number[];
  }) => Promise<RetrievalCandidate[]>;
};

export async function resolveRetrievalDecision(
  input: RetrieveInput,
  dependencies: RetrieveDependencies = {},
): Promise<RetrievalDecision> {
  const embeddingFn = dependencies.embedDescription ?? embedDescription;
  const fetchCandidates =
    dependencies.fetchRetrievalCandidates ?? createRetrieveSource().fetchRetrievalCandidates;

  if (!input.subject) {
    throw new ApiError("INVALID_RETRIEVAL_INPUT", "subject is required.", 400);
  }

  if (!input.description.trim()) {
    throw new ApiError("INVALID_RETRIEVAL_INPUT", "description is required.", 400);
  }

  const embedding = await embeddingFn(input.description);
  const candidates = await fetchCandidates({
    subject: input.subject,
    embedding,
  });

  return decideRetrievalCandidate(candidates, RETRIEVAL_THRESHOLD);
}
