import type { AppendedPrerequisiteNode } from "@/lib/prerequisite-lessons";
import { normalizeLessonNodeIdValue } from "@/lib/lesson-route-node-id";
import {
  buildAppendedPrerequisiteNodes,
} from "@/lib/prerequisite-lessons";
import type { Node } from "@/lib/types";
import type { StoredGraphDiagnosticResult } from "@/lib/diagnostic-session";
import type { GraphReadDependencies } from "@/lib/server/graph-read";
import { loadGraphPayload } from "@/lib/server/graph-read";
import { getGenerateRequestRecordByGraphId } from "@/lib/server/generation/request-store";

export type ResolvedLessonNode = Node | AppendedPrerequisiteNode;

export type LessonResolutionResult = {
  ready: boolean;
  source: "graph" | "prerequisite";
  node: ResolvedLessonNode | null;
  graphDiagnosticResult: StoredGraphDiagnosticResult | null;
};

function hasRenderableLessonText(node: {
  lesson_text?: string | null;
  lesson_status?: "pending" | "ready" | "failed";
}): boolean {
  return (
    node.lesson_status === "ready" &&
    typeof node.lesson_text === "string" &&
    node.lesson_text.trim().length > 0
  );
}

export async function resolveLessonNode(
  input: {
    graphId: string;
    nodeId: string;
    userId: string;
  },
  dependencies: GraphReadDependencies = {},
): Promise<LessonResolutionResult> {
  const normalizedNodeId = normalizeLessonNodeIdValue(input.nodeId);
  const payload = await loadGraphPayload(input.graphId, input.userId, dependencies);
  const graphNode = payload.nodes.find((node) => node.id === normalizedNodeId) ?? null;

  if (graphNode) {
    return {
      ready: hasRenderableLessonText(graphNode),
      source: "graph",
      node: graphNode,
      graphDiagnosticResult: null,
    };
  }

  const record = getGenerateRequestRecordByGraphId(input.graphId);
  const graphDiagnosticResult = record?.graph_diagnostic_result ?? null;

  if (!graphDiagnosticResult) {
    return {
      ready: false,
      source: "prerequisite",
      node: null,
      graphDiagnosticResult: null,
    };
  }

  const firstGraphPosition =
    payload.nodes
      .slice()
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0]
      ?.position ?? 0;
  const prerequisiteNode =
    buildAppendedPrerequisiteNodes(graphDiagnosticResult, firstGraphPosition).find(
      (node) => node.id === normalizedNodeId,
    ) ?? null;

  return {
    ready:
      prerequisiteNode !== null &&
      typeof prerequisiteNode.lesson_text === "string" &&
      prerequisiteNode.lesson_text.trim().length > 0,
    source: "prerequisite",
    node: prerequisiteNode,
    graphDiagnosticResult,
  };
}
