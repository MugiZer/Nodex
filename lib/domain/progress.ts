import type {
  DiagnosticAnswer,
  DiagnosticRunResult,
  Edge,
  GraphPayload,
  Node,
  UserProgress,
} from "@/lib/types";

export function isQuizPass(score: number, totalQuestions = 3): boolean {
  return score >= Math.ceil((totalQuestions * 2) / 3);
}

export function computeAvailableNodeIds(
  nodes: Node[],
  edges: Edge[],
  progress: UserProgress[],
): string[] {
  const completedNodeIds = new Set(
    progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
  );

  return nodes
    .filter((node) => {
      if (completedNodeIds.has(node.id)) {
        return true;
      }

      const incomingHardEdges = edges.filter(
        (edge) => edge.to_node_id === node.id && edge.type === "hard",
      );

      return incomingHardEdges.every((edge) => completedNodeIds.has(edge.from_node_id));
    })
    .map((node) => node.id);
}

export function getRecommendedResumeNodeId(payload: GraphPayload): string | null {
  const availableNodeIds = new Set(
    computeAvailableNodeIds(payload.nodes, payload.edges, payload.progress),
  );
  const completedNodeIds = new Set(
    payload.progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
  );

  const candidate = [...payload.nodes]
    .sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.id.localeCompare(right.id);
    })
    .find((node) => availableNodeIds.has(node.id) && !completedNodeIds.has(node.id));

  return candidate?.id ?? null;
}

function sortNodesForDiagnostic(nodes: Node[]): Node[] {
  return [...nodes].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.id.localeCompare(right.id);
  });
}

export function getDiagnosticStartNode(nodes: Node[]): Node {
  const sorted = sortNodesForDiagnostic(nodes);
  const maxPosition = Math.max(...sorted.map((node) => node.position));
  const startPosition = Math.floor(maxPosition / 2);
  const exact = sorted.find((node) => node.position === startPosition);

  if (exact) {
    return exact;
  }

  const lower = [...sorted]
    .filter((node) => node.position < startPosition)
    .sort((left, right) => right.position - left.position || left.id.localeCompare(right.id))[0];

  if (lower) {
    return lower;
  }

  return sorted[0];
}

export function getNextDiagnosticNode(
  nodes: Node[],
  currentNodeId: string,
  answeredNodeIds: string[],
  answeredCorrectly: boolean,
): Node | null {
  const sorted = sortNodesForDiagnostic(nodes);
  const currentNode = sorted.find((node) => node.id === currentNodeId);

  if (!currentNode) {
    return null;
  }

  const asked = new Set(answeredNodeIds);
  const maxPosition = Math.max(...sorted.map((node) => node.position));
  const movement = answeredCorrectly ? 2 : -2;
  const rawTarget = currentNode.position + movement;
  const clampedTarget = Math.max(0, Math.min(maxPosition, rawTarget));

  const exact = sorted.find(
    (node) => node.position === clampedTarget && !asked.has(node.id),
  );
  if (exact) {
    return exact;
  }

  const primaryDirection = answeredCorrectly ? 1 : -1;
  for (let offset = 1; offset <= maxPosition; offset += 1) {
    const primaryPosition = clampedTarget + offset * primaryDirection;
    const secondaryPosition = clampedTarget - offset * primaryDirection;

    const primary = sorted.find(
      (node) => node.position === primaryPosition && !asked.has(node.id),
    );
    if (primary) {
      return primary;
    }

    const secondary = sorted.find(
      (node) => node.position === secondaryPosition && !asked.has(node.id),
    );
    if (secondary) {
      return secondary;
    }
  }

  return sorted.find((node) => !asked.has(node.id)) ?? null;
}

export function getDiagnosticRecommendation(
  nodes: Node[],
  answers: DiagnosticAnswer[],
): string {
  const sorted = sortNodesForDiagnostic(nodes);
  const correctNodeIds = new Set(
    answers.filter((answer) => answer.correct).map((answer) => answer.node_id),
  );

  const correctNodes = sorted.filter((node) => correctNodeIds.has(node.id));
  if (correctNodes.length === 0) {
    return sorted[0].id;
  }

  const highestPosition = Math.max(...correctNodes.map((node) => node.position));
  return (
    sorted.find((node) => node.position === highestPosition)?.id ??
    correctNodes[correctNodes.length - 1].id
  );
}

export function simulateDiagnosticRun(
  nodes: Node[],
  answers: DiagnosticAnswer[],
): DiagnosticRunResult {
  const startNode = getDiagnosticStartNode(nodes);
  const askedNodeIds: string[] = [];
  let currentNode: Node | null = startNode;

  for (const answer of answers.slice(0, 8)) {
    if (!currentNode) {
      break;
    }

    askedNodeIds.push(currentNode.id);
    currentNode = getNextDiagnosticNode(
      nodes,
      currentNode.id,
      askedNodeIds,
      answer.correct,
    );
  }

  return {
    start_node_id: startNode.id,
    asked_node_ids: askedNodeIds,
    recommended_node_id: getDiagnosticRecommendation(nodes, answers),
  };
}
