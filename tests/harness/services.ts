import {
  canonicalizeFailureSchema,
  canonicalizeRequestSchema,
  canonicalizeResultSchema,
  graphPayloadSchema,
  progressWriteRequestSchema,
  progressWriteResponseSchema,
  retrieveRequestSchema,
  retrieveResponseSchema,
} from "@/lib/schemas";
import { computeAvailableNodeIds, isQuizPass } from "@/lib/domain/progress";
import { decideRetrievalCandidate } from "@/lib/domain/retrieval";
import type {
  CanonicalizeResult,
  GraphPayload,
  ProgressWriteRequest,
  ProgressWriteResponse,
  RetrieveRequest,
  RetrieveResponse,
} from "@/lib/types";

import {
  NODE_1_ID,
  NODE_2_ID,
  NODE_3_ID,
  TEST_USER_ID,
  baseGraphPayloadFixture,
  canonicalizeNonLearningPromptFixture,
  canonicalizePromptFixture,
  canonicalizeSuccessFixture,
  retrievalFixtureCandidates,
} from "./fixtures";

export function mockCanonicalizeRoute(prompt: string): CanonicalizeResult {
  canonicalizeRequestSchema.parse({ prompt });

  if (prompt.toLowerCase().includes("learn")) {
    return canonicalizeResultSchema.parse(canonicalizeSuccessFixture);
  }

  return canonicalizeFailureSchema.parse({ error: "NOT_A_LEARNING_REQUEST" });
}

export function mockRetrieveRoute(input: RetrieveRequest): RetrieveResponse {
  retrieveRequestSchema.parse(input);

  const matchingCandidates = retrievalFixtureCandidates
    .filter((candidate) => candidate.subject === input.subject)
    .map((candidate) => ({
      id: candidate.id,
      similarity: candidate.similarity,
      flagged_for_review: candidate.flagged_for_review,
      version: candidate.version,
      created_at: candidate.created_at,
    }));

  const decision = decideRetrievalCandidate(matchingCandidates);
  return retrieveResponseSchema.parse({ graph_id: decision.graph_id });
}

export function mockGraphReadRoute(): GraphPayload {
  return graphPayloadSchema.parse(baseGraphPayloadFixture);
}

function progressIdForNode(nodeId: string): string {
  if (nodeId === NODE_1_ID) {
    return "66666666-6666-4666-8666-666666666666";
  }

  if (nodeId === NODE_2_ID) {
    return "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  }

  return "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
}

export function mockProgressWriteRoute(
  payload: GraphPayload,
  input: ProgressWriteRequest,
): {
  graphPayload: GraphPayload;
  response: ProgressWriteResponse;
} {
  progressWriteRequestSchema.parse(input);

  const timestamp = input.timestamp ?? "2026-04-01T12:10:00.000Z";
  const nodeIndex = payload.nodes.findIndex((node) => node.id === input.node_id);
  if (nodeIndex === -1) {
    throw new Error(`Unknown node_id: ${input.node_id}`);
  }

  if (input.graph_id !== payload.graph.id) {
    throw new Error(`Graph mismatch for progress write: ${input.graph_id}`);
  }

  const updatedNodes = payload.nodes.map((node, index) => {
    if (index !== nodeIndex) {
      return { ...node };
    }

    const isPass = isQuizPass(input.score);
    return {
      ...node,
      attempt_count: node.attempt_count + 1,
      pass_count: node.pass_count + (isPass ? 1 : 0),
    };
  });

  const isPass = isQuizPass(input.score);
  const existingProgressIndex = payload.progress.findIndex(
    (entry) =>
      entry.user_id === TEST_USER_ID &&
      entry.node_id === input.node_id &&
      entry.graph_version === payload.graph.version,
  );

  const nextAttempts = [
    ...(existingProgressIndex >= 0 ? payload.progress[existingProgressIndex].attempts : []),
    { score: input.score, timestamp },
  ];

  const updatedProgressEntry = {
    id:
      existingProgressIndex >= 0
        ? payload.progress[existingProgressIndex].id
        : progressIdForNode(input.node_id),
    user_id: TEST_USER_ID,
    node_id: input.node_id,
    graph_version: payload.graph.version,
    completed:
      existingProgressIndex >= 0
        ? payload.progress[existingProgressIndex].completed || isPass
        : isPass,
    attempts: nextAttempts,
  };

  const updatedProgress = [...payload.progress];
  if (existingProgressIndex >= 0) {
    updatedProgress[existingProgressIndex] = updatedProgressEntry;
  } else {
    updatedProgress.push(updatedProgressEntry);
  }

  const updatedGraphPayload: GraphPayload = {
    graph: {
      ...payload.graph,
      flagged_for_review:
        updatedNodes[nodeIndex].attempt_count > 10 &&
        updatedNodes[nodeIndex].pass_count / updatedNodes[nodeIndex].attempt_count < 0.4
          ? true
          : payload.graph.flagged_for_review,
    },
    nodes: updatedNodes,
    edges: payload.edges.map((edge) => ({ ...edge })),
    progress: updatedProgress,
  };

  const response = progressWriteResponseSchema.parse({
    progress: updatedProgressEntry,
    available_node_ids: computeAvailableNodeIds(
      updatedGraphPayload.nodes,
      updatedGraphPayload.edges,
      updatedGraphPayload.progress,
    ),
    flagged_for_review: updatedGraphPayload.graph.flagged_for_review,
  });

  return {
    graphPayload: updatedGraphPayload,
    response,
  };
}

export const canonicalizeLearningPrompt = canonicalizePromptFixture;
export const canonicalizeRejectionPrompt = canonicalizeNonLearningPromptFixture;
export const retrievalSubjectCandidates = retrievalFixtureCandidates;
export { NODE_1_ID, NODE_2_ID, NODE_3_ID };
