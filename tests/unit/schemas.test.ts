import { describe, expect, it } from "vitest";

import {
  canonicalizeFailureSchema,
  canonicalizeRequestSchema,
  canonicalizeResultSchema,
  canonicalizeSuccessSchema,
  edgeSchema,
  graphPayloadSchema,
  nodeSchema,
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
  canonicalizeSuccessFixture,
} from "../harness/fixtures";

describe("schema validation", () => {
  it("accepts the canonicalize success and failure contracts", () => {
    expect(validateCanonicalDescription(canonicalizeSuccessFixture.description)).toBe(true);
    expect(() => canonicalizeSuccessSchema.parse(canonicalizeSuccessFixture)).not.toThrow();
    expect(() =>
      canonicalizeFailureSchema.parse({ error: "NOT_A_LEARNING_REQUEST" }),
    ).not.toThrow();
    expect(() => canonicalizeResultSchema.parse(canonicalizeSuccessFixture)).not.toThrow();
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

  it("accepts the graph, node, edge, progress, and payload shapes", () => {
    expect(() => graphPayloadSchema.parse(baseGraphPayloadFixture)).not.toThrow();
    expect(() => nodeSchema.parse(baseNodesFixture[0])).not.toThrow();
    expect(() => edgeSchema.parse(baseEdgesFixture[0])).not.toThrow();
    expect(() => userProgressSchema.parse(baseProgressFixture[0])).not.toThrow();
    expect(() => retrieveRequestSchema.parse({
      subject: "mathematics",
      description: canonicalizeSuccessFixture.description,
    })).not.toThrow();
    expect(() => retrieveResponseSchema.parse({ graph_id: baseGraphFixture.id })).not.toThrow();
  });
});
