import { describe, expect, it } from "vitest";

import { graphPayloadSchema, canonicalizeResultSchema } from "@/lib/schemas";

import {
  canonicalizeLearningPrompt,
  canonicalizeRejectionPrompt,
  mockCanonicalizeRoute,
  mockGraphReadRoute,
  mockProgressWriteRoute,
  mockRetrieveRoute,
} from "../harness/services";
import { NODE_1_ID, NODE_2_ID, NODE_3_ID } from "../harness/fixtures";

describe("fixture-backed route contracts", () => {
  it("canonicalizes a learning prompt and rejects non-learning prompts", () => {
    const success = mockCanonicalizeRoute(canonicalizeLearningPrompt);
    const failure = mockCanonicalizeRoute(canonicalizeRejectionPrompt);

    expect(canonicalizeResultSchema.parse(success)).toEqual(success);
    expect(canonicalizeResultSchema.parse(failure)).toEqual(failure);
    expect("subject" in success).toBe(true);
    expect(failure).toEqual({ error: "NOT_A_LEARNING_REQUEST" });
  });

  it("returns a cached graph id for usable retrieval hits and null for misses", () => {
    const hit = mockRetrieveRoute({
      subject: "mathematics",
      description:
        "Trigonometry is the study of relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
    });

    const miss = mockRetrieveRoute({
      subject: "physics",
      description:
        "Mechanics is the study of motion and forces. It encompasses kinematics, dynamics, work, energy, momentum, and rotational motion. It assumes prior knowledge of algebra and geometry and serves as a foundation for thermodynamics and relativity. Within physics, it is typically encountered at the introductory level.",
    });

    expect(hit.graph_id).toBe("77777777-7777-4777-8777-777777777777");
    expect(miss.graph_id).toBeNull();
  });

  it("returns a validated graph payload and applies pass/fail progress writes", () => {
    const graphPayload = mockGraphReadRoute();
    expect(() => graphPayloadSchema.parse(graphPayload)).not.toThrow();

    const passResult = mockProgressWriteRoute(graphPayload, {
      graph_id: graphPayload.graph.id,
      node_id: NODE_2_ID,
      score: 2,
      timestamp: "2026-04-01T12:20:00.000Z",
    });

    expect(passResult.response.progress.completed).toBe(true);
    expect(passResult.response.available_node_ids).toContain(NODE_3_ID);
    expect(passResult.graphPayload.nodes.find((node) => node.id === NODE_2_ID)?.attempt_count).toBe(1);
    expect(passResult.graphPayload.nodes.find((node) => node.id === NODE_2_ID)?.pass_count).toBe(1);

    const failResult = mockProgressWriteRoute(passResult.graphPayload, {
      graph_id: graphPayload.graph.id,
      node_id: NODE_2_ID,
      score: 1,
      timestamp: "2026-04-01T12:21:00.000Z",
    });

    expect(failResult.response.progress.completed).toBe(true);
    expect(failResult.graphPayload.nodes.find((node) => node.id === NODE_2_ID)?.attempt_count).toBe(2);
    expect(failResult.graphPayload.nodes.find((node) => node.id === NODE_2_ID)?.pass_count).toBe(1);
    expect(failResult.response.available_node_ids).toContain(NODE_3_ID);
    expect(failResult.graphPayload.progress.find((entry) => entry.node_id === NODE_2_ID)?.attempts).toHaveLength(2);
  });

  it("adds a new progress row for a node without existing learner history", () => {
    const graphPayload = mockGraphReadRoute();
    const result = mockProgressWriteRoute(graphPayload, {
      graph_id: graphPayload.graph.id,
      node_id: NODE_1_ID,
      score: 3,
      timestamp: "2026-04-01T12:30:00.000Z",
    });

    expect(result.response.progress.node_id).toBe(NODE_1_ID);
    expect(result.response.progress.completed).toBe(true);
  });
});
