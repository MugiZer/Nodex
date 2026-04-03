import { describe, expect, it } from "vitest";

import {
  planGroundedCanonicalization,
  rankCanonicalizeInventoryCandidates,
} from "@/lib/server/canonicalize-inventory";

describe("canonicalize inventory grounding", () => {
  it("deterministically maps broad starter prompts to grounded matches", () => {
    expect(planGroundedCanonicalization("I want to learn calculus")).toMatchObject({
      source: "grounded_match",
      candidate_confidence_band: "high",
      inventory_candidate_topics: ["differential_calculus"],
    });

    expect(planGroundedCanonicalization("I want to learn math")).toMatchObject({
      source: "grounded_match",
      candidate_confidence_band: "high",
      inventory_candidate_topics: ["algebra"],
    });

    expect(planGroundedCanonicalization("I want to learn physics")).toMatchObject({
      source: "grounded_match",
      candidate_confidence_band: "high",
      inventory_candidate_topics: ["classical_mechanics"],
    });

    expect(planGroundedCanonicalization("I want to learn computer science")).toMatchObject({
      source: "grounded_match",
      candidate_confidence_band: "high",
      inventory_candidate_topics: ["programming_fundamentals"],
    });
  });

  it("keeps a clear winning candidate when one prompt strongly favors it", () => {
    const ranked = rankCanonicalizeInventoryCandidates(
      "I want to learn physics mechanics",
    );

    expect(ranked[0]?.entry.topic).toBe("classical_mechanics");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("uses a constrained model lane when multiple grounded candidates are plausible", () => {
    const plan = planGroundedCanonicalization("I want to learn physics and math");

    expect(plan.source).toBe("grounded_plus_model");
    expect(plan.candidate_confidence_band).toBe("medium");
    expect(plan.inventory_candidate_topics).toEqual(["algebra", "classical_mechanics"]);
  });

  it("falls back to the free-choice model lane for low-confidence semantic overlap", () => {
    const plan = planGroundedCanonicalization("I want to learn equations and functions");

    expect(plan.source).toBe("model_only");
    expect(plan.candidate_confidence_band).toBe("low");
    expect(plan.inventory_candidate_topics).toEqual(["algebra"]);
  });

  it("uses the free-choice model lane when no inventory candidate matches", () => {
    expect(planGroundedCanonicalization("I want to learn category theory")).toMatchObject({
      source: "model_only",
      candidate_confidence_band: "none",
      inventory_candidate_topics: [],
    });
  });
});
