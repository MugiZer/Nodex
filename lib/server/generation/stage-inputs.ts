import type {
  DiagnosticsRouteRequest,
  LessonStageOutput,
  LessonEnrichedNode,
  StoreRouteRequest,
  VisualsRouteRequest,
} from "./contracts";
import type { GenerationEdgeDraft, GenerationNodeDraft } from "@/lib/types";

type LessonArtifactInput = LessonStageOutput["nodes"][number];
type DiagnosticArtifactInput = {
  id: string;
  diagnostic_questions: NonNullable<
    StoreRouteRequest["nodes"][number]["diagnostic_questions"]
  >;
};
type VisualArtifactInput = {
  id: string;
  p5_code: string;
  visual_verified: boolean;
};

export function buildLessonEnrichedNodes(
  graphNodes: readonly GenerationNodeDraft[],
  lessonArtifacts: readonly LessonArtifactInput[],
): LessonEnrichedNode[] {
  const lessonById = new Map<string, LessonArtifactInput>();

  for (const lesson of lessonArtifacts) {
    if (lessonById.has(lesson.id)) {
      throw new Error(`Duplicate lesson artifact detected for node ${lesson.id}.`);
    }

    lessonById.set(lesson.id, lesson);
  }

  const enrichedNodes = graphNodes.map((node) => {
    const lesson = lessonById.get(node.id);
    if (!lesson) {
      throw new Error(`Missing lesson artifact for node ${node.id}.`);
    }

    lessonById.delete(node.id);

    return {
      ...node,
      lesson_text: lesson.lesson_text,
      static_diagram: lesson.static_diagram,
      quiz_json: lesson.quiz_json,
    };
  });

  if (lessonById.size > 0) {
    throw new Error(
      `Lesson artifacts contained unexpected node ids: ${Array.from(lessonById.keys()).join(", ")}.`,
    );
  }

  return enrichedNodes;
}

export function buildDiagnosticsRouteRequest(input: {
  subject: DiagnosticsRouteRequest["subject"];
  topic: DiagnosticsRouteRequest["topic"];
  description: DiagnosticsRouteRequest["description"];
  graph: {
    nodes: readonly GenerationNodeDraft[];
    edges: readonly GenerationEdgeDraft[];
  };
  lessonArtifacts: readonly LessonArtifactInput[];
}): DiagnosticsRouteRequest {
  return {
    subject: input.subject,
    topic: input.topic,
    description: input.description,
    nodes: buildLessonEnrichedNodes(input.graph.nodes, input.lessonArtifacts),
    edges: [...input.graph.edges],
  };
}

export function buildVisualsRouteRequest(input: {
  subject: VisualsRouteRequest["subject"];
  topic: VisualsRouteRequest["topic"];
  description: VisualsRouteRequest["description"];
  graph: {
    nodes: readonly GenerationNodeDraft[];
  };
}): VisualsRouteRequest {
  return {
    subject: input.subject,
    topic: input.topic,
    description: input.description,
    nodes: [...input.graph.nodes],
  };
}

export function buildStoreRouteRequest(input: {
  graph: StoreRouteRequest["graph"];
  graphDraft: {
    nodes: readonly GenerationNodeDraft[];
    edges: readonly GenerationEdgeDraft[];
  };
  lessonArtifacts: readonly LessonArtifactInput[];
  diagnosticArtifacts: readonly DiagnosticArtifactInput[];
  visualArtifacts: readonly VisualArtifactInput[];
}): StoreRouteRequest {
  const lessonById = new Map(input.lessonArtifacts.map((node) => [node.id, node]));
  const diagnosticById = new Map(
    input.diagnosticArtifacts.map((node) => [node.id, node]),
  );
  const visualById = new Map(input.visualArtifacts.map((node) => [node.id, node]));

  return {
    graph: input.graph,
    nodes: input.graphDraft.nodes.map((node) => {
      const lesson = lessonById.get(node.id);
      if (!lesson) {
        throw new Error(`Missing lesson artifact for node ${node.id}.`);
      }

      const diagnostic = diagnosticById.get(node.id);
      if (!diagnostic) {
        throw new Error(`Missing diagnostic artifact for node ${node.id}.`);
      }

      const visual = visualById.get(node.id);
      if (!visual) {
        throw new Error(`Missing visual artifact for node ${node.id}.`);
      }

      return {
        id: node.id,
        title: node.title,
        position: node.position,
        lesson_text: lesson.lesson_text,
        static_diagram: lesson.static_diagram,
        p5_code: visual.p5_code,
        visual_verified: visual.visual_verified,
        quiz_json: lesson.quiz_json,
        diagnostic_questions: diagnostic.diagnostic_questions,
        lesson_status: "ready" as const,
      };
    }),
    edges: [...input.graphDraft.edges],
  };
}
