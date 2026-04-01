import type { SupportedSubject, RetrievalCandidate } from "@/lib/types";

export type RetrieveSource = {
  fetchRetrievalCandidates: (input: {
    subject: SupportedSubject;
    embedding: number[];
  }) => Promise<RetrievalCandidate[]>;
};

export function createRetrieveSource(): RetrieveSource {
  return {
    async fetchRetrievalCandidates() {
      return [];
    },
  };
}
