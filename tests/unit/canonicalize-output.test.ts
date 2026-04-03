import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/errors";
import {
  normalizeTopicSlug,
  renderCanonicalDescription,
  resolveCanonicalizeDraft,
} from "@/lib/server/canonicalize-output";
import { canonicalizeModelDraftFixture } from "../harness/fixtures";

function sortForComparison(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe("canonicalize output normalization", () => {
  it("normalizes topics into lowercase underscore slugs", () => {
    expect(normalizeTopicSlug("Linear Algebra")).toBe("linear_algebra");
    expect(normalizeTopicSlug("Data-Science Foundations")).toBe(
      "data_science_foundations",
    );
  });

  it("renders stable descriptions for semantically equivalent drafts", () => {
    const left = resolveCanonicalizeDraft({
      ...canonicalizeModelDraftFixture,
      topic: "Trigonometry",
      core_concepts: [
        "sine",
        "cosine",
        "tangent",
        "trigonometric identities",
        "laws of sines and cosines",
        "radian measure",
        "unit-circle reasoning",
      ],
      prerequisites: ["Euclidean geometry.", " algebra "],
      downstream_topics: ["physics", "calculus", "statistics"],
    });

    const right = resolveCanonicalizeDraft({
      ...canonicalizeModelDraftFixture,
      topic: "trigonometry",
      core_concepts: [
        " tangent ",
        "cosine.",
        "sine",
        "trigonometric identities",
        "radian measure",
        "laws of sines and cosines",
        "unit-circle reasoning",
        "sine",
      ],
      prerequisites: ["algebra", "Euclidean geometry"],
      downstream_topics: ["calculus.", " physics ", "statistics "],
    });

    expect(left.subject).toBe(right.subject);
    expect(left.topic).toBe(right.topic);
    expect(left.scope_summary).toBe(right.scope_summary);
    expect(sortForComparison(left.core_concepts)).toEqual(
      sortForComparison(right.core_concepts),
    );
    expect(sortForComparison(left.prerequisites)).toEqual(
      sortForComparison(right.prerequisites),
    );
    expect(sortForComparison(left.downstream_topics)).toEqual(
      sortForComparison(right.downstream_topics),
    );
    expect(renderCanonicalDescription(left)).toBe(left.description);
    expect(left.core_concepts).toEqual([
      "sine",
      "cosine",
      "tangent",
      "trigonometric identities",
      "laws of sines and cosines",
      "radian measure",
      "unit-circle reasoning",
    ]);
    expect(left.canonicalization_source).toBe("model_only");
    expect(left.inventory_candidate_topics).toEqual([]);
    expect(left.candidate_confidence_band).toBe("none");
  });

  it("preserves rich conceptual detail in the rendered description", () => {
    const resolved = resolveCanonicalizeDraft({
      ...canonicalizeModelDraftFixture,
      topic: "trigonometry",
      scope_summary:
        "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
      core_concepts: [
        "sine",
        "cosine",
        "tangent",
        "trigonometric identities",
        "laws of sines and cosines",
        "radian measure",
        "unit-circle reasoning",
      ],
      prerequisites: ["algebra", "Euclidean geometry"],
      downstream_topics: ["calculus", "physics", "statistics"],
    });

    expect(resolved.description).toContain(
      "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
    );
    expect(resolved.description).toContain("trigonometric identities");
    expect(resolved.description).toContain("laws of sines and cosines");
    expect(resolved.description).toContain("algebra");
    expect(resolved.description).toContain("calculus");
    expect(resolved.description).toContain("physics");
  });

  it("rejects underspecified drafts after normalization", () => {
    expect(() =>
      resolveCanonicalizeDraft({
        ...canonicalizeModelDraftFixture,
        core_concepts: ["sine", "cosine", "sine"],
      }),
    ).toThrow(ApiError);
  });

  it("does not rewrite broad topics during local normalization", () => {
    const resolved = resolveCanonicalizeDraft({
      ...canonicalizeModelDraftFixture,
      topic: "Calculus",
    });

    expect(resolved.topic).toBe("calculus");
  });

  it("rejects scope summaries that are too short", () => {
    expect(() =>
      resolveCanonicalizeDraft({
        ...canonicalizeModelDraftFixture,
        scope_summary: "triangle math",
      }),
    ).toThrow(ApiError);
  });

  it("renders and validates acronym-heavy topics without breaking the four-sentence contract", () => {
    const resolved = resolveCanonicalizeDraft({
      subject: "philosophy",
      topic: "u_s_constitutional_structure",
      scope_summary:
        "the organization, articles, amendments, and foundational principles of the U.S. Constitution",
      core_concepts: [
        "Preamble and founding principles",
        "Articles of the Constitution",
        "Separation of powers",
        "Federalism and state vs federal authority",
        "The Bill of Rights",
        "Constitutional amendments process",
        "Checks and balances",
        "Judicial review",
      ],
      prerequisites: [
        "Basic U.S. history",
        "Concept of government and law",
        "Understanding of democratic principles",
      ],
      downstream_topics: [
        "Constitutional law",
        "Civil liberties and civil rights",
        "Federal legislative process",
        "Judicial system and Supreme Court",
        "Political philosophy",
        "Comparative constitutional systems",
        "Administrative law",
      ],
      level: "introductory",
    });

    expect(resolved.topic).toBe("u_s_constitutional_structure");
    expect(resolved.description).toContain(
      "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution.",
    );
    expect(resolved.description).toContain(
      "Within philosophy, it is typically encountered at the introductory level.",
    );
  });
});
