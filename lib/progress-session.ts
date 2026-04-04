import type { ProgressWriteResponse } from "@/lib/types";

export type StoredProgressCompletionHint = {
  graphId: string;
  completedNodeIds: string[];
  availableNodeIds: string[];
  updatedAt: string;
};

export function getProgressCompletionHintKey(graphId: string): string {
  return `foundation:progress-completion-hint:${graphId}`;
}

export function createProgressCompletionHint(input: {
  graphId: string;
  response: ProgressWriteResponse;
}): StoredProgressCompletionHint | null {
  if (!input.response.progress.completed) {
    return null;
  }

  return {
    graphId: input.graphId,
    completedNodeIds: [input.response.progress.node_id],
    availableNodeIds: input.response.available_node_ids,
    updatedAt: new Date().toISOString(),
  };
}
