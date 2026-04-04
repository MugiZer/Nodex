import { describe, expect, it } from "vitest";

import {
  buildDiagnosticsRouteRequest,
  buildLessonEnrichedNodes,
  buildStoreRouteRequest,
  buildVisualsRouteRequest,
} from "@/lib/server/generation/stage-inputs";

import { DAY2_GRAPH_DRAFT, DAY2_LESSON_NODES } from "../harness/day2-generation";

const canonicalContext = {
  subject: "mathematics" as const,
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
};

describe("stage input helpers", () => {
  it("builds lesson-enriched nodes from graph nodes and lesson artifacts", () => {
    const lessonArtifacts = DAY2_LESSON_NODES.map(
      ({ lesson_status, ...lessonArtifact }) => lessonArtifact,
    );

    const nodes = buildLessonEnrichedNodes(DAY2_GRAPH_DRAFT.nodes, lessonArtifacts);

    expect(nodes).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(nodes[0]).toMatchObject({
      id: "node_1",
      title: "Angle Measurement",
      position: 0,
      lesson_text: DAY2_LESSON_NODES[0]!.lesson_text,
      static_diagram: DAY2_LESSON_NODES[0]!.static_diagram,
      quiz_json: DAY2_LESSON_NODES[0]!.quiz_json,
    });
  });

  it("builds diagnostics requests from real lesson output and the original graph draft", () => {
    const request = buildDiagnosticsRouteRequest({
      ...canonicalContext,
      graph: DAY2_GRAPH_DRAFT,
      lessonArtifacts: DAY2_LESSON_NODES,
    });

    expect(request).toMatchObject({
      ...canonicalContext,
      edges: DAY2_GRAPH_DRAFT.edges,
    });
    expect(request.nodes).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(request.nodes[0]).toMatchObject({
      id: "node_1",
      title: "Angle Measurement",
      position: 0,
    });
    expect(request.nodes[0]).not.toHaveProperty("lesson_status");
  });

  it("builds visuals requests from the original graph draft only", () => {
    const request = buildVisualsRouteRequest({
      ...canonicalContext,
      graph: DAY2_GRAPH_DRAFT,
    });

    expect(request).toMatchObject(canonicalContext);
    expect(request.nodes).toEqual(DAY2_GRAPH_DRAFT.nodes);
  });

  it("builds store requests from persisted artifacts and the original graph draft", () => {
    const diagnosticsArtifacts: Array<{
      id: string;
      diagnostic_questions: Array<{
        question: string;
        options: [string, string, string, string];
        correct_index: number;
        difficulty_order: number;
        node_id: string;
      }>;
    }> = DAY2_LESSON_NODES.map((node, index) => ({
      id: node.id,
      diagnostic_questions: [
        {
          question: `Which idea best matches ${node.title}?`,
          options: [
            `${node.title} definition`,
            "A downstream application",
            "An unrelated topic",
            "A memorized formula only",
          ],
          correct_index: 0,
          difficulty_order: index + 1,
          node_id: node.id,
        },
      ],
    }));

    const visualArtifacts = DAY2_LESSON_NODES.map((node) => ({
      id: node.id,
      p5_code: `function setup() { createCanvas(480, 320); } function draw() { background(255); }`,
      visual_verified: true,
    }));

    const request = buildStoreRouteRequest({
      graph: {
        title: "Trigonometry",
        subject: "mathematics",
        topic: "trigonometry",
        description: canonicalContext.description,
      },
      graphDraft: DAY2_GRAPH_DRAFT,
      lessonArtifacts: DAY2_LESSON_NODES,
      diagnosticArtifacts: diagnosticsArtifacts,
      visualArtifacts,
    });

    expect(request.graph).toMatchObject({
      title: "Trigonometry",
      subject: "mathematics",
      topic: "trigonometry",
    });
    expect(request.nodes).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(request.nodes[0]).toMatchObject({
      id: "node_1",
      title: "Angle Measurement",
      lesson_text: DAY2_LESSON_NODES[0]!.lesson_text,
      static_diagram: DAY2_LESSON_NODES[0]!.static_diagram,
      diagnostic_questions: diagnosticsArtifacts[0]!.diagnostic_questions,
      visual_verified: true,
    });
    expect(request.nodes[0]).toHaveProperty("lesson_status", "ready");
  });

  it("rejects incomplete lesson coverage instead of silently drifting", () => {
    expect(() =>
      buildLessonEnrichedNodes(DAY2_GRAPH_DRAFT.nodes, DAY2_LESSON_NODES.slice(0, 9)),
    ).toThrow("Missing lesson artifact for node node_10.");
  });
});
