import { describe, expect, it } from "vitest";

import {
  canonicalizeFailureSchema,
  canonicalizeInventoryEntrySchema,
  canonicalizeModelResultSchema,
  canonicalizeModelSuccessDraftSchema,
  canonicalizeRequestSchema,
  canonicalizeResolvedSuccessSchema,
  canonicalizeResultSchema,
  canonicalizeSuccessSchema,
  edgeSchema,
  graphRouteRequestSchema,
  graphRouteResponseSchema,
  graphPayloadSchema,
  nodeSchema,
  supportedSubjectSchema,
  retrieveRequestSchema,
  retrieveResponseSchema,
  userProgressSchema,
  validateCanonicalDescription,
} from "@/lib/schemas";

import {
  baseEdgesFixture,
  baseGraphFixture,
  baseGraphPayloadFixture,
  baseNodesFixture,
  baseProgressFixture,
  canonicalizeModelDraftFixture,
  canonicalizeResolvedFixture,
  canonicalizeSuccessFixture,
} from "../harness/fixtures";
import { DAY2_GRAPH_DRAFT } from "../harness/day2-generation";

describe("schema validation", () => {
  it("accepts the canonicalize success and failure contracts", () => {
    expect(validateCanonicalDescription(canonicalizeSuccessFixture.description)).toBe(true);
    expect(() => canonicalizeSuccessSchema.parse(canonicalizeSuccessFixture)).not.toThrow();
    expect(() =>
      canonicalizeModelSuccessDraftSchema.parse(canonicalizeModelDraftFixture),
    ).not.toThrow();
    expect(() =>
      canonicalizeInventoryEntrySchema.parse({
        ...canonicalizeModelDraftFixture,
        topic: "algebra",
        aliases: ["algebra"],
        broad_prompt_aliases: ["math"],
        starter_for_subject: "mathematics",
      }),
    ).not.toThrow();
    expect(() =>
      canonicalizeResolvedSuccessSchema.parse(canonicalizeResolvedFixture),
    ).not.toThrow();
    expect(() =>
      canonicalizeFailureSchema.parse({ error: "NOT_A_LEARNING_REQUEST" }),
    ).not.toThrow();
    expect(() => canonicalizeResultSchema.parse(canonicalizeSuccessFixture)).not.toThrow();
    expect(() =>
      canonicalizeModelResultSchema.parse(canonicalizeModelDraftFixture),
    ).not.toThrow();
    expect(() =>
      canonicalizeResultSchema.parse({ error: "NOT_A_LEARNING_REQUEST" }),
    ).not.toThrow();
  });

  it("rejects malformed canonicalize and request payloads", () => {
    expect(canonicalizeRequestSchema.safeParse({ prompt: "" }).success).toBe(false);
    expect(
      canonicalizeSuccessSchema.safeParse({
        ...canonicalizeSuccessFixture,
        topic: "Bad Topic",
      }).success,
    ).toBe(false);
  });

  it("accepts public canonical descriptions containing acronym punctuation like U.S.", () => {
    expect(
      canonicalizeSuccessSchema.safeParse({
        subject: "philosophy",
        topic: "u_s_constitutional_structure",
        description:
          "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
      }).success,
    ).toBe(true);
  });

  it("accepts the full supported subject list including financial literacy", () => {
    expect(supportedSubjectSchema.parse("financial_literacy")).toBe("financial_literacy");
  });

  it("accepts the graph, node, edge, progress, and payload shapes", () => {
    expect(() => graphPayloadSchema.parse(baseGraphPayloadFixture)).not.toThrow();
    expect(() => nodeSchema.parse(baseNodesFixture[0])).not.toThrow();
    expect(() => edgeSchema.parse(baseEdgesFixture[0])).not.toThrow();
    expect(() =>
      graphRouteRequestSchema.parse({
        subject: "mathematics",
        topic: "trigonometry",
        description: canonicalizeSuccessFixture.description,
      }),
    ).not.toThrow();
    expect(() =>
      graphRouteResponseSchema.parse(DAY2_GRAPH_DRAFT),
    ).not.toThrow();
    expect(() => userProgressSchema.parse(baseProgressFixture[0])).not.toThrow();
    expect(() => retrieveRequestSchema.parse({
      subject: "mathematics",
      description: canonicalizeSuccessFixture.description,
    })).not.toThrow();
    expect(() => retrieveResponseSchema.parse({ graph_id: baseGraphFixture.id })).not.toThrow();
  });
});
