import { computeAvailableNodeIds } from "@/lib/domain/progress";
import type { Edge, GraphPayload, Node, NodeState } from "@/lib/types";

export type GraphLayoutNode = Node & {
  x: number;
  y: number;
  state: NodeState;
};

function sortNodes(nodes: Node[]): Node[] {
  return [...nodes].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.id.localeCompare(right.id);
  });
}

function isCompleted(nodeId: string, payload: GraphPayload): boolean {
  return payload.progress.some(
    (entry) => entry.node_id === nodeId && entry.completed,
  );
}

function deriveNodeState(input: {
  node: Node;
  payload: GraphPayload;
  recommendedNodeId: string | null;
  activeNodeId: string | null;
  availableNodeIds: Set<string>;
}): NodeState {
  if (input.activeNodeId === input.node.id) {
    return "active";
  }

  if (isCompleted(input.node.id, input.payload)) {
    return "completed";
  }

  if (input.recommendedNodeId === input.node.id) {
    return "recommended";
  }

  if (input.availableNodeIds.has(input.node.id)) {
    return "available";
  }

  return "locked";
}

export function getRecommendedResumeNodeId(payload: GraphPayload): string | null {
  const availableNodeIds = new Set(
    computeAvailableNodeIds(payload.nodes, payload.edges, payload.progress),
  );
  const completedNodeIds = new Set(
    payload.progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
  );

  const candidate = sortNodes(payload.nodes).find(
    (node) => availableNodeIds.has(node.id) && !completedNodeIds.has(node.id),
  );

  return candidate?.id ?? null;
}

export function buildGraphLayout(
  payload: GraphPayload,
  options: {
    recommendedNodeId?: string | null;
    activeNodeId?: string | null;
  } = {},
): GraphLayoutNode[] {
  const recommendedNodeId =
    options.recommendedNodeId ?? getRecommendedResumeNodeId(payload);
  const activeNodeId = options.activeNodeId ?? null;
  const availableNodeIds = new Set(
    computeAvailableNodeIds(payload.nodes, payload.edges, payload.progress),
  );

  const layerCounts = new Map<number, number>();
  const sorted = sortNodes(payload.nodes);

  return sorted.map((node) => {
    const currentCount = layerCounts.get(node.position) ?? 0;
    layerCounts.set(node.position, currentCount + 1);

    const state = deriveNodeState({
      node,
      payload,
      recommendedNodeId,
      activeNodeId,
      availableNodeIds,
    });

    return {
      ...node,
      state,
      x: 80 + node.position * 220,
      y: 88 + currentCount * 96,
    };
  });
}

export function edgeEndpoints(
  nodes: GraphLayoutNode[],
  edge: Edge,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const from = nodes.find((node) => node.id === edge.from_node_id);
  const to = nodes.find((node) => node.id === edge.to_node_id);

  if (!from || !to) {
    return null;
  }

  return {
    x1: from.x + 160,
    y1: from.y + 28,
    x2: to.x,
    y2: to.y + 28,
  };
}

