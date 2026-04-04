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
  graphSchema,
  graphPayloadSchema,
  nodeSchema,
  progressAttemptSchema,
  progressWriteRequestSchema,
  retrievalCandidateSchema,
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

  it("accepts database timestamps with explicit UTC offsets", () => {
    const offsetTimestamp = "2026-04-01T12:00:00+00:00";
    const postgresTimestamp = "2025-06-23 16:42:07.869646+00";
    const postgresCompactOffsetTimestamp = "2025-06-23 16:42:07.869646+0000";
    const naiveDbTimestamp = "2026-04-03T18:49:09";

    expect(
      graphSchema.parse({
        ...baseGraphFixture,
        created_at: offsetTimestamp,
      }).created_at,
    ).toBe(offsetTimestamp);

    expect(
      retrievalCandidateSchema.parse({
        id: baseGraphFixture.id,
        similarity: 0.95,
        flagged_for_review: false,
        version: 1,
        created_at: offsetTimestamp,
      }).created_at,
    ).toBe(offsetTimestamp);

    expect(
      progressAttemptSchema.parse({
        score: 2,
        timestamp: offsetTimestamp,
      }).timestamp,
    ).toBe(offsetTimestamp);

    expect(
      userProgressSchema.parse({
        ...baseProgressFixture[0],
        attempts: [
          {
            score: 2,
            timestamp: offsetTimestamp,
          },
        ],
      }).attempts[0].timestamp,
    ).toBe(offsetTimestamp);

    expect(
      graphSchema.parse({
        ...baseGraphFixture,
        created_at: postgresTimestamp,
      }).created_at,
    ).toBe("2025-06-23T16:42:07.869646+00:00");

    expect(
      graphSchema.parse({
        ...baseGraphFixture,
        created_at: postgresCompactOffsetTimestamp,
      }).created_at,
    ).toBe("2025-06-23T16:42:07.869646+00:00");

    expect(
      retrievalCandidateSchema.parse({
        id: baseGraphFixture.id,
        similarity: 0.95,
        flagged_for_review: false,
        version: 1,
        created_at: naiveDbTimestamp,
      }).created_at,
    ).toBe("2026-04-03T18:49:09Z");
  });

  it("keeps public request timestamps strict ISO with offsets", () => {
    expect(
      retrieveRequestSchema.safeParse({
        subject: "mathematics",
        description: canonicalizeSuccessFixture.description,
      }).success,
    ).toBe(true);

    expect(
      progressWriteRequestSchema.safeParse({
        graph_id: baseGraphFixture.id,
        node_id: baseNodesFixture[0]?.id,
        score: 2,
        timestamp: "2026-04-03T18:49:09",
      }).success,
    ).toBe(false);
  });
});
