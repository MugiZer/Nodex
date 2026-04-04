import type { PrerequisiteDiagnosticGroup } from "@/lib/types";
import type { Edge, Node } from "@/lib/types";

import type {
  StoredGraphDiagnosticResult,
  StoredPrerequisiteLesson,
} from "@/lib/diagnostic-session";

export type AppendedPrerequisiteNode = {
  id: string;
  title: string;
  position: number;
  lesson_text: string;
  isPrerequisite: true;
};

export type PrerequisiteGraphNode = AppendedPrerequisiteNode | Node;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function humanizeTopic(topic: string): string {
  return topic.replaceAll("_", " ");
}

export function getPrerequisiteNodeId(
  prerequisiteName: string,
  index: number,
): string {
  return `gap:${index}:${slugify(prerequisiteName)}`;
}

function buildQuestionLessonBlock(
  prerequisite: PrerequisiteDiagnosticGroup,
  topic: string,
): string {
  return prerequisite.questions
    .map((question, index) => {
      const correctAnswer = question.options[question.correctIndex] ?? "";

      return [
        `Check ${index + 1}: ${question.question}`,
        `Correct idea: ${correctAnswer}`,
        question.explanation,
        `This matters in ${humanizeTopic(topic)} because shaky intuition here creates errors later in the path.`,
      ].join("\n\n");
    })
    .join("\n\n");
}

export function buildPrerequisiteLessonText(
  prerequisite: PrerequisiteDiagnosticGroup,
  topic: string,
): string {
  return [
    `${prerequisite.name} is part of the foundation for ${humanizeTopic(topic)}.`,
    `Use this review to lock in the move you need before advancing. Focus on how the idea works in a concrete situation, not just on memorizing a definition.`,
    buildQuestionLessonBlock(prerequisite, topic),
    `Master this prerequisite, then continue into ${humanizeTopic(topic)} with cleaner intuition and fewer avoidable mistakes.`,
  ].join("\n\n");
}

export function buildAppendedPrerequisiteNodes(
  result: StoredGraphDiagnosticResult | null,
  firstGraphPosition: number,
): AppendedPrerequisiteNode[] {
  const gapPrerequisites = result?.gapPrerequisites ?? [];

  if (gapPrerequisites.length === 0) {
    return [];
  }

  const startingPosition = firstGraphPosition - gapPrerequisites.length;
  const lessonByName = new Map<string, StoredPrerequisiteLesson>(
    (result?.gapPrerequisiteLessons ?? []).map((entry) => [entry.name, entry]),
  );

  return gapPrerequisites.map((prerequisite, index) => ({
    id: getPrerequisiteNodeId(prerequisite.name, index),
    title: prerequisite.name,
    position: startingPosition + index,
    lesson_text: lessonByName.get(prerequisite.name)?.lesson
      ? JSON.stringify(lessonByName.get(prerequisite.name)?.lesson)
      : buildPrerequisiteLessonText(prerequisite, result?.topic ?? ""),
    isPrerequisite: true,
  }));
}

export function buildPrerequisiteGraphEdges(input: {
  prerequisiteNodes: AppendedPrerequisiteNode[];
  graphNodes: Node[];
  graphEdges: Edge[];
}): Edge[] {
  if (input.prerequisiteNodes.length === 0) {
    return input.graphEdges;
  }

  const rootGraphNodeIds = input.graphNodes
    .filter(
      (node) =>
        !input.graphEdges.some(
          (edge) => edge.type === "hard" && edge.to_node_id === node.id,
        ),
    )
    .map((node) => node.id);

  return [
    ...input.prerequisiteNodes.slice(0, -1).map((node, index) => ({
      from_node_id: node.id,
      to_node_id: input.prerequisiteNodes[index + 1]!.id,
      type: "hard" as const,
    })),
    ...rootGraphNodeIds.map((rootNodeId) => ({
      from_node_id: input.prerequisiteNodes[input.prerequisiteNodes.length - 1]!.id,
      to_node_id: rootNodeId,
      type: "hard" as const,
    })),
    ...input.graphEdges,
  ];
}

export function computePrerequisiteAvailability(input: {
  nodes: PrerequisiteGraphNode[];
  edges: Edge[];
  completedNodeIds: Set<string>;
}): Set<string> {
  return new Set(
    input.nodes
      .filter((node) => {
        if (input.completedNodeIds.has(node.id)) {
          return true;
        }

        const incomingHardEdges = input.edges.filter(
          (edge) => edge.type === "hard" && edge.to_node_id === node.id,
        );

        return incomingHardEdges.every((edge) => input.completedNodeIds.has(edge.from_node_id));
      })
      .map((node) => node.id),
  );
}

export function resolveActiveFlagshipNodeId(input: {
  prerequisiteNodes: AppendedPrerequisiteNode[];
  completedNodeIds: Set<string>;
  persistedFlagshipNodeId: string | null;
}): string | null {
  const nextPrerequisiteNode = input.prerequisiteNodes.find(
    (node) => !input.completedNodeIds.has(node.id),
  );

  return nextPrerequisiteNode?.id ?? input.persistedFlagshipNodeId;
}
