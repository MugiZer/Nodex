import { describe, expect, it } from "vitest";

import {
  CALCULUS_FOUNDATIONS_SMOKE_BUNDLE,
  CALCULUS_FOUNDATIONS_STORE_REQUEST,
} from "@/app/dev-smoke-fixture";
import { buildStoreRouteRequest } from "@/lib/server/generation/stage-inputs";
import { storeRouteRequestSchema } from "@/lib/server/generation/contracts";

function getNodeIds(items: ReadonlyArray<{ id: string }>): string[] {
  return items.map((item) => item.id);
}

describe("calculus foundations smoke fixture", () => {
  it("keeps the raw replay bundle aligned with the graph draft", () => {
    const { graphDraft, lessonArtifacts, diagnosticArtifacts, visualArtifacts } =
      CALCULUS_FOUNDATIONS_SMOKE_BUNDLE;
    const nodeIds = getNodeIds(graphDraft.nodes);

    expect(nodeIds).toHaveLength(10);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(getNodeIds(lessonArtifacts)).toEqual(nodeIds);
    expect(getNodeIds(diagnosticArtifacts)).toEqual(nodeIds);
    expect(getNodeIds(visualArtifacts)).toEqual(nodeIds);

    for (const lesson of lessonArtifacts) {
      expect(lesson.quiz_json).toHaveLength(3);
      for (const quizItem of lesson.quiz_json) {
        expect(quizItem.options).toHaveLength(4);
      }
    }

    for (const diagnostic of diagnosticArtifacts) {
      expect(diagnostic.diagnostic_questions).toHaveLength(1);
      expect(diagnostic.diagnostic_questions[0]?.node_id).toBe(diagnostic.id);
    }
  });

  it("preserves ordering and per-node coverage across the replay artifact families", () => {
    const { graphDraft, lessonArtifacts, diagnosticArtifacts, visualArtifacts } =
      CALCULUS_FOUNDATIONS_SMOKE_BUNDLE;
    const nodeIds = getNodeIds(graphDraft.nodes);

    expect(getNodeIds(lessonArtifacts)).toEqual(nodeIds);
    expect(getNodeIds(diagnosticArtifacts)).toEqual(nodeIds);
    expect(getNodeIds(visualArtifacts)).toEqual(nodeIds);

    expect(graphDraft.edges).toHaveLength(9);
    expect(graphDraft.edges[0]).toEqual({
      from_node_id: "node_1",
      to_node_id: "node_2",
      type: "hard",
    });
    expect(graphDraft.edges[8]).toEqual({
      from_node_id: "node_9",
      to_node_id: "node_10",
      type: "hard",
    });
  });

  it("validates and matches the exact store-route request fixture", () => {
    const expectedRequest = buildStoreRouteRequest({
      graph: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.graph,
      graphDraft: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.graphDraft,
      lessonArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.lessonArtifacts,
      diagnosticArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.diagnosticArtifacts,
      visualArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.visualArtifacts,
    });

    expect(() => storeRouteRequestSchema.parse(expectedRequest)).not.toThrow();
    expect(CALCULUS_FOUNDATIONS_STORE_REQUEST).toEqual(expectedRequest);
    expect(() => storeRouteRequestSchema.parse(CALCULUS_FOUNDATIONS_STORE_REQUEST)).not.toThrow();
  });
});
