import { describe, expect, it } from "vitest";

import {
  decideRetrievalCandidate,
  sortRetrievalCandidates,
} from "@/lib/domain/retrieval";
import type { RetrievalCandidate } from "@/lib/types";

import { retrievalFixtureCandidates } from "../harness/fixtures";

describe("retrieval ranking", () => {
  it("sorts by similarity, flagged state, version, then recency", () => {
    const candidates: RetrievalCandidate[] = [
      {
        id: "00000000-0000-4000-8000-000000000003",
        similarity: 0.92,
        flagged_for_review: false,
        version: 1,
        created_at: "2026-03-27T12:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        similarity: 0.95,
        flagged_for_review: true,
        version: 2,
        created_at: "2026-03-29T12:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        similarity: 0.95,
        flagged_for_review: false,
        version: 1,
        created_at: "2026-03-28T12:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        similarity: 0.95,
        flagged_for_review: false,
        version: 3,
        created_at: "2026-03-26T12:00:00.000Z",
      },
    ];

    const sorted = sortRetrievalCandidates(candidates);
    expect(sorted.map((candidate) => candidate.id)).toEqual([
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("returns the best unflagged threshold candidate", () => {
    const decision = decideRetrievalCandidate(
      retrievalFixtureCandidates
        .filter((candidate) => candidate.subject === "mathematics")
        .map((candidate) => ({
          id: candidate.id,
          similarity: candidate.similarity,
          flagged_for_review: candidate.flagged_for_review,
          version: candidate.version,
          created_at: candidate.created_at,
        })),
    );
    expect(decision.graph_id).toBe("77777777-7777-4777-8777-777777777777");
    expect(decision.reason).toBe("usable_unflagged_match");
  });

  it("returns a miss when only flagged candidates satisfy threshold", () => {
    const decision = decideRetrievalCandidate([
      {
        id: "11111111-1111-4111-8111-111111111112",
        similarity: 0.91,
        flagged_for_review: true,
        version: 4,
        created_at: "2026-04-01T00:00:00.000Z",
      },
    ]);

    expect(decision.graph_id).toBeNull();
    expect(decision.reason).toBe("only_flagged_matches");
  });

  it("returns a miss below threshold", () => {
    const decision = decideRetrievalCandidate([
      {
        id: "11111111-1111-4111-8111-111111111113",
        similarity: 0.84,
        flagged_for_review: false,
        version: 1,
        created_at: "2026-04-01T00:00:00.000Z",
      },
    ]);

    expect(decision.graph_id).toBeNull();
    expect(decision.reason).toBe("below_threshold");
  });
});
