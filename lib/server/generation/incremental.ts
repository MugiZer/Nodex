import { z } from "zod";

import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo, logWarn } from "@/lib/logging";
import type { Node, QuizItem, DiagnosticQuestion } from "@/lib/types";
import { diagnosticQuestionSchema, quizItemSchema } from "@/lib/schemas";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";

import { executeLlmStage, type LlmStageDependencies } from "./llm-stage";
import { updateStoredNode, type StoreGraphDependencies } from "./store";
import { computeStageTimeout } from "./timeout-model";

type GraphRecord = {
  id: string;
  subject: string;
  topic: string;
  description: string;
};

type SkeletonNode = Node;

type SkeletonEdge = {
  from_node_id: string;
  to_node_id: string;
  type: "hard" | "soft";
};

const lessonArtifactSchema = z
  .object({
    lesson_text: z.string().trim().min(1),
    static_diagram: z.string().trim().min(1),
    quiz_json: z.tuple([quizItemSchema, quizItemSchema, quizItemSchema]),
  })
  .strict();

const diagnosticArtifactSchema = z
  .object({
    diagnostic_questions: z.tuple([diagnosticQuestionSchema]),
  })
  .strict();

const visualArtifactSchema = z
  .object({
    p5_code: z.string(),
    visual_verified: z.boolean(),
  })
  .strict();

type LessonArtifact = z.infer<typeof lessonArtifactSchema>;
type DiagnosticArtifact = z.infer<typeof diagnosticArtifactSchema>;
type VisualArtifact = z.infer<typeof visualArtifactSchema>;

const LESSON_MAX_TOKENS = 6000;
const DIAGNOSTIC_MAX_TOKENS = 2200;
const VISUAL_MAX_TOKENS = 2600;

type NodeStageDependencies<TOutput> = LlmStageDependencies<TOutput>;

export type IncrementalEnrichmentDependencies = StoreGraphDependencies & {
  createServiceClient?: () => FoundationSupabaseClient;
  lessonDependencies?: NodeStageDependencies<LessonArtifact>;
  diagnosticDependencies?: NodeStageDependencies<DiagnosticArtifact>;
  visualDependencies?: NodeStageDependencies<VisualArtifact>;
  onNodeTransition?: (event: {
    graph_id: string;
    node_id: string;
    event: "selected" | "started" | "ready" | "failed";
  }) => void | Promise<void>;
};

export type IncrementalEnrichmentResult = {
  graph_id: string;
  request_id: string;
  selected_node_ids: string[];
  processed_node_ids: string[];
  ready_node_ids: string[];
  failed_node_ids: string[];
  remaining_pending_node_ids: string[];
};

function getServiceClient(
  dependencies: IncrementalEnrichmentDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

async function loadGraphSkeleton(
  graphId: string,
  dependencies: IncrementalEnrichmentDependencies,
): Promise<{ graph: GraphRecord; nodes: SkeletonNode[]; edges: SkeletonEdge[] }> {
  const client = getServiceClient(dependencies);

  const { data: graph, error: graphError } = await client
    .from("graphs")
    .select("id,subject,topic,description")
    .eq("id", graphId)
    .maybeSingle();

  if (graphError) {
    throw new ApiError("GRAPH_READ_FAILED", "Failed to load graph metadata for enrichment.", 503, {
      graph_id: graphId,
      cause: graphError.message,
    });
  }

  if (!graph) {
    throw new ApiError("GRAPH_NOT_FOUND", "The graph to enrich does not exist.", 404, {
      graph_id: graphId,
    });
  }

  const { data: nodes, error: nodeError } = await client
    .from("nodes")
    .select(
      "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,lesson_status,position,attempt_count,pass_count",
    )
    .eq("graph_id", graphId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (nodeError) {
    throw new ApiError("GRAPH_READ_FAILED", "Failed to load nodes for enrichment.", 503, {
      graph_id: graphId,
      cause: nodeError.message,
    });
  }

  const { data: edges, error: edgeError } = await client
    .from("edges")
    .select("from_node_id,to_node_id,type")
    .in("from_node_id", (nodes ?? []).map((node) => node.id))
    .in("to_node_id", (nodes ?? []).map((node) => node.id));

  if (edgeError) {
    throw new ApiError("GRAPH_READ_FAILED", "Failed to load edges for enrichment.", 503, {
      graph_id: graphId,
      cause: edgeError.message,
    });
  }

  return {
    graph: graph as GraphRecord,
    nodes: (nodes ?? []) as SkeletonNode[],
    edges: (edges ?? []) as SkeletonEdge[],
  };
}

function compareNodes(left: Pick<SkeletonNode, "position" | "title" | "id">, right: Pick<SkeletonNode, "position" | "title" | "id">): number {
  if (left.position !== right.position) {
    return left.position - right.position;
  }

  const titleComparison = left.title.localeCompare(right.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return left.id.localeCompare(right.id);
}

export function selectInitialLearningSlice(
  nodes: SkeletonNode[],
  edges: SkeletonEdge[],
  limit = 4,
): string[] {
  const hardEdges = edges.filter((edge) => edge.type === "hard");
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incomingCounts = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const successors = new Map<string, SkeletonNode[]>();

  for (const edge of hardEdges) {
    incomingCounts.set(edge.to_node_id, (incomingCounts.get(edge.to_node_id) ?? 0) + 1);
    const successor = nodeMap.get(edge.to_node_id);
    if (!successor) {
      continue;
    }
    const current = successors.get(edge.from_node_id) ?? [];
    current.push(successor);
    current.sort(compareNodes);
    successors.set(edge.from_node_id, current);
  }

  const roots = [...nodes]
    .filter((node) => (incomingCounts.get(node.id) ?? 0) === 0)
    .sort(compareNodes);
  const selected: string[] = [];
  const seen = new Set<string>();
  let current: SkeletonNode | null = roots[0] ?? null;

  while (current && selected.length < limit && !seen.has(current.id)) {
    selected.push(current.id);
    seen.add(current.id);
    current = (successors.get(current.id) ?? []).find((node) => !seen.has(node.id)) ?? null;
  }

  return selected;
}

function getHardPrerequisiteTitles(
  nodeId: string,
  nodes: SkeletonNode[],
  edges: SkeletonEdge[],
): string[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node.title]));
  return edges
    .filter((edge) => edge.type === "hard" && edge.to_node_id === nodeId)
    .map((edge) => nodeMap.get(edge.from_node_id))
    .filter((title): title is string => Boolean(title))
    .sort((left, right) => left.localeCompare(right));
}

function buildLessonPrompt(input: {
  graph: GraphRecord;
  node: SkeletonNode;
  prerequisiteTitles: string[];
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You are the Foundation lesson generator for a single node.",
      "Return only raw JSON.",
      "Generate lesson_text, static_diagram, and quiz_json.",
      "lesson_text must teach only this node at the appropriate scope.",
      "static_diagram must be an SVG fallback.",
      "quiz_json must contain exactly 3 multiple-choice questions with 4 options and explanations.",
    ].join(" "),
    userPrompt: [
      `Subject: ${input.graph.subject}`,
      `Topic: ${input.graph.topic}`,
      `Description: ${input.graph.description}`,
      `Node title: ${input.node.title}`,
      `Node position: ${input.node.position}`,
      `Hard prerequisites: ${
        input.prerequisiteTitles.length > 0
          ? input.prerequisiteTitles.join(", ")
          : "none"
      }`,
    ].join("\n\n"),
  };
}

function buildDiagnosticPrompt(input: {
  graph: GraphRecord;
  node: SkeletonNode;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You are the Foundation diagnostic generator for a single node.",
      "Return only raw JSON.",
      "Generate exactly one short adaptive diagnostic question for this node.",
      "The node_id in diagnostic_questions must match the provided node id.",
    ].join(" "),
    userPrompt: [
      `Subject: ${input.graph.subject}`,
      `Topic: ${input.graph.topic}`,
      `Node id: ${input.node.id}`,
      `Node title: ${input.node.title}`,
    ].join("\n\n"),
  };
}

function buildVisualPrompt(input: {
  graph: GraphRecord;
  node: SkeletonNode;
  conceptDescription: string;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You are the Foundation visual generator for a single node.",
      "Return only raw JSON.",
      "Generate an interactive p5 sketch only when it materially improves intuition.",
      "If a trustworthy sketch is not appropriate, return visual_verified false and empty p5_code.",
      "Verified sketches must define setup, draw, and createCanvas(480, 320).",
    ].join(" "),
    userPrompt: [
      `Subject: ${input.graph.subject}`,
      `Topic: ${input.graph.topic}`,
      `Node title: ${input.node.title}`,
      `Concept description: ${input.conceptDescription}`,
    ].join("\n\n"),
  };
}

function summarizeConcept(lessonText: string, nodeTitle: string): string {
  const [firstSentence] = lessonText
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return firstSentence ?? `${nodeTitle} teaches the central concept for this node.`;
}

async function emitTransition(
  dependencies: IncrementalEnrichmentDependencies,
  event: {
    graph_id: string;
    node_id: string;
    event: "selected" | "started" | "ready" | "failed";
  },
): Promise<void> {
  await dependencies.onNodeTransition?.(event);
}

async function generateSingleNodeLesson(
  graph: GraphRecord,
  node: SkeletonNode,
  edges: SkeletonEdge[],
  nodes: SkeletonNode[],
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies,
): Promise<LessonArtifact> {
  const prompt = buildLessonPrompt({
    graph,
    node,
    prerequisiteTitles: getHardPrerequisiteTitles(node.id, nodes, edges),
  });

  return executeLlmStage({
    stage: "lessons",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: lessonArtifactSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs: computeStageTimeout(LESSON_MAX_TOKENS),
    maxTokens: LESSON_MAX_TOKENS,
    context,
    dependencies: dependencies.lessonDependencies,
  });
}

async function generateSingleNodeDiagnostic(
  graph: GraphRecord,
  node: SkeletonNode,
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies,
): Promise<DiagnosticArtifact> {
  const prompt = buildDiagnosticPrompt({ graph, node });
  const result = await executeLlmStage({
    stage: "diagnostics",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: diagnosticArtifactSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs: computeStageTimeout(DIAGNOSTIC_MAX_TOKENS),
    maxTokens: DIAGNOSTIC_MAX_TOKENS,
    context,
    dependencies: dependencies.diagnosticDependencies,
  });

  if (result.diagnostic_questions[0].node_id !== node.id) {
    throw new ApiError(
      "DIAGNOSTICS_NODE_MISMATCH",
      "Diagnostics question node_id must match the persisted node id.",
      502,
      { node_id: node.id, diagnostic_node_id: result.diagnostic_questions[0].node_id },
    );
  }

  return result;
}

async function generateSingleNodeVisual(
  graph: GraphRecord,
  node: SkeletonNode,
  conceptDescription: string,
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies,
): Promise<VisualArtifact> {
  const prompt = buildVisualPrompt({ graph, node, conceptDescription });

  return executeLlmStage({
    stage: "visuals",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: visualArtifactSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs: computeStageTimeout(VISUAL_MAX_TOKENS),
    maxTokens: VISUAL_MAX_TOKENS,
    context,
    dependencies: dependencies.visualDependencies,
  });
}

function collectPendingNodeIds(nodes: SkeletonNode[]): string[] {
  return nodes
    .filter((node) => node.lesson_status === "pending")
    .map((node) => node.id);
}

export async function runIncrementalGraphEnrichment(
  input: {
    graph_id: string;
    limit?: number;
    retry_failed?: boolean;
  },
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies = {},
): Promise<IncrementalEnrichmentResult> {
  const { graph, nodes, edges } = await loadGraphSkeleton(input.graph_id, dependencies);
  const selectedNodeIds = selectInitialLearningSlice(nodes, edges, input.limit ?? 4);

  logInfo(context, "enrich", "start", "Selected deterministic enrichment slice.", {
    graph_id: input.graph_id,
    selected_node_ids: selectedNodeIds,
    limit: input.limit ?? 4,
  });

  for (const nodeId of selectedNodeIds) {
    await emitTransition(dependencies, {
      graph_id: input.graph_id,
      node_id: nodeId,
      event: "selected",
    });
  }

  const readyNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const processedNodeIds: string[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const nodeId of selectedNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }

    if (node.lesson_status === "ready") {
      readyNodeIds.push(node.id);
      processedNodeIds.push(node.id);
      continue;
    }

    if (node.lesson_status === "failed" && !input.retry_failed) {
      failedNodeIds.push(node.id);
      processedNodeIds.push(node.id);
      continue;
    }

    await emitTransition(dependencies, {
      graph_id: input.graph_id,
      node_id: node.id,
      event: "started",
    });

    try {
      const lesson = await generateSingleNodeLesson(graph, node, edges, nodes, context, dependencies);
      const conceptDescription = summarizeConcept(lesson.lesson_text, node.title);
      const [diagnostic, visualResult] = await Promise.all([
        generateSingleNodeDiagnostic(graph, node, context, dependencies),
        generateSingleNodeVisual(graph, node, conceptDescription, context, dependencies)
          .catch((error) => {
            logWarn(context, "visuals", "success", "Visual generation fell back during incremental enrichment.", {
              graph_id: input.graph_id,
              node_id: node.id,
              error: error instanceof Error ? error.message : String(error),
            });
            return { p5_code: "", visual_verified: false };
          }),
      ]);

      const storedNode = await updateStoredNode(
        {
          graph_id: input.graph_id,
          node: {
            id: node.id,
            lesson_text: lesson.lesson_text,
            static_diagram: lesson.static_diagram,
            p5_code: visualResult.visual_verified ? visualResult.p5_code : null,
            visual_verified: visualResult.visual_verified,
            quiz_json: lesson.quiz_json,
            diagnostic_questions: diagnostic.diagnostic_questions,
            lesson_status: "ready",
          },
        },
        dependencies,
      );

      nodeMap.set(node.id, storedNode);
      readyNodeIds.push(node.id);
      processedNodeIds.push(node.id);
      await emitTransition(dependencies, {
        graph_id: input.graph_id,
        node_id: node.id,
        event: "ready",
      });

      logInfo(context, "enrich", "success", "Incremental node enrichment completed.", {
        graph_id: input.graph_id,
        node_id: node.id,
        lesson_status: storedNode.lesson_status,
      });
    } catch (error) {
      failedNodeIds.push(node.id);
      processedNodeIds.push(node.id);

      try {
        const storedNode = await updateStoredNode(
          {
            graph_id: input.graph_id,
            node: {
              id: node.id,
              lesson_text: null,
              static_diagram: null,
              p5_code: null,
              visual_verified: false,
              quiz_json: null,
              diagnostic_questions: null,
              lesson_status: "failed",
            },
          },
          dependencies,
        );
        nodeMap.set(node.id, storedNode);
      } catch (persistError) {
        logError(context, "store", "Failed to mark node enrichment failure.", persistError, {
          graph_id: input.graph_id,
          node_id: node.id,
        });
      }

      logError(context, "enrich", "Incremental node enrichment failed.", error, {
        graph_id: input.graph_id,
        node_id: node.id,
      });
      await emitTransition(dependencies, {
        graph_id: input.graph_id,
        node_id: node.id,
        event: "failed",
      });
    }
  }

  return {
    graph_id: input.graph_id,
    request_id: context.requestId,
    selected_node_ids: selectedNodeIds,
    processed_node_ids: processedNodeIds,
    ready_node_ids: readyNodeIds,
    failed_node_ids: failedNodeIds,
    remaining_pending_node_ids: collectPendingNodeIds([...nodeMap.values()]),
  };
}
