import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";
import {
  canonicalizePrompt,
  parseCanonicalizeModelResult,
} from "@/lib/server/canonicalize";
import type {
  CanonicalizeInventoryEntry,
  CanonicalizeModelSuccessDraft,
} from "@/lib/types";

function createDraft(
  overrides: Partial<CanonicalizeModelSuccessDraft> = {},
): CanonicalizeModelSuccessDraft {
  return {
    subject: "mathematics",
    topic: "algebra",
    scope_summary:
      "symbols, expressions, equations, and functions used to represent and manipulate quantitative relationships",
    core_concepts: [
      "expressions",
      "equations",
      "functions",
      "inequalities",
      "polynomials",
      "factoring",
      "systems of equations",
    ],
    prerequisites: ["arithmetic"],
    downstream_topics: ["trigonometry", "calculus", "statistics"],
    level: "introductory",
    ...overrides,
  };
}

describe("canonicalize prompt grounding flow", () => {
  it("maps accepted and rejected provider envelopes into internal canonicalize results", () => {
    expect(
      parseCanonicalizeModelResult({
        status: "accepted",
        subject: "mathematics",
        topic: "trigonometry",
        scope_summary:
          "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
        core_concepts: [
          "sine",
          "cosine",
          "tangent",
          "trigonometric identities",
        ],
        prerequisites: ["algebra"],
        downstream_topics: ["calculus", "statistics", "physics"],
        level: "intermediate",
        rejection_reason: "",
      }),
    ).toMatchObject({
      subject: "mathematics",
      topic: "trigonometry",
      level: "intermediate",
    });

    expect(
      parseCanonicalizeModelResult({
        status: "rejected",
        subject: "",
        topic: "",
        scope_summary: "",
        core_concepts: [],
        prerequisites: [],
        downstream_topics: [],
        level: "",
        rejection_reason: "NOT_A_LEARNING_REQUEST",
      }),
    ).toEqual({ error: "NOT_A_LEARNING_REQUEST" });

    expect(() =>
      parseCanonicalizeModelResult({
        status: "accepted",
        subject: "history",
        topic: "trigonometry",
        scope_summary:
          "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
        core_concepts: [
          "sine",
          "cosine",
          "tangent",
          "trigonometric identities",
        ],
        prerequisites: ["algebra"],
        downstream_topics: ["calculus", "statistics", "physics"],
        level: "intermediate",
        rejection_reason: "",
      }),
    ).toThrow(/semantic draft schema/);
  });

  it("resolves decisive inventory-covered starter prompts without calling the model", async () => {
    const callModel = vi.fn();

    const result = await canonicalizePrompt("I want to learn calculus", undefined, {
      callModel,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(callModel).not.toHaveBeenCalled();
    expect(result.topic).toBe("differential_calculus");
    expect(result.canonicalization_source).toBe("grounded_match");
    expect(result.inventory_candidate_topics).toEqual(["differential_calculus"]);
    expect(result.candidate_confidence_band).toBe("high");
  });

  it("constrains the model to grounded candidates for medium-confidence ambiguity", async () => {
    const callModel = vi.fn(async ({ groundedCandidates }) => {
      expect(
        groundedCandidates?.map((candidate: CanonicalizeInventoryEntry) => candidate.topic),
      ).toEqual([
        "algebra",
        "classical_mechanics",
      ]);

      return createDraft({
        topic: "algebra",
        scope_summary:
          "symbols, expressions, equations, and functions used to represent and manipulate quantitative relationships",
        core_concepts: [
          "expressions",
          "equations",
          "functions",
          "inequalities",
          "polynomials",
          "factoring",
          "systems of equations",
        ],
        prerequisites: ["arithmetic"],
        downstream_topics: ["trigonometry", "calculus", "statistics"],
        level: "introductory",
      });
    });

    const result = await canonicalizePrompt("I want to learn physics and math", undefined, {
      callModel,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.canonicalization_source).toBe("grounded_plus_model");
    expect(result.inventory_candidate_topics).toEqual([
      "algebra",
      "classical_mechanics",
    ]);
    expect(result.candidate_confidence_band).toBe("medium");
    expect(result.description).toContain("quantitative relationships");
    expect(result.description).toContain("polynomials");
    expect(result.description).toContain("trigonometry");
  });

  it("keeps long-tail prompts on the free-choice model lane", async () => {
    const callModel = vi.fn(async ({ groundedCandidates }) => {
      expect(groundedCandidates).toBeUndefined();

      return createDraft({
        topic: "category_theory",
        scope_summary:
          "abstract structures, mathematical mappings, and universal constructions across different formal systems",
        core_concepts: [
          "objects and morphisms",
          "commutative diagrams",
          "functors",
          "natural transformations",
          "limits and colimits",
          "adjunctions",
          "universal properties",
        ],
        prerequisites: ["set theory", "proof writing"],
        downstream_topics: ["algebraic topology", "type theory", "homological algebra"],
        level: "advanced",
      });
    });

    const result = await canonicalizePrompt("I want to learn category theory", undefined, {
      callModel,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.canonicalization_source).toBe("model_only");
    expect(result.inventory_candidate_topics).toEqual([]);
    expect(result.candidate_confidence_band).toBe("none");
    expect(result.description).toContain("functors");
    expect(result.description).toContain("natural transformations");
    expect(result.description).toContain("algebraic topology");
  });

  it("uses a demo fallback when draft times out and repair returns an invalid accepted payload", async () => {
    const callModel = vi.fn(async ({ mode }) => {
      if (mode === "draft") {
        throw new ApiError(
          "UPSTREAM_TIMEOUT",
          "canonicalize draft timed out after 8000ms.",
          504,
        );
      }

      return {
        subject: "history",
        topic: "trigonometry",
        scope_summary:
          "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
        core_concepts: [
          "sine",
          "cosine",
          "tangent",
          "trigonometric identities",
        ],
        prerequisites: ["algebra"],
        downstream_topics: ["calculus", "statistics", "physics"],
        level: "intermediate",
      } as never;
    });

    const result = await canonicalizePrompt(
      "I want to learn trigonometry",
      undefined,
      { callModel },
      { mode: "demo" },
    );

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.topic).toBe("trigonometry");
    expect(result.subject).toBe("general");
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("keeps canonicalize strict when draft times out and repair stays invalid", async () => {
    const callModel = vi.fn(async ({ mode }) => {
      if (mode === "draft") {
        throw new ApiError(
          "UPSTREAM_TIMEOUT",
          "canonicalize draft timed out after 8000ms.",
          504,
        );
      }

      return {
        subject: "history",
        topic: "trigonometry",
        scope_summary:
          "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
        core_concepts: [
          "sine",
          "cosine",
          "tangent",
          "trigonometric identities",
        ],
        prerequisites: ["algebra"],
        downstream_topics: ["calculus", "statistics", "physics"],
        level: "intermediate",
      } as never;
    });

    await expect(
      canonicalizePrompt("I want to learn trigonometry", undefined, { callModel }),
    ).rejects.toMatchObject({
      code: "CANONICALIZE_FAILED",
    });
  });
});
