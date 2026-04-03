import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo } from "@/lib/logging";
import type {
  CanonicalBoundaryFields,
  CanonicalizeSuccess,
  GenerationEdgeDraft,
  GenerationFailureCategory,
  GenerationNodeDraft,
  GenerationStructureIssue,
  GenerationCurriculumOutcomeBucket,
} from "@/lib/types";
import { generationGraphDraftSchema } from "@/lib/schemas";

import {
  curriculumAuditStatusSchema,
  curriculumValidatorModelOutputSchema,
  curriculumOutcomeBucketSchema,
  normalizeCurriculumValidatorOutput,
  normalizeStructureValidatorOutput,
  graphReconciliationModeSchema,
  reconcilerOutputSchema,
  structureValidatorModelOutputSchema,
  structureValidatorOutputSchema,
  type CurriculumAuditStatus,
  type CurriculumValidatorOutput,
  type GraphReconciliationMode,
  type ReconcilerOutput,
  type StructureValidatorOutput,
} from "../contracts";
import {
  createCurriculumCoverageIssueKey,
  createStructureCoverageIssueKey,
} from "../issue-keys";
import { deriveCurriculumOutcomeBucket } from "../graph-route-telemetry";
import { executeLlmStage, type LlmStageDependencies } from "../llm-stage";
import { computeStageTimeout } from "../timeout-model";

export { computeStageTimeout } from "../timeout-model";

const GRAPH_GENERATOR_MAX_TOKENS = 2400;
const STRUCTURE_VALIDATOR_MAX_TOKENS = 900;
const CURRICULUM_VALIDATOR_MAX_TOKENS = 500;
const RECONCILER_MAX_TOKENS = 1800;

const GRAPH_GENERATOR_TIMEOUT_MS = computeStageTimeout(GRAPH_GENERATOR_MAX_TOKENS);
const STRUCTURE_VALIDATOR_TIMEOUT_MS = computeStageTimeout(STRUCTURE_VALIDATOR_MAX_TOKENS);
const CURRICULUM_VALIDATOR_TIMEOUT_MS = computeStageTimeout(CURRICULUM_VALIDATOR_MAX_TOKENS);
const RECONCILER_TIMEOUT_MS = computeStageTimeout(RECONCILER_MAX_TOKENS);

type GraphStageDependencies<TOutput> = LlmStageDependencies<TOutput>;
type ReconcilerRunOutput = ReconcilerOutput & {
  repair_mode: GraphReconciliationMode;
};

type GraphContextInput = CanonicalizeSuccess;
type GraphStructureInput = {
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
};
type CurriculumAuditResult = {
  output: CurriculumValidatorOutput;
  auditStatus: CurriculumAuditStatus;
  outcomeBucket: GenerationCurriculumOutcomeBucket;
  attemptCount: number;
  finalFailureCategory: GenerationFailureCategory | null;
  parseErrorSummary: string | null;
  failureSubtype: "invalid_json" | "schema_mismatch" | "timeout" | null;
  durationMs: number;
  asyncAudit: boolean;
};

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function serializeCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

function createEmptyCurriculumValidatorOutput(): CurriculumValidatorOutput {
  return normalizeCurriculumValidatorOutput({
    valid: true,
    issues: [],
  });
}

function createNodeMap(nodes: GenerationNodeDraft[]): Map<string, GenerationNodeDraft> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function recomputePositionsFromHardEdges(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): GenerationNodeDraft[] {
  const hardIndegree = new Map(nodes.map((node) => [node.id, 0]));
  const hardAdjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const levels = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (edge.type !== "hard") {
      continue;
    }

    hardAdjacency.get(edge.from_node_id)?.push(edge.to_node_id);
    hardIndegree.set(
      edge.to_node_id,
      (hardIndegree.get(edge.to_node_id) ?? 0) + 1,
    );
  }

  const queue = nodes
    .map((node) => node.id)
    .filter((nodeId) => (hardIndegree.get(nodeId) ?? 0) === 0);

  let visited = 0;

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }

    visited += 1;
    const currentLevel = levels.get(nodeId) ?? 0;

    for (const nextNodeId of hardAdjacency.get(nodeId) ?? []) {
      levels.set(nextNodeId, Math.max(levels.get(nextNodeId) ?? 0, currentLevel + 1));

      const nextIndegree = (hardIndegree.get(nextNodeId) ?? 1) - 1;
      hardIndegree.set(nextNodeId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(nextNodeId);
      }
    }
  }

  if (visited !== nodes.length) {
    throw new ApiError(
      "LLM_OUTPUT_INVALID",
      `${stage} failed semantic validation: graph returned a cyclic hard-edge dependency chain.`,
      502,
    );
  }

  return nodes.map((node) => ({
    ...node,
    position: levels.get(node.id) ?? 0,
  }));
}

function assertGraphShapeInvariants(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): void {
  assertUniqueNodeIds(nodes, stage);
  assertNodeReferencesExist(nodes, edges, stage);
  assertUniqueEdges(edges, stage);
}

function assertUniqueNodeIds(nodes: GenerationNodeDraft[], stage: string): void {
  const seen = new Set<string>();

  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed shape validation: graph returned duplicate node ids.`,
        502,
        { node_id: node.id },
      );
    }
    seen.add(node.id);
  }
}

function assertNodeReferencesExist(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): void {
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const edge of edges) {
    if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed shape validation: graph referenced an unknown node id in edges.`,
        502,
        { edge },
      );
    }
  }
}

function assertUniqueEdges(edges: GenerationEdgeDraft[], stage: string): void {
  const seen = new Set<string>();

  for (const edge of edges) {
    const key = `${edge.from_node_id}::${edge.to_node_id}::${edge.type}`;
    if (seen.has(key)) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed shape validation: graph returned duplicate edges.`,
        502,
        { edge },
      );
    }
    seen.add(key);
  }
}

function assertGraphSemanticInvariants(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): void {
  assertGraphIsDag(nodes, edges, stage);

  const nodeMap = createNodeMap(nodes);
  for (const edge of edges) {
    if (edge.from_node_id === edge.to_node_id) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed semantic validation: graph returned a self-loop edge.`,
        502,
        { edge },
      );
    }

    if (edge.type !== "hard") {
      continue;
    }

    const fromNode = nodeMap.get(edge.from_node_id);
    const toNode = nodeMap.get(edge.to_node_id);
    if (!fromNode || !toNode) {
      continue;
    }
    if (fromNode.position >= toNode.position) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed semantic validation: graph returned a hard edge with invalid position ordering.`,
        502,
        { edge, from_position: fromNode.position, to_position: toNode.position },
      );
    }
  }
}

function assertGraphIsDag(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): void {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    adjacency.get(edge.from_node_id)?.push(edge.to_node_id);
    indegree.set(edge.to_node_id, (indegree.get(edge.to_node_id) ?? 0) + 1);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodeId]) => nodeId);
  let visited = 0;

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }
    visited += 1;

    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      const nextDegree = (indegree.get(nextNodeId) ?? 1) - 1;
      indegree.set(nextNodeId, nextDegree);
      if (nextDegree === 0) {
        queue.push(nextNodeId);
      }
    }
  }

  if (visited !== nodes.length) {
    throw new ApiError(
      "LLM_OUTPUT_INVALID",
      `${stage} failed semantic validation: graph returned a cyclic graph.`,
      502,
    );
  }
}

function assertGraphStateInvariants(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): void {
  for (const node of nodes) {
    const hasIncomingHardEdge = edges.some(
      (edge) => edge.to_node_id === node.id && edge.type === "hard",
    );
    const participatesInEdges = edges.some(
      (edge) => edge.from_node_id === node.id || edge.to_node_id === node.id,
    );

    if (node.position > 0 && !hasIncomingHardEdge) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed state validation: graph returned a non-root node without an incoming hard edge.`,
        502,
        { node_id: node.id },
      );
    }

    if (!participatesInEdges) {
      throw new ApiError(
        "LLM_OUTPUT_INVALID",
        `${stage} failed state validation: graph returned an isolated node.`,
        502,
        { node_id: node.id },
      );
    }
  }
}

function assertGraphDraftInvariants(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): GenerationNodeDraft[] {
  assertGraphShapeInvariants(nodes, edges, stage);
  const normalizedNodes = recomputePositionsFromHardEdges(nodes, edges, stage);
  assertGraphSemanticInvariants(normalizedNodes, edges, stage);
  assertGraphStateInvariants(normalizedNodes, edges, stage);
  return normalizedNodes;
}

function dedupeExactEdges(edges: GenerationEdgeDraft[]): GenerationEdgeDraft[] {
  const deduped = new Map<string, GenerationEdgeDraft>();

  for (const edge of edges) {
    const key = `${edge.from_node_id}::${edge.to_node_id}::${edge.type}`;
    if (!deduped.has(key)) {
      deduped.set(key, edge);
    }
  }

  return [...deduped.values()];
}

function pruneRedundantHardEdges(edges: GenerationEdgeDraft[]): GenerationEdgeDraft[] {
  const nextEdges = [...edges];

  for (let index = 0; index < nextEdges.length; index += 1) {
    const edge = nextEdges[index];
    if (!edge || edge.type !== "hard") {
      continue;
    }

    if (hasAlternateHardPath(edge.from_node_id, edge.to_node_id, nextEdges, index)) {
      nextEdges.splice(index, 1);
      index -= 1;
    }
  }

  return nextEdges;
}

function normalizeGraphDraftDeterministically(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  stage: string,
): { nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] } {
  assertUniqueNodeIds(nodes, stage);
  assertNodeReferencesExist(nodes, edges, stage);

  const dedupedEdges = dedupeExactEdges(edges);
  const prunedEdges = pruneRedundantHardEdges(dedupedEdges);
  const normalizedNodes = recomputePositionsFromHardEdges(nodes, prunedEdges, stage);
  const validatedNodes = assertGraphDraftInvariants(normalizedNodes, prunedEdges, stage);

  return {
    nodes: validatedNodes,
    edges: prunedEdges,
  };
}

function assertValidatorNodeReferences(
  nodes: GenerationNodeDraft[],
  output: StructureValidatorOutput | CurriculumValidatorOutput,
  stage: string,
): void {
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const issue of output.issues) {
    for (const nodeId of issue.nodes_involved) {
      if (!nodeIds.has(nodeId)) {
        throw new ApiError(
          "LLM_CONTRACT_VIOLATION",
          `${stage} referenced an unknown node id in nodes_involved.`,
          502,
          { node_id: nodeId },
        );
      }
    }
  }
}

function createStructureIssueDedupKey(issue: GenerationStructureIssue): string {
  return [
    issue.type,
    issue.severity,
    [...issue.nodes_involved].sort().join(","),
    issue.description,
    issue.suggested_fix,
  ].join("::");
}

function mergeStructureIssues(
  deterministicIssues: GenerationStructureIssue[],
  modelIssues: GenerationStructureIssue[],
): GenerationStructureIssue[] {
  const merged = new Map<string, GenerationStructureIssue>();

  for (const issue of [...deterministicIssues, ...modelIssues]) {
    merged.set(createStructureIssueDedupKey(issue), issue);
  }

  return [...merged.values()];
}

function normalizeConceptLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONCEPT_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "the",
  "their",
  "to",
  "with",
  "within",
  "through",
  "about",
  "between",
  "before",
  "after",
  "while",
  "using",
  "used",
  "use",
  "this",
  "that",
  "these",
  "those",
  "only",
  "more",
  "most",
  "less",
  "least",
  "than",
  "then",
  "there",
  "here",
  "when",
  "where",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "why",
  "how",
]);

const CONCEPT_GENERIC_TOKENS = new Set([
  "concept",
  "concepts",
  "equation",
  "equations",
  "example",
  "examples",
  "exercise",
  "exercises",
  "foundation",
  "foundations",
  "fundamental",
  "fundamentals",
  "function",
  "functions",
  "graph",
  "graphs",
  "idea",
  "ideas",
  "intro",
  "introduction",
  "introductions",
  "basic",
  "basics",
  "principle",
  "principles",
  "problem",
  "problems",
  "rule",
  "rules",
]);

function meaningfulTokens(value: string): string[] {
  return normalizeConceptLabel(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !CONCEPT_STOPWORDS.has(token));
}

function anchorTokens(value: string): string[] {
  return meaningfulTokens(value).filter((token) => !CONCEPT_GENERIC_TOKENS.has(token));
}

function conceptMatchesTitle(concept: string, title: string): boolean {
  const normalizedConcept = normalizeConceptLabel(concept);
  const normalizedTitle = normalizeConceptLabel(title);
  const conceptTokens = anchorTokens(concept);

  if (normalizedConcept.length === 0 || normalizedTitle.length === 0) {
    return false;
  }

  if (conceptTokens.length === 0) {
    return false;
  }

  if (
    normalizedTitle.includes(normalizedConcept) ||
    normalizedConcept.includes(normalizedTitle)
  ) {
    return true;
  }

  const nodeTitleTokens = new Set(meaningfulTokens(title));

  if (nodeTitleTokens.size === 0) {
    return false;
  }

  if (conceptTokens.length === 1) {
    return nodeTitleTokens.has(conceptTokens[0]!);
  }

  return conceptTokens.some((token) => nodeTitleTokens.has(token));
}

function buildHardAdjacency(edges: GenerationEdgeDraft[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.type !== "hard") {
      continue;
    }

    const neighbors = adjacency.get(edge.from_node_id) ?? [];
    neighbors.push(edge.to_node_id);
    adjacency.set(edge.from_node_id, neighbors);
  }

  return adjacency;
}

function findHardCycleNodeIds(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
): string[] {
  const hardAdjacency = buildHardAdjacency(edges);
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): string[] | null => {
    if (active.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return cycleStart >= 0 ? path.slice(cycleStart) : [nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    active.add(nodeId);
    path.push(nodeId);

    for (const nextNodeId of hardAdjacency.get(nodeId) ?? []) {
      const cycle = visit(nextNodeId);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    active.delete(nodeId);
    return null;
  };

  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) {
      return cycle;
    }
  }

  return [];
}

function hasAlternateHardPath(
  sourceNodeId: string,
  targetNodeId: string,
  edges: GenerationEdgeDraft[],
  edgeIndexToSkip: number,
): boolean {
  const adjacency = new Map<string, string[]>();

  for (const [index, edge] of edges.entries()) {
    if (index === edgeIndexToSkip || edge.type !== "hard") {
      continue;
    }

    const neighbors = adjacency.get(edge.from_node_id) ?? [];
    neighbors.push(edge.to_node_id);
    adjacency.set(edge.from_node_id, neighbors);
  }

  const visited = new Set<string>([sourceNodeId]);
  const queue = [sourceNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }

    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      if (nextNodeId === targetNodeId) {
        return true;
      }

      if (visited.has(nextNodeId)) {
        continue;
      }

      visited.add(nextNodeId);
      queue.push(nextNodeId);
    }
  }

  return false;
}

function findReachableFromRootNodes(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
): Set<string> {
  const hardAdjacency = buildHardAdjacency(edges);
  const rootNodeIds = nodes.filter((node) => node.position === 0).map((node) => node.id);
  const reachable = new Set<string>(rootNodeIds);
  const queue = [...rootNodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      break;
    }

    for (const nextNodeId of hardAdjacency.get(nodeId) ?? []) {
      if (reachable.has(nextNodeId)) {
        continue;
      }

      reachable.add(nextNodeId);
      queue.push(nextNodeId);
    }
  }

  return reachable;
}

function buildIncomingEdgesByNode(
  edges: GenerationEdgeDraft[],
): Map<string, GenerationEdgeDraft[]> {
  const incoming = new Map<string, GenerationEdgeDraft[]>();

  for (const edge of edges) {
    const entries = incoming.get(edge.to_node_id) ?? [];
    entries.push(edge);
    incoming.set(edge.to_node_id, entries);
  }

  return incoming;
}

function runDeterministicStructureValidation(
  input: GraphStructureInput,
): StructureValidatorOutput {
  const issues: GenerationStructureIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const pushIssue = (issue: GenerationStructureIssue): void => {
    const key = createStructureIssueDedupKey(issue);
    if (seenIssueKeys.has(key)) {
      return;
    }

    seenIssueKeys.add(key);
    issues.push(issue);
  };

  const cycleNodes = findHardCycleNodeIds(input.nodes, input.edges);
  if (cycleNodes.length > 0) {
    pushIssue({
      type: "circular_dependency",
      severity: "critical",
      nodes_involved: cycleNodes,
      description: "The hard-edge graph contains a cycle that prevents a valid mastery order.",
      suggested_fix: "Remove or retype at least one hard edge so the dependency chain becomes acyclic.",
    });
  }

  for (const edge of input.edges) {
    if (edge.type !== "hard") {
      continue;
    }

    const fromNode = input.nodes.find((node) => node.id === edge.from_node_id);
    const toNode = input.nodes.find((node) => node.id === edge.to_node_id);
    if (!fromNode || !toNode) {
      continue;
    }

    if (fromNode.position >= toNode.position) {
      pushIssue({
        type: "position_inconsistency",
        severity: "major",
        nodes_involved: [fromNode.id, toNode.id],
        description: "A hard dependency is ordered at the same or a later position than its dependent node.",
        suggested_fix: "Recompute positions so every hard prerequisite appears strictly earlier than its dependent node.",
      });
    }
  }

  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const incomingEdgesByNode = buildIncomingEdgesByNode(input.edges);
  const maxPosition = Math.max(...input.nodes.map((node) => node.position));

  for (const node of input.nodes) {
    const incomingEdges = incomingEdgesByNode.get(node.id) ?? [];
    const hardIncomingEdges = incomingEdges.filter((edge) => edge.type === "hard");
    const softIncomingEdges = incomingEdges.filter((edge) => edge.type === "soft");

    if (node.position === 0) {
      continue;
    }

    const latestHardSourcePosition = Math.max(
      -1,
      ...hardIncomingEdges.map(
        (edge) => nodeById.get(edge.from_node_id)?.position ?? -1,
      ),
    );
    const immediateSoftIncomingEdges = softIncomingEdges.filter((edge) => {
      const sourcePosition = nodeById.get(edge.from_node_id)?.position;
      return sourcePosition === node.position - 1;
    });
    const immediateHardIncomingEdges = hardIncomingEdges.filter((edge) => {
      const sourcePosition = nodeById.get(edge.from_node_id)?.position;
      return sourcePosition === node.position - 1;
    });

    for (const softEdge of immediateSoftIncomingEdges) {
      const softSourcePosition = nodeById.get(softEdge.from_node_id)?.position ?? -1;
      if (
        softSourcePosition === node.position - 1 &&
        latestHardSourcePosition <= node.position - 2
      ) {
        pushIssue({
          type: "missing_hard_edge",
          severity: "major",
          nodes_involved: [softEdge.from_node_id, node.id],
          description: "An immediate prior concept is connected only by a soft edge even though the node lacks a matching hard prerequisite at that stage.",
          suggested_fix: "Promote the immediate prerequisite edge to hard or add a hard prerequisite that covers the same dependency.",
        });
      }
    }

    if (
      immediateSoftIncomingEdges.length > 0 &&
      immediateHardIncomingEdges.length === 0 &&
      hardIncomingEdges.length === 1 &&
      node.position === maxPosition
    ) {
      pushIssue({
        type: "edge_misclassification",
        severity: "major",
        nodes_involved: [
          hardIncomingEdges[0]!.from_node_id,
          ...immediateSoftIncomingEdges.map((edge) => edge.from_node_id),
          node.id,
        ],
        description: "A capstone node appears to rely on an immediate prior concept that is only modeled as soft context.",
        suggested_fix: "Promote the required immediate dependency to hard or reduce the capstone so its single hard prerequisite is sufficient.",
      });
    }

    if (
      hardIncomingEdges.length > 1 &&
      hardIncomingEdges.every((edge) => {
        const sourceNode = nodeById.get(edge.from_node_id);
        return sourceNode ? sourceNode.position === 0 : false;
      })
    ) {
      pushIssue({
        type: "edge_misclassification",
        severity: "minor",
        nodes_involved: [node.id, ...hardIncomingEdges.map((edge) => edge.from_node_id)],
        description: "Multiple root-level hard prerequisites may be over-constraining a node that has no staged intermediate dependency.",
        suggested_fix: "Recheck whether one or more root-level hard edges should be soft contextual links instead.",
      });
    }

    const hardSourcePositions = new Set(
      hardIncomingEdges.map((edge) => nodeById.get(edge.from_node_id)?.position ?? -1),
    );
    const hasIndependentHardFanIn =
      hardIncomingEdges.length >= 3 &&
      hardSourcePositions.size <= 2 &&
      hardIncomingEdges.every((edge, index) =>
        hardIncomingEdges.every((otherEdge, otherIndex) => {
          if (index === otherIndex) {
            return true;
          }

          return (
            !hasAlternateHardPath(edge.from_node_id, otherEdge.from_node_id, input.edges, -1) &&
            !hasAlternateHardPath(otherEdge.from_node_id, edge.from_node_id, input.edges, -1)
          );
        }),
      );

    if (hasIndependentHardFanIn) {
      pushIssue({
        type: "edge_misclassification",
        severity: "major",
        nodes_involved: [node.id, ...hardIncomingEdges.map((edge) => edge.from_node_id)],
        description: "The node is gated by several independent hard prerequisites that likely over-constrain learning at this stage.",
        suggested_fix: "Keep only the truly blocking prerequisite edges as hard and demote contextual support to soft.",
      });
    }
  }

  for (const [index, edge] of input.edges.entries()) {
    if (edge.type !== "hard") {
      continue;
    }

    if (
      hasAlternateHardPath(edge.from_node_id, edge.to_node_id, input.edges, index)
    ) {
      pushIssue({
        type: "redundant_edge",
        severity: "minor",
        nodes_involved: [edge.from_node_id, edge.to_node_id],
        description: "A hard edge duplicates a prerequisite path that is already enforced transitively.",
        suggested_fix: "Remove the redundant hard edge unless it carries distinct non-gating context.",
      });
    }
  }

  const reachableFromRoots = findReachableFromRootNodes(input.nodes, input.edges);
  const orphanedNodes = input.nodes
    .filter((node) => !reachableFromRoots.has(node.id))
    .map((node) => node.id);

  if (orphanedNodes.length > 0) {
    pushIssue({
      type: "orphaned_subgraph",
      severity: "critical",
      nodes_involved: orphanedNodes,
      description: "One or more nodes are not reachable from any position-0 root through hard prerequisites.",
      suggested_fix: "Reconnect the orphaned subgraph with hard prerequisite edges from an appropriate root path.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function assertResolutionSummaryCoverage(
  output: ReconcilerOutput,
  input: {
    structure: StructureValidatorOutput;
    curriculum: CurriculumValidatorOutput;
  },
): void {
  const acceptedIssueKeys = [
    ...input.structure.issues.map(createStructureCoverageIssueKey),
    ...input.curriculum.issues.map(createCurriculumCoverageIssueKey),
  ];

  if (acceptedIssueKeys.length === 0) {
    return;
  }

  if (output.resolution_summary.length === 0) {
    throw new ApiError(
      "LLM_CONTRACT_VIOLATION",
      "reconcile failed deterministic validation: resolution_summary is required when validator issues exist.",
      502,
    );
  }

  const coveredIssueKeys = new Set<string>();
  for (const entry of output.resolution_summary) {
    if (coveredIssueKeys.has(entry.issue_key)) {
      throw new ApiError(
        "LLM_CONTRACT_VIOLATION",
        "reconcile failed deterministic validation: resolution_summary contains duplicate issue keys.",
        502,
        { issue_key: entry.issue_key },
      );
    }
    coveredIssueKeys.add(entry.issue_key);
  }
  const missingIssueKeys = acceptedIssueKeys.filter((issueKey) => !coveredIssueKeys.has(issueKey));

  if (missingIssueKeys.length > 0) {
    throw new ApiError(
      "LLM_CONTRACT_VIOLATION",
      "reconcile failed deterministic validation: resolution_summary must cover every accepted validator issue key.",
      502,
      { missing_issue_keys: missingIssueKeys },
    );
  }
}

function createDeterministicResolutionAction(issue: GenerationStructureIssue): string {
  switch (issue.type) {
    case "redundant_edge":
      return "Removed a redundant hard edge and recomputed positions.";
    case "missing_hard_edge":
      return "Promoted an implied prerequisite edge to hard and recomputed positions.";
    case "edge_misclassification":
      return "Demoted one over-constraining hard prerequisite to soft and recomputed positions.";
    case "position_inconsistency":
      return "Recomputed positions from the hard-edge DAG.";
    default:
      return "Applied deterministic graph normalization and revalidated the graph.";
  }
}

function repairEdgeMisclassificationMinorIssue(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  issue: GenerationStructureIssue,
): GenerationEdgeDraft[] | null {
  if (issue.type !== "edge_misclassification" || issue.severity !== "minor") {
    return null;
  }

  const issueNodeIds = new Set(issue.nodes_involved);
  if (issueNodeIds.size !== 3) {
    return null;
  }

  const nodeById = createNodeMap(nodes);
  const candidateTargetNode = nodes.find((node) => {
    if (!issueNodeIds.has(node.id) || node.position <= 0) {
      return false;
    }

    const issueIncomingHardEdges = edges.filter(
      (edge) =>
        edge.type === "hard" &&
        edge.to_node_id === node.id &&
        issueNodeIds.has(edge.from_node_id),
    );

    return (
      issueIncomingHardEdges.length === 2 &&
      issueIncomingHardEdges.every(
        (edge) => (nodeById.get(edge.from_node_id)?.position ?? -1) === 0,
      )
    );
  });

  if (!candidateTargetNode) {
    return null;
  }

  const issueIncomingHardEdges = edges
    .filter(
      (edge) =>
        edge.type === "hard" &&
        edge.to_node_id === candidateTargetNode.id &&
        issueNodeIds.has(edge.from_node_id),
    )
    .sort((left, right) => {
      if (left.from_node_id !== right.from_node_id) {
        return left.from_node_id.localeCompare(right.from_node_id);
      }

      return left.to_node_id.localeCompare(right.to_node_id);
    });

  const edgeToDemote = issueIncomingHardEdges[1];
  if (!edgeToDemote) {
    return null;
  }

  return edges.map((edge) =>
    edge.type === "hard" &&
    edge.from_node_id === edgeToDemote.from_node_id &&
    edge.to_node_id === edgeToDemote.to_node_id
      ? {
          ...edge,
          type: "soft" as const,
        }
      : edge,
  );
}

function applyDeterministicStructureRepairs(
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
  issues: GenerationStructureIssue[],
): { nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] } {
  let nextEdges = dedupeExactEdges(edges);

  for (const issue of issues) {
    if (issue.type === "redundant_edge" && issue.nodes_involved.length >= 2) {
      const [fromNodeId, toNodeId] = issue.nodes_involved;
      nextEdges = nextEdges.filter(
        (edge) =>
          !(
            edge.type === "hard" &&
            edge.from_node_id === fromNodeId &&
            edge.to_node_id === toNodeId
          ),
      );
      continue;
    }

    if (issue.type === "missing_hard_edge" && issue.nodes_involved.length >= 2) {
      const [fromNodeId, toNodeId] = issue.nodes_involved;
      nextEdges = nextEdges.map((edge) =>
        edge.type === "soft" &&
        edge.from_node_id === fromNodeId &&
        edge.to_node_id === toNodeId
          ? {
              ...edge,
              type: "hard" as const,
            }
          : edge,
      );
      continue;
    }

    const repairedEdgeSet = repairEdgeMisclassificationMinorIssue(nodes, nextEdges, issue);
    if (repairedEdgeSet) {
      nextEdges = repairedEdgeSet;
    }
  }

  return normalizeGraphDraftDeterministically(nodes, nextEdges, "reconcile_local_repair");
}

export function assertCanonicalBoundaryInvariants(
  nodes: GenerationNodeDraft[],
  boundaries: CanonicalBoundaryFields | undefined,
): void {
  if (!boundaries?.prerequisites && !boundaries?.downstream_topics) {
    return;
  }

  for (const node of nodes) {
    for (const prerequisite of boundaries.prerequisites ?? []) {
      if (conceptMatchesTitle(prerequisite, node.title)) {
        throw new ApiError(
          "GRAPH_BOUNDARY_VIOLATION",
          "reconcile failed deterministic validation: graph includes assumed prior knowledge as a node.",
          422,
          { node_id: node.id, title: node.title, prerequisite },
        );
      }
    }

    for (const downstreamTopic of boundaries.downstream_topics ?? []) {
      if (conceptMatchesTitle(downstreamTopic, node.title)) {
        throw new ApiError(
          "GRAPH_BOUNDARY_VIOLATION",
          "reconcile failed deterministic validation: graph includes a downstream topic as a node.",
          422,
          { node_id: node.id, title: node.title, downstream_topic: downstreamTopic },
        );
      }
    }
  }
}

function buildGraphGeneratorSystemPrompt(): string {
  return [
    "You are the Foundation graph generator.",
    "Return only raw JSON.",
    "Generate a topic-scoped knowledge dependency DAG for the canonicalized concept.",
    "Output shape: {\"nodes\":[{\"id\":\"node_1\",\"title\":\"...\",\"position\":0}],\"edges\":[{\"from_node_id\":\"node_1\",\"to_node_id\":\"node_2\",\"type\":\"hard\"}]}",
    "Rules: 10 to 25 nodes, atomic concepts, no cycles, no self-loops, unique node ids, at least one position-0 node, every non-root node has at least one incoming hard edge, hard edges must go from lower position to higher position, and no isolated nodes.",
    "Hard prerequisites must be sufficient on their own, soft edges are contextual only, and transitive hard edges should be omitted unless they add distinct non-gating context.",
    "Prefer fewer cleaner hard edges over dense fan-in, and avoid creating capstones that depend on immediate prior concepts only through soft edges.",
    "Do not include assumed prior knowledge or downstream topics as graph nodes.",
    "The server will deterministically normalize positions, prune duplicate edges, and remove redundant hard edges before reconciliation, so do not rely on later repair to fix avoidable structure mistakes.",
  ].join(" ");
}

function buildValidatorGraphPayload(input: {
  subject: string;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
}): string {
  return [
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    `Description: ${input.description}`,
    "Graph JSON:",
    serializeJson({
      nodes: input.nodes,
      edges: input.edges,
    }),
  ].join("\n\n");
}

function buildStructureValidatorSystemPrompt(): string {
  return [
    "You are the Foundation structure validator.",
    "Return only raw JSON.",
    "Audit graph mechanics only.",
    "Find issues in circular dependencies, missing hard prerequisites, edge misclassification, redundant edges, position consistency, and orphaned subgraphs.",
    "Set valid to true only when issues is empty. Set valid to false whenever issues is non-empty.",
    "Do not rewrite the graph.",
    "Output schema: {\"valid\":boolean,\"issues\":[{\"type\":\"...\",\"severity\":\"critical|major|minor\",\"nodes_involved\":[\"node_1\"],\"description\":\"...\",\"suggested_fix\":\"...\"}]}",
  ].join(" ");
}

function buildCurriculumValidatorPayload(input: {
  subject: string;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
}): string {
  const nodes = input.nodes
    .slice()
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((node) => ({
      id: node.id,
      title: node.title,
      position: node.position,
    }));

  const hardEdges = input.edges
    .filter((edge) => edge.type === "hard")
    .map((edge) => ({
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
    }))
    .sort((left, right) =>
      left.from_node_id === right.from_node_id
        ? left.to_node_id.localeCompare(right.to_node_id)
        : left.from_node_id.localeCompare(right.from_node_id),
    );

  return serializeCompactJson({
    subject: input.subject,
    topic: input.topic,
    description: input.description,
    nodes,
    hard_edges: hardEdges,
  });
}

function buildCurriculumValidatorSystemPrompt(): string {
  return [
    "You are the Foundation curriculum validator.",
    "Return only raw JSON.",
    "Use the compact JSON payload exactly as provided.",
    "Keep responses short and schema-only.",
    "Do not emit markdown, commentary, or long prose descriptions.",
    "Return at most 3 issues.",
    "Each description field must be exactly one short sentence and no more than 160 characters.",
    "Each suggested_fix field must be exactly one short sentence and no more than 140 characters.",
    "Each curriculum_basis field must be exactly one short sentence and no more than 160 characters.",
    "Stay comfortably under each character cap; never rely on the server to trim fields for you.",
    "Prefer empty issues over low-confidence findings.",
    "Audit topic scope, pedagogical ordering, missing core concepts, out-of-scope concepts, pedagogical misalignment, and level mismatch.",
    "Be conservative and align with mainstream curriculum expectations.",
    "Set valid to true only when issues is empty. Set valid to false whenever issues is non-empty.",
    "Do not rewrite the graph.",
    "Output schema: {\"valid\":boolean,\"issues\":[{\"type\":\"...\",\"severity\":\"critical|major|minor\",\"nodes_involved\":[\"node_1\"],\"missing_concept_title\":null,\"description\":\"...\",\"suggested_fix\":\"...\",\"curriculum_basis\":\"...\"}]}",
  ].join(" ");
}

function deriveCurriculumFailureSubtype(
  error: unknown,
  isTimeout: boolean,
): "invalid_json" | "schema_mismatch" | "timeout" | null {
  if (isTimeout) {
    return "timeout";
  }

  const message =
    error instanceof ApiError && typeof error.details === "string"
      ? error.details
      : error instanceof Error
        ? error.message
        : String(error);
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("structured output as json") ||
    normalizedMessage.includes("unterminated string") ||
    normalizedMessage.includes("unexpected end of json input")
  ) {
    return "invalid_json";
  }

  if (
    normalizedMessage.includes("zoderror") ||
    normalizedMessage.includes("invalid input") ||
    normalizedMessage.includes("schema")
  ) {
    return "schema_mismatch";
  }

  return null;
}

function buildReconcilerSystemPrompt(): string {
  return [
    "You are the Foundation reconciler.",
    "Return only raw JSON.",
    "Repair the graph with minimal drift while resolving structure and curriculum issues.",
    "Preserve existing node ids when nodes remain.",
    "If new nodes are required, use the next available node_N id.",
    "Recompute positions to match final hard prerequisite order.",
    "Every resolution_summary entry must include the exact issue_key provided by the server for the issue it resolves.",
    "Output schema: {\"nodes\":[...],\"edges\":[...],\"resolution_summary\":[{\"issue_key\":\"structure:redundant_edge:node_1,node_2\",\"issue_source\":\"structure_validator|curriculum_validator|both\",\"issue_description\":\"...\",\"resolution_action\":\"...\"}]}",
  ].join(" ");
}

function buildReconcilerRepairSystemPrompt(): string {
  return [
    "You are the Foundation reconciler repairer.",
    "Return only raw JSON.",
    "Repair the reconciler output so it satisfies every deterministic graph invariant.",
    "Preserve graph meaning with the smallest possible drift.",
    "Every hard edge must go from lower position to higher position.",
    "The graph must remain acyclic, have at least one position-0 node, give every non-root node an incoming hard edge, and contain no isolated nodes.",
    "Do not explain your reasoning outside the JSON schema.",
    "Every resolution_summary entry must preserve the provided issue_key values.",
    "Output schema: {\"nodes\":[...],\"edges\":[...],\"resolution_summary\":[{\"issue_key\":\"structure:redundant_edge:node_1,node_2\",\"issue_source\":\"structure_validator|curriculum_validator|both\",\"issue_description\":\"...\",\"resolution_action\":\"...\"}]}",
  ].join(" ");
}

function serializeCurriculumOutputForPrompt(input: {
  curriculum: CurriculumValidatorOutput;
  curriculumAuditStatus: CurriculumAuditStatus;
}): string {
  if (input.curriculumAuditStatus !== "accepted") {
    return [
      `Curriculum validation was not available (status: ${input.curriculumAuditStatus}).`,
      "No curriculum findings to report.",
      "Focus on resolving structure issues only.",
    ].join(" ");
  }

  return serializeJson({
    valid: input.curriculum.valid,
    issues: input.curriculum.issues.map((issue) => ({
      issue_key: createCurriculumCoverageIssueKey(issue),
      ...issue,
    })),
  });
}

function buildReconcilerRepairPrompt(input: {
  subject: string;
  topic: string;
  description: string;
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
  structure: StructureValidatorOutput;
  curriculum: CurriculumValidatorOutput;
  curriculumAuditStatus: CurriculumAuditStatus;
  invalidOutput: ReconcilerOutput;
  validationError: string;
}): string {
  return [
    buildValidatorGraphPayload(input),
    "Structure validator output:",
    serializeJson({
      valid: input.structure.valid,
      issues: input.structure.issues.map((issue) => ({
        issue_key: createStructureCoverageIssueKey(issue),
        ...issue,
      })),
    }),
    "Curriculum validator output:",
    serializeCurriculumOutputForPrompt({
      curriculum: input.curriculum,
      curriculumAuditStatus: input.curriculumAuditStatus,
    }),
    "Invalid reconciler output:",
    serializeJson(input.invalidOutput),
    "Deterministic validation failure to fix:",
    input.validationError,
  ].join("\n\n");
}

function assertReconcilerOutput(
  output: ReconcilerOutput,
  input?: {
    subject: string;
    topic: string;
    description: string;
    structure: StructureValidatorOutput;
    curriculum: CurriculumValidatorOutput;
    curriculumAuditStatus: CurriculumAuditStatus;
  } & CanonicalBoundaryFields,
): void {
  output.nodes = assertGraphDraftInvariants(output.nodes, output.edges, "reconcile");
    if (input) {
      const finalStructureValidation = runDeterministicStructureValidation({
        nodes: output.nodes,
        edges: output.edges,
      });
    if (finalStructureValidation.issues.length > 0) {
      throw new ApiError(
        "LLM_CONTRACT_VIOLATION",
        "reconcile failed deterministic validation: final graph still has unresolved structure issues.",
        502,
        {
          issue_keys: finalStructureValidation.issues.map(createStructureCoverageIssueKey),
        },
      );
    }
    assertResolutionSummaryCoverage(output, input);
    assertCanonicalBoundaryInvariants(output.nodes, {
      prerequisites: input.prerequisites,
      downstream_topics: input.downstream_topics,
    });
  }
}

export async function runGraphGenerator(
  input: GraphContextInput,
  context?: RequestLogContext,
  dependencies: GraphStageDependencies<{ nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] }> = {},
): Promise<{ nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] }> {
  const output = await executeLlmStage({
    stage: "graph_generate",
    systemPrompt: buildGraphGeneratorSystemPrompt(),
    userPrompt: [
      "Generate a knowledge dependency graph for the following concept.",
      `Subject: ${input.subject}`,
      `Topic: ${input.topic}`,
      `Description: ${input.description}`,
    ].join("\n"),
    schema: generationGraphDraftSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs: GRAPH_GENERATOR_TIMEOUT_MS,
    maxTokens: GRAPH_GENERATOR_MAX_TOKENS,
    temperature: 0.2,
    context,
    dependencies,
  });

  return normalizeGraphDraftDeterministically(
    output.nodes,
    output.edges,
    "graph_generate",
  );
}

export async function runStructureValidator(
  input: GraphContextInput & { nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] },
  context?: RequestLogContext,
  dependencies: GraphStageDependencies<StructureValidatorOutput> = {},
): Promise<StructureValidatorOutput> {
  const deterministicOutput = runDeterministicStructureValidation(input);
  const logContext =
    context ??
    ({
      requestId: "structure_validate",
      route: "structure_validate",
      startedAtMs: Date.now(),
    } satisfies RequestLogContext);

  if (!dependencies.callModel) {
    logInfo(
      logContext,
      "structure_validate",
      "success",
      "Structure validation completed with deterministic server checks.",
      {
        audit_mode: "deterministic_only",
        issue_count: deterministicOutput.issues.length,
      },
    );
    return deterministicOutput;
  }

  const rawOutput = await executeLlmStage({
    stage: "structure_validate",
    systemPrompt: buildStructureValidatorSystemPrompt(),
    userPrompt: buildValidatorGraphPayload(input),
    schema: structureValidatorModelOutputSchema,
    failureCategory: "llm_contract_violation",
    timeoutMs: STRUCTURE_VALIDATOR_TIMEOUT_MS,
    maxTokens: STRUCTURE_VALIDATOR_MAX_TOKENS,
    temperature: 0,
    context,
    dependencies,
  });

  const modelOutput = normalizeStructureValidatorOutput(rawOutput);
  assertValidatorNodeReferences(input.nodes, modelOutput, "structure_validate");

  const mergedOutput = structureValidatorOutputSchema.parse({
    valid: deterministicOutput.issues.length === 0 && modelOutput.issues.length === 0,
    issues: mergeStructureIssues(deterministicOutput.issues, modelOutput.issues),
  });

  logInfo(
    logContext,
    "structure_validate",
    "success",
    "Structure validation completed with deterministic checks and optional model audit.",
    {
      audit_mode: "deterministic_plus_model",
      deterministic_issue_count: deterministicOutput.issues.length,
      model_issue_count: modelOutput.issues.length,
      merged_issue_count: mergedOutput.issues.length,
    },
  );

  return mergedOutput;
}

export async function runCurriculumValidator(
  input: GraphContextInput & { nodes: GenerationNodeDraft[]; edges: GenerationEdgeDraft[] },
  context?: RequestLogContext,
  dependencies: GraphStageDependencies<CurriculumValidatorOutput> = {},
  options: {
    executionMode?: "sync" | "detached";
  } = {},
): Promise<CurriculumAuditResult> {
  const logContext =
    context ??
    ({
      requestId: "curriculum_validate",
      route: "curriculum_validate",
      startedAtMs: Date.now(),
    } satisfies RequestLogContext);
  const startedAtMs = Date.now();
  const asyncAudit = options.executionMode === "detached";
  const maxAttempts = asyncAudit ? 1 : 2;
  const stage = asyncAudit ? "curriculum_audit" : "curriculum_validate";

  try {
    const rawOutput = await executeLlmStage({
      stage,
      systemPrompt: buildCurriculumValidatorSystemPrompt(),
      userPrompt: buildCurriculumValidatorPayload(input),
      schema: curriculumValidatorModelOutputSchema,
      failureCategory: "llm_contract_violation",
      timeoutMs: CURRICULUM_VALIDATOR_TIMEOUT_MS,
      maxTokens: CURRICULUM_VALIDATOR_MAX_TOKENS,
      temperature: 0,
      maxAttempts,
      context,
      dependencies,
    });

    const output = normalizeCurriculumValidatorOutput(rawOutput);
    assertValidatorNodeReferences(input.nodes, output, stage);
    const outcomeBucket = curriculumOutcomeBucketSchema.parse(
      deriveCurriculumOutcomeBucket({
        curriculum: output,
        curriculumAuditStatus: curriculumAuditStatusSchema.parse("accepted"),
      }),
    );

    logInfo(
      logContext,
      stage,
      "success",
      asyncAudit
        ? "Curriculum audit completed asynchronously."
        : "Curriculum validation completed.",
      {
        audit_mode: "accepted",
        curriculum_audit_phase: asyncAudit ? "async_complete" : "sync_complete",
        curriculum_outcome_bucket: outcomeBucket,
        attempt_count: maxAttempts,
        final_failure_category: null,
        parse_error_summary: null,
        failure_subtype: null,
        issue_count: output.issues.length,
        duration_ms: Date.now() - startedAtMs,
        async_audit: asyncAudit,
      },
    );

    return {
      output,
      auditStatus: curriculumAuditStatusSchema.parse("accepted"),
      outcomeBucket,
      attemptCount: maxAttempts,
      finalFailureCategory: null,
      parseErrorSummary: null,
      failureSubtype: null,
      durationMs: Date.now() - startedAtMs,
      asyncAudit,
    };
  } catch (error) {
    const isTimeout = error instanceof ApiError && error.code === "UPSTREAM_TIMEOUT";
    const auditStatus = isTimeout
      ? curriculumAuditStatusSchema.parse("skipped_timeout")
      : curriculumAuditStatusSchema.parse("skipped_contract_failure");
    const finalFailureCategory: GenerationFailureCategory = isTimeout
      ? "upstream_timeout"
      : "llm_contract_violation";
    const parseErrorSummary =
      error instanceof ApiError && typeof error.details === "string"
        ? error.details
        : error instanceof Error
          ? error.message
          : String(error);
    const failureSubtype = deriveCurriculumFailureSubtype(error, isTimeout);
    const outcomeBucket = curriculumOutcomeBucketSchema.parse(
      deriveCurriculumOutcomeBucket({
        curriculum: createEmptyCurriculumValidatorOutput(),
        curriculumAuditStatus: auditStatus,
      }),
    );

    logError(
      logContext,
      stage,
      asyncAudit
        ? "Curriculum audit failed asynchronously; continuing without accepted curriculum findings."
        : "Curriculum validation failed; continuing without accepted curriculum findings.",
      error,
      {
        audit_mode: auditStatus,
        curriculum_audit_phase: asyncAudit ? "async_complete" : "sync_complete",
        curriculum_outcome_bucket: outcomeBucket,
        attempt_count: maxAttempts,
        final_failure_category: finalFailureCategory,
        parse_error_summary: parseErrorSummary,
        failure_subtype: failureSubtype,
        duration_ms: Date.now() - startedAtMs,
        async_audit: asyncAudit,
      },
    );

    return {
      output: createEmptyCurriculumValidatorOutput(),
      auditStatus,
      outcomeBucket,
      attemptCount: maxAttempts,
      finalFailureCategory,
      parseErrorSummary,
      failureSubtype,
      durationMs: Date.now() - startedAtMs,
      asyncAudit,
    };
  }
}

export async function runReconciler(
  input: GraphContextInput & {
    nodes: GenerationNodeDraft[];
    edges: GenerationEdgeDraft[];
    structure: StructureValidatorOutput;
    curriculum: CurriculumValidatorOutput;
    curriculumAuditStatus: CurriculumAuditStatus;
  },
  context?: RequestLogContext,
  dependencies: GraphStageDependencies<ReconcilerOutput> = {},
): Promise<ReconcilerRunOutput> {
  const logContext =
    context ??
    ({
      requestId: "reconcile",
      route: "reconcile",
      startedAtMs: Date.now(),
    } satisfies RequestLogContext);

  const locallyRepairedGraph = applyDeterministicStructureRepairs(
    input.nodes,
    input.edges,
    input.structure.issues,
  );
  const remainingStructure = runDeterministicStructureValidation({
    nodes: locallyRepairedGraph.nodes,
    edges: locallyRepairedGraph.edges,
  });

  const remainingStructureIssueKeys = new Set(
    remainingStructure.issues.map(createStructureCoverageIssueKey),
  );
  const deterministicResolutionSummary = input.structure.issues
    .filter(
      (issue) => !remainingStructureIssueKeys.has(createStructureCoverageIssueKey(issue)),
    )
    .map((issue) => ({
      issue_key: createStructureCoverageIssueKey(issue),
      issue_source: "structure_validator" as const,
      issue_description: issue.description,
      resolution_action: createDeterministicResolutionAction(issue),
    }));

  if (remainingStructure.issues.length === 0 && input.curriculum.issues.length === 0) {
    const deterministicRepairApplied = input.structure.issues.length > 0;
    const deterministicOutput = reconcilerOutputSchema.parse({
      nodes: locallyRepairedGraph.nodes,
      edges: locallyRepairedGraph.edges,
      resolution_summary: deterministicResolutionSummary,
    });
    assertReconcilerOutput(deterministicOutput, {
      description: input.description,
      subject: input.subject,
      topic: input.topic,
      structure: remainingStructure,
      curriculum: input.curriculum,
      curriculumAuditStatus: input.curriculumAuditStatus,
      prerequisites: input.prerequisites,
      downstream_topics: input.downstream_topics,
    });
    const fastPathMessage =
      deterministicRepairApplied
        ? "Reconcile completed with deterministic local repair only."
        : "Reconcile completed with deterministic local repair only.";
    logInfo(
      logContext,
      "reconcile",
      "success",
      fastPathMessage,
      {
        repair_mode: deterministicRepairApplied
          ? "deterministic_only_repaired"
          : "deterministic_only",
        curriculum_audit_status: input.curriculumAuditStatus,
        resolution_count: deterministicOutput.resolution_summary.length,
      },
    );
    return {
      ...deterministicOutput,
      repair_mode: graphReconciliationModeSchema.parse(
        deterministicRepairApplied ? "deterministic_only_repaired" : "deterministic_only",
      ),
    };
  }

  const reconcilerInput = {
    ...input,
    nodes: locallyRepairedGraph.nodes,
    edges: locallyRepairedGraph.edges,
    structure: remainingStructure,
  };

  const output = await executeLlmStage({
    stage: "reconcile",
    systemPrompt: buildReconcilerSystemPrompt(),
    userPrompt: [
      buildValidatorGraphPayload(reconcilerInput),
      "Structure validator output:",
      serializeJson({
        valid: remainingStructure.valid,
        issues: remainingStructure.issues.map((issue) => ({
          issue_key: createStructureCoverageIssueKey(issue),
          ...issue,
        })),
      }),
      "Curriculum validator output:",
      serializeCurriculumOutputForPrompt({
        curriculum: input.curriculum,
        curriculumAuditStatus: input.curriculumAuditStatus,
      }),
      "Deterministic resolutions already applied:",
      serializeJson(deterministicResolutionSummary),
    ].join("\n\n"),
    schema: reconcilerOutputSchema,
    failureCategory: "llm_contract_violation",
    timeoutMs: RECONCILER_TIMEOUT_MS,
    maxTokens: RECONCILER_MAX_TOKENS,
    temperature: 0,
    context,
    dependencies,
  });

  const combinedOutput = reconcilerOutputSchema.parse({
    nodes: output.nodes,
    edges: output.edges,
    resolution_summary: [
      ...deterministicResolutionSummary,
      ...output.resolution_summary,
    ],
  });

  try {
      assertReconcilerOutput(combinedOutput, {
        description: input.description,
        subject: input.subject,
        topic: input.topic,
        structure: remainingStructure,
        curriculum: input.curriculum,
        curriculumAuditStatus: input.curriculumAuditStatus,
        prerequisites: input.prerequisites,
        downstream_topics: input.downstream_topics,
      });
      return {
        ...combinedOutput,
        repair_mode: graphReconciliationModeSchema.parse("llm_reconcile"),
      };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }

    logError(
      logContext,
      "reconcile",
      "reconcile returned an invalid graph; attempting targeted structural repair.",
      error,
      {
        invalid_output: {
          nodes: combinedOutput.nodes,
          edges: combinedOutput.edges,
          resolution_summary: combinedOutput.resolution_summary,
        },
      },
    );

    const repairedOutput = await executeLlmStage({
      stage: "reconcile",
      systemPrompt: buildReconcilerRepairSystemPrompt(),
        userPrompt: buildReconcilerRepairPrompt({
          ...reconcilerInput,
          curriculum: input.curriculum,
          curriculumAuditStatus: input.curriculumAuditStatus,
          invalidOutput: combinedOutput,
          validationError: error.message,
        }),
      schema: reconcilerOutputSchema,
      failureCategory: "llm_contract_violation",
      timeoutMs: RECONCILER_TIMEOUT_MS,
      maxTokens: RECONCILER_MAX_TOKENS,
      temperature: 0,
      context,
      dependencies,
    });

    const combinedRepairedOutput = reconcilerOutputSchema.parse({
      nodes: repairedOutput.nodes,
      edges: repairedOutput.edges,
      resolution_summary: [
        ...deterministicResolutionSummary,
        ...repairedOutput.resolution_summary,
      ],
    });

    try {
        assertReconcilerOutput(combinedRepairedOutput, {
          description: input.description,
          subject: input.subject,
          topic: input.topic,
          structure: remainingStructure,
          curriculum: input.curriculum,
          curriculumAuditStatus: input.curriculumAuditStatus,
          prerequisites: input.prerequisites,
          downstream_topics: input.downstream_topics,
        });
        return {
          ...combinedRepairedOutput,
          repair_mode: graphReconciliationModeSchema.parse("repair_fallback"),
        };
    } catch (repairError) {
      if (repairError instanceof ApiError) {
        throw new ApiError(
          "REPAIR_EXHAUSTED",
          "reconcile returned an invalid graph after targeted structural repair.",
          502,
          {
            initial_error: error.message,
            repair_error: repairError.message,
            invalid_output: combinedRepairedOutput,
          },
        );
      }

      throw repairError;
    }
  }
}
