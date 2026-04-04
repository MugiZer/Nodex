import type { RequestLogContext } from "@/lib/logging";
import type {
  CanonicalizeSuccess,
  GenerationEdgeDraft,
  GenerationNodeDraft,
} from "@/lib/types";

import { ApiError } from "@/lib/errors";
import {
  diagnosticNodeArtifactSchema,
  generatedGraphArtifactSchema,
  lessonNodeArtifactSchema,
  visualNodeArtifactSchema,
  type DiagnosticNodeArtifact,
  type DiagnosticStageOutput,
  type GeneratedGraphArtifact,
  type LessonNodeArtifact,
  type LessonStageOutput,
  type VisualNodeArtifact,
  type VisualStageOutput,
} from "../contracts";
import { buildDeterministicVisualArtifact } from "../visual-templates";
import { executeLlmStage, type LlmStageDependencies } from "../llm-stage";
import { computeStageTimeout } from "../timeout-model";

const CONTENT_STAGE_CONCURRENCY = 3;
const LESSON_NODE_MAX_TOKENS = 1800;
const DIAGNOSTIC_NODE_MAX_TOKENS = 400;
const VISUAL_NODE_MAX_TOKENS = 2500;

export const LESSON_TIMEOUT_MS = computeStageTimeout(LESSON_NODE_MAX_TOKENS);
export const DIAGNOSTIC_TIMEOUT_MS = computeStageTimeout(DIAGNOSTIC_NODE_MAX_TOKENS);
export const VISUAL_TIMEOUT_MS = computeStageTimeout(VISUAL_NODE_MAX_TOKENS);

type LessonStageDependencies = LlmStageDependencies<LessonNodeArtifact>;
type DiagnosticStageDependencies = LlmStageDependencies<DiagnosticNodeArtifact>;
type VisualStageDependencies = LlmStageDependencies<VisualNodeArtifact>;

type GraphStageBaseInput = CanonicalizeSuccess & {
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
};

type LessonGraphInput = GraphStageBaseInput;
type DiagnosticGraphInput = GraphStageBaseInput;
type VisualGraphInput = CanonicalizeSuccess & {
  nodes: GenerationNodeDraft[];
};

function assertNodeCoverage(
  stage: string,
  graphNodes: GenerationNodeDraft[],
  artifactNodeIds: string[],
): void {
  const expectedNodeIds = [...graphNodes]
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  const actualNodeIds = [...artifactNodeIds].sort((left, right) => left.localeCompare(right));

  if (expectedNodeIds.length !== actualNodeIds.length) {
    throw new ApiError(
      "LLM_CONTRACT_VIOLATION",
      `${stage} returned the wrong number of nodes.`,
      502,
      {
        expected: expectedNodeIds.length,
        actual: actualNodeIds.length,
      },
    );
  }

  for (let index = 0; index < expectedNodeIds.length; index += 1) {
    if (expectedNodeIds[index] !== actualNodeIds[index]) {
      throw new ApiError(
        "LLM_CONTRACT_VIOLATION",
        `${stage} must return exactly one artifact payload for each graph node.`,
        502,
        {
          expected: expectedNodeIds,
          actual: actualNodeIds,
        },
      );
    }
  }
}

function getHardPrerequisiteTitles(
  nodeId: string,
  nodes: GenerationNodeDraft[],
  edges: GenerationEdgeDraft[],
): string[] {
  const titleById = new Map(nodes.map((node) => [node.id, node.title]));
  return edges
    .filter((edge) => edge.type === "hard" && edge.to_node_id === nodeId)
    .map((edge) => titleById.get(edge.from_node_id))
    .filter((title): title is string => Boolean(title))
    .sort((left, right) => left.localeCompare(right));
}

function buildLessonSystemPrompt(): string {
  return [
    "You are the Foundation lesson generator for a single node.",
    "Return only raw JSON.",
    "Generate lesson_text, static_diagram, and quiz_json for the provided node.",
    "Keep lesson_text concise and focused, roughly 140 to 220 words.",
    "Keep static_diagram minimal: a compact SVG with only the elements needed to explain the idea.",
    "Do not include line breaks, markdown fences, or unnecessary escaping inside JSON strings.",
    "quiz_json must contain exactly 3 multiple-choice items with 4 options, a correct_index from 0 to 3, and an explanation.",
    "static_diagram must be an SVG string that can act as the non-interactive fallback visual.",
    "The lesson must be self-contained relative to the listed hard prerequisites and focused only on the node concept.",
    "Output schema: {\"id\":\"node_1\",\"lesson_text\":\"...\",\"static_diagram\":\"<svg ...>\",\"quiz_json\":[...]}",
  ].join(" ");
}

function buildDiagnosticsSystemPrompt(): string {
  return [
    "You are the Foundation diagnostic generator for a single node.",
    "Return only raw JSON.",
    "Generate exactly one diagnostic question for adaptive placement.",
    "This is not the mastery quiz. Use the question to distinguish 'understands this node' from 'does not yet understand this node'.",
    "Target the node's central concept, not downstream applications. Do not test assumed prior knowledge or downstream topics.",
    "Avoid trick wording and unnecessary computation unless the node itself is procedural. Do not create mastery-style mini-exams.",
    "The diagnostic question must include 4 options, correct_index, difficulty_order, and node_id matching the provided node id.",
    "Questions must be short and discriminative, focused on the node's central concept.",
    "Output schema: {\"id\":\"node_1\",\"diagnostic_questions\":[{\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct_index\":0,\"difficulty_order\":1,\"node_id\":\"node_1\"}]}",
  ].join(" ");
}

function buildLessonUserPrompt(
  input: LessonGraphInput,
  node: GenerationNodeDraft,
): string {
  const prerequisiteTitles = getHardPrerequisiteTitles(node.id, input.nodes, input.edges);
  return [
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    `Description: ${input.description}`,
    `Node id: ${node.id}`,
    `Node title: ${node.title}`,
    `Node position: ${node.position}`,
    `Hard prerequisites: ${
      prerequisiteTitles.length > 0 ? prerequisiteTitles.join(", ") : "none"
    }`,
  ].join("\n\n");
}

function buildDiagnosticUserPrompt(
  input: DiagnosticGraphInput,
  node: GenerationNodeDraft,
): string {
  return [
    `Subject: ${input.subject}`,
    `Topic: ${input.topic}`,
    `Description: ${input.description}`,
    `Node id: ${node.id}`,
    `Node title: ${node.title}`,
    `Node position: ${node.position}`,
  ].join("\n\n");
}

async function mapNodesWithConcurrency<TOutput>(input: {
  nodes: GenerationNodeDraft[];
  concurrency: number;
  worker: (node: GenerationNodeDraft) => Promise<TOutput>;
}): Promise<TOutput[]> {
  const results = new Array<TOutput>(input.nodes.length);
  let nextIndex = 0;
  let aborted = false;
  let firstError: unknown = null;

  async function runWorker(): Promise<void> {
    while (!aborted && nextIndex < input.nodes.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await input.worker(input.nodes[currentIndex]!);
      } catch (error) {
        aborted = true;
        firstError ??= error;
        return;
      }
    }
  }

  const workerCount = Math.min(input.concurrency, input.nodes.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  if (firstError !== null) {
    throw firstError;
  }

  return results;
}

export async function runLessonStage(
  input: LessonGraphInput,
  context?: RequestLogContext,
  dependencies: LessonStageDependencies = {},
): Promise<LessonStageOutput> {
  const nodes = await mapNodesWithConcurrency({
    nodes: input.nodes,
    concurrency: CONTENT_STAGE_CONCURRENCY,
    worker: async (node) =>
      executeLlmStage({
        stage: "lessons",
        systemPrompt: buildLessonSystemPrompt(),
        userPrompt: buildLessonUserPrompt(input, node),
        schema: lessonNodeArtifactSchema,
        failureCategory: "llm_output_invalid",
        timeoutMs: LESSON_TIMEOUT_MS,
        maxTokens: LESSON_NODE_MAX_TOKENS,
        context,
        logDetails: {
          node_id: node.id,
          node_title: node.title,
          node_position: node.position,
        },
        dependencies,
      }),
  });

  assertNodeCoverage(
    "lessons",
    input.nodes,
    nodes.map((node) => node.id),
  );

  return { nodes };
}

export async function runDiagnosticStage(
  input: DiagnosticGraphInput,
  context?: RequestLogContext,
  dependencies: DiagnosticStageDependencies = {},
): Promise<DiagnosticStageOutput> {
  const nodes = await mapNodesWithConcurrency({
    nodes: input.nodes,
    concurrency: CONTENT_STAGE_CONCURRENCY,
    worker: async (node) =>
      executeLlmStage({
        stage: "diagnostics",
        systemPrompt: buildDiagnosticsSystemPrompt(),
        userPrompt: buildDiagnosticUserPrompt(input, node),
        schema: diagnosticNodeArtifactSchema,
        failureCategory: "llm_output_invalid",
        timeoutMs: DIAGNOSTIC_TIMEOUT_MS,
        maxTokens: DIAGNOSTIC_NODE_MAX_TOKENS,
        context,
        logDetails: {
          node_id: node.id,
          node_title: node.title,
          node_position: node.position,
        },
        dependencies,
      }),
  });

  assertNodeCoverage(
    "diagnostics",
    input.nodes,
    nodes.map((node) => node.id),
  );

  return { nodes };
}

export async function runVisualStage(
  input: VisualGraphInput,
  context?: RequestLogContext,
  dependencies: VisualStageDependencies = {},
): Promise<VisualStageOutput> {
  const nodes = await mapNodesWithConcurrency({
    nodes: input.nodes,
    concurrency: CONTENT_STAGE_CONCURRENCY,
    worker: async (node) =>
      buildDeterministicVisualArtifact({
        subject: input.subject,
        topic: input.topic,
        node,
      }),
  });

  assertNodeCoverage(
    "visuals",
    input.nodes,
    nodes.map((node) => node.id),
  );

  return { nodes };
}

export function assembleGeneratedGraphArtifacts(input: {
  nodes: GenerationNodeDraft[];
  edges: GenerationEdgeDraft[];
  lessons: LessonStageOutput;
  diagnostics: DiagnosticStageOutput;
  visuals: VisualStageOutput;
}): GeneratedGraphArtifact {
  const lessonMap = new Map(input.lessons.nodes.map((node) => [node.id, node]));
  const diagnosticMap = new Map(
    input.diagnostics.nodes.map((node) => [node.id, node]),
  );
  const visualMap = new Map(input.visuals.nodes.map((node) => [node.id, node]));

  const assembled = {
    nodes: input.nodes.map((node) => {
      const lesson = lessonMap.get(node.id);
      const diagnostic = diagnosticMap.get(node.id);
      const visual = visualMap.get(node.id);

      if (!lesson || !diagnostic || !visual) {
        throw new Error(`Missing generated artifacts for node ${node.id}.`);
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
    edges: input.edges,
  };

  return generatedGraphArtifactSchema.parse(assembled);
}
