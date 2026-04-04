import { z } from "zod";

import { ApiError } from "@/lib/errors";
import { getAnthropicClient, getAnthropicModel } from "@/lib/anthropic";
import type { RequestLogContext } from "@/lib/logging";
import { logError, logInfo, logWarn } from "@/lib/logging";
import type {
  DiagnosticQuestion,
  FlagshipLesson,
  Node,
  QuizItem,
} from "@/lib/types";
import { diagnosticQuestionSchema, lessonStatusSchema, nodeSchema, quizItemSchema } from "@/lib/schemas";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";
import { detectDbSurfaceAvailable, STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE } from "@/lib/server/db-contract";

import { executeLlmStage, runWithTimeout, type LlmStageDependencies } from "./llm-stage";
import { updateStoredNode, type StoreGraphDependencies } from "./store";
import { computeStageTimeout } from "./timeout-model";

type GraphRecord = {
  id: string;
  subject: string;
  topic: string;
  description: string;
};

type SkeletonNode = Node;
type SkeletonNodeRow = Omit<Node, "lesson_status"> & {
  lesson_status?: Node["lesson_status"] | null;
};

type SkeletonEdge = {
  from_node_id: string;
  to_node_id: string;
  type: "hard" | "soft";
};

type InitialSliceNode = {
  id: string;
  is_lesson_bearing?: boolean;
};

type InitialSliceEdge = Pick<SkeletonEdge, "from_node_id" | "to_node_id" | "type">;

export type InitialSliceSelection = {
  flagship: string;
  standard: string[];
  pending: string[];
};

const lessonArtifactSchema = z
  .object({
    lesson_text: z.string().trim().min(1),
    static_diagram: z.string().trim().min(1).nullable().optional(),
    quiz_json: z.array(quizItemSchema).length(3).nullable().optional(),
  })
  .strict();

const diagnosticArtifactSchema = z
  .object({
    diagnostic_questions: z.array(diagnosticQuestionSchema).length(1),
  })
  .strict();

const visualArtifactSchema = z
  .object({
    p5_code: z.string(),
    visual_verified: z.boolean(),
  })
  .strict();

const flagshipLessonSchema = z
  .object({
    version: z.literal("flagship-v1"),
    predictionTrap: z
      .object({
        question: z.string().trim().min(1),
        obviousAnswer: z.string().trim().min(1),
        correctAnswer: z.string().trim().min(1),
        whyWrong: z.string().trim().min(1),
      })
      .strict(),
    guidedInsight: z
      .object({
        ground: z.string().trim().min(1),
        mechanism: z.string().trim().min(1),
        surprise: z.string().trim().min(1),
        reframe: z.string().trim().min(1),
      })
      .strict(),
    workedExample: z
      .object({
        setup: z.string().trim().min(1),
        naiveAttempt: z.string().trim().min(1),
        steps: z
          .array(
            z
              .object({
                action: z.string().trim().min(1),
                result: z.string().trim().min(1),
              })
              .strict(),
          )
          .min(3)
          .max(4),
        takeaway: z.string().trim().min(1),
      })
      .strict(),
    whatIf: z
      .object({
        question: z.string().trim().min(1),
        options: z
          .array(
            z
              .object({
                text: z.string().trim().min(1),
                isCorrect: z.boolean(),
                explanation: z.string().trim().min(1),
              })
              .strict(),
          )
          .length(3),
      })
      .strict(),
    masteryCheck: z
      .object({
        stem: z.string().trim().min(1),
        options: z
          .array(
            z
              .object({
                text: z.string().trim().min(1),
                isCorrect: z.boolean(),
                feedback: z.string().trim().min(1),
              })
              .strict(),
          )
          .length(4),
        forwardHook: z.string().trim().min(1),
      })
      .strict(),
    anchor: z
      .object({
        summary: z.string().trim().min(1),
        bridge: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.whatIf.options.filter((option) => option.isCorrect).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["whatIf", "options"],
        message: "Flagship whatIf must contain exactly one correct option.",
      });
    }

    if (value.masteryCheck.options.filter((option) => option.isCorrect).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["masteryCheck", "options"],
        message: "Flagship masteryCheck must contain exactly one correct option.",
      });
    }
  });

type LessonArtifact = z.infer<typeof lessonArtifactSchema>;
type DiagnosticArtifact = z.infer<typeof diagnosticArtifactSchema>;
type VisualArtifact = z.infer<typeof visualArtifactSchema>;
type FlagshipLessonModelUsage = {
  output_tokens: number;
};
type FlagshipLessonModelResult = {
  text: string;
  usage: FlagshipLessonModelUsage | null;
  stopReason?: string | null;
};
type FlagshipLessonDependencies = {
  callModel?: (args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
  }) => Promise<FlagshipLessonModelResult | string>;
};

const LESSON_MAX_TOKENS = 1800;
const DIAGNOSTIC_MAX_TOKENS = 400;
const VISUAL_MAX_TOKENS = 2600;
const FLAGSHIP_LESSON_MAX_TOKENS = 4000;
const FLAGSHIP_LESSON_TIMEOUT_MS = 60_000;
const FLAGSHIP_LESSON_MAX_ATTEMPTS = 1;
const ENRICHMENT_DEADLINE_MS = 90_000;
const MAX_NODE_ENRICHMENT_CONCURRENCY = 4;
const DEFAULT_MINIMUM_FALLBACK_BUDGET_MS = 10_000;
const DEFAULT_MINIMUM_FLAGSHIP_RETRY_BUDGET_MS = 15_000;

type NodeStageDependencies<TOutput> = LlmStageDependencies<TOutput>;

export type IncrementalEnrichmentDependencies = StoreGraphDependencies & {
  createServiceClient?: () => FoundationSupabaseClient;
  lessonDependencies?: NodeStageDependencies<LessonArtifact>;
  flagshipLessonDependencies?: FlagshipLessonDependencies;
  diagnosticDependencies?: NodeStageDependencies<DiagnosticArtifact>;
  visualDependencies?: NodeStageDependencies<VisualArtifact>;
  enrichmentDeadlineMs?: number;
  maxNodeConcurrency?: number;
  minimumFallbackBudgetMs?: number;
  minimumFlagshipRetryBudgetMs?: number;
  enableDiagnostics?: boolean;
  enableVisuals?: boolean;
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

export type DemoEnrichmentReadiness = {
  graph_id: string;
  selected_node_ids: string[];
  missing_lesson_node_ids: string[];
  needs_enrichment: boolean;
};

type StageAttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

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
  const supportsLessonStatus = await detectDbSurfaceAvailable(
    client,
    STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  );
  const nodeSelectClause = supportsLessonStatus
    ? "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,lesson_status,position,attempt_count,pass_count"
    : "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count";

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

  const { data: rawNodes, error: nodeError } = await client
    .from("nodes")
    .select(nodeSelectClause)
    .eq("graph_id", graphId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (nodeError) {
    throw new ApiError("GRAPH_READ_FAILED", "Failed to load nodes for enrichment.", 503, {
      graph_id: graphId,
      cause: nodeError.message,
    });
  }

  const nodes = (rawNodes ?? []) as unknown as SkeletonNodeRow[];

  const { data: edges, error: edgeError } = await client
    .from("edges")
    .select("from_node_id,to_node_id,type")
    .in("from_node_id", nodes.map((node) => node.id))
    .in("to_node_id", nodes.map((node) => node.id));

  if (edgeError) {
    throw new ApiError("GRAPH_READ_FAILED", "Failed to load edges for enrichment.", 503, {
      graph_id: graphId,
      cause: edgeError.message,
    });
  }

  return {
    graph: graph as GraphRecord,
    nodes: nodes.map((node) =>
      nodeSchema.parse({
        ...node,
        lesson_status: deriveLessonStatus(node),
      }),
    ),
    edges: (edges ?? []) as SkeletonEdge[],
  };
}

function deriveLessonStatus(node: SkeletonNodeRow): Node["lesson_status"] {
  const explicitStatus = lessonStatusSchema.safeParse(node.lesson_status);
  if (explicitStatus.success) {
    return explicitStatus.data;
  }

  const hasLessonText =
    typeof node.lesson_text === "string" && node.lesson_text.trim().length > 0;

  return hasLessonText ? "ready" : "pending";
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

function compareIds(left: string, right: string): number {
  return left.localeCompare(right);
}

export function selectInitialSlice(
  nodes: InitialSliceNode[],
  edges: InitialSliceEdge[],
): InitialSliceSelection {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incomingHardEdgeCounts = new Map<string, number>(
    nodes.map((node) => [node.id, 0]),
  );
  const outgoingHardEdges = new Map<string, InitialSliceEdge[]>();

  for (const edge of edges) {
    if (edge.type !== "hard") {
      continue;
    }

    if (!nodeMap.has(edge.from_node_id) || !nodeMap.has(edge.to_node_id)) {
      continue;
    }

    incomingHardEdgeCounts.set(
      edge.to_node_id,
      (incomingHardEdgeCounts.get(edge.to_node_id) ?? 0) + 1,
    );

    const current = outgoingHardEdges.get(edge.from_node_id) ?? [];
    current.push(edge);
    current.sort((left, right) => compareIds(left.to_node_id, right.to_node_id));
    outgoingHardEdges.set(edge.from_node_id, current);
  }

  const roots = [...nodes]
    .filter((node) => (incomingHardEdgeCounts.get(node.id) ?? 0) === 0)
    .sort((left, right) => compareIds(left.id, right.id));

  const visited = new Set<string>();
  const lessonBearingPathIds: string[] = [];
  let currentNode: InitialSliceNode | null = roots[0] ?? null;

  while (currentNode && !visited.has(currentNode.id)) {
    visited.add(currentNode.id);

    if (currentNode.is_lesson_bearing === true) {
      lessonBearingPathIds.push(currentNode.id);
    }

    const nextNodeId: string | undefined = (outgoingHardEdges.get(currentNode.id) ?? [])
      .map((edge) => edge.to_node_id)
      .sort(compareIds)
      .find((nodeId) => !visited.has(nodeId));

    currentNode = nextNodeId ? nodeMap.get(nextNodeId) ?? null : null;
  }

  if (lessonBearingPathIds.length === 0) {
    throw new Error(
      "selectInitialSlice requires at least one lesson-bearing node on the primary hard-edge path.",
    );
  }

  const flagship = lessonBearingPathIds[0]!;
  const standard = lessonBearingPathIds.slice(1, 4);
  const selected = new Set([flagship, ...standard]);
  const pending = [...nodes]
    .map((node) => node.id)
    .sort(compareIds)
    .filter((nodeId) => !selected.has(nodeId));

  return {
    flagship,
    standard,
    pending,
  };
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

function getNeighborTitles(input: {
  nodeId: string;
  nodes: SkeletonNode[];
  edges: SkeletonEdge[];
  direction: "incoming" | "outgoing";
}): string[] {
  const titleById = new Map(input.nodes.map((node) => [node.id, node.title]));
  return input.edges
    .filter((edge) =>
      input.direction === "incoming"
        ? edge.to_node_id === input.nodeId
        : edge.from_node_id === input.nodeId,
    )
    .map((edge) =>
      input.direction === "incoming"
        ? titleById.get(edge.from_node_id)
        : titleById.get(edge.to_node_id),
    )
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
      "Generate only lesson_text for the provided node.",
      "Keep lesson_text concise and focused, roughly 140 to 220 words.",
      "Use plain text with optional inline math and short paragraphs.",
      "The lesson must be self-contained relative to the listed hard prerequisites and focused only on the node concept.",
      "Do not include markdown fences or extra commentary outside the JSON object.",
      "Do not return quiz_json, diagnostics, visuals, or any extra fields.",
      "Output schema: {\"lesson_text\":\"...\"}",
    ].join(" "),
    userPrompt: [
      `Subject: ${input.graph.subject}`,
      `Topic: ${input.graph.topic}`,
      `Description: ${input.graph.description}`,
      `Node id: ${input.node.id}`,
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

function buildFlagshipLessonSystemPrompt(): string {
  return `You are creating the opening lesson for an adaptive learning graph. This is node 1 — the first thing the learner encounters. It must produce genuine understanding, feel hand-authored, and look beautiful when rendered.

OUTPUT FORMAT: A single JSON object with 6 sections. No markdown fences, no commentary outside the JSON.

TEXT FORMATTING RULES (apply to ALL string values):
- Use $...$ for inline math. Example: "The derivative $\\frac{dy}{dx}$ measures the rate of change."
- Use $$...$$ for display math (important equations that deserve their own centered line). Example: "The fundamental relationship is:\\n\\n$$F = ma$$\\n\\nThis tells us that force is proportional to acceleration."
- Use **...** for key terms or emphasis on first introduction. Example: "This property is called **gradient descent** — the algorithm adjusts weights in the direction that reduces error."
- Use *...* sparingly for subtle emphasis or to name something inline. Example: "This is sometimes called the *curse of dimensionality*."
- Use \\n\\n for paragraph breaks within any string field.
- Do NOT use markdown headers (#), bullet points (-), numbered lists, code blocks, or links.
- LaTeX must be valid KaTeX syntax. Prefer simple notation: \\frac{}{}, \\sqrt{}, \\sum_{}, \\int_{}, x^2, x_i. Avoid obscure packages.

WHEN TO USE MATH:
- Use math notation whenever the concept involves a formula, equation, variable relationship, or quantitative idea — even if the topic isn't "math." Cryptography has $2^{128}$ key combinations. Economics has supply $S(p)$ and demand $D(p)$. Biology has growth rate $\\frac{dN}{dt} = rN$.
- If the topic is genuinely non-quantitative (history, literature, philosophy), skip math entirely. Don't force it.
- Display math ($$...$$) should appear at most 2–3 times in the entire lesson, for the most important equations. Inline math can appear freely.

SECTION 1 — predictionTrap

"predictionTrap": {
  "question": "...",
  "obviousAnswer": "...",
  "correctAnswer": "...",
  "whyWrong": "..."
}

Pose a concrete, specific question about the topic that an intelligent beginner would answer incorrectly.

Requirements:
- The question must be answerable with a clear right/wrong. Not "what is X?" but "if you did X, what would happen?" or "which of these is true about X?"
- The obvious answer should feel right based on common intuition or surface-level reasoning.
- The correct answer should be genuinely surprising — the learner should feel "wait, really?"
- whyWrong: 1–2 sentences explaining why the intuitive answer fails. This is the setup for everything that follows.

The prediction trap is the single most important element. If it doesn't produce a genuine "huh, I was wrong" moment, the whole lesson falls flat.

Examples of good prediction traps:
- Topic: neural networks. "If you train a network for twice as many epochs, does it become twice as accurate?" Obvious: yes, more training = better. Correct: no — it will likely **overfit** and get worse on new data.
- Topic: cryptography. "If you make a password twice as long, is it twice as hard to crack?" Obvious: yes, twice the length = twice the work. Correct: no — each added character multiplies the possibilities, so it's exponentially harder. Going from 8 to 16 characters isn't $2 \\times$ harder, it's roughly $62^8 \\approx 2 \\times 10^{14}$ times harder.
- Topic: economics. "If a company doubles its prices, does its revenue double?" Obvious: yes, double price = double revenue. Correct: no — demand typically drops, so revenue depends on **price elasticity**.

SECTION 2 — guidedInsight

"guidedInsight": {
  "ground": "...",
  "mechanism": "...",
  "surprise": "...",
  "reframe": "..."
}

Four short passages, each 2–5 sentences. Each builds on the last.

"ground": Connect to what the learner already understands. Start familiar, then reveal a hidden property. The first sentence should reference something concrete the learner already knows. The last sentence should create a question or tension.

"mechanism": Explain the core concept as the resolution of the prediction trap. The first sentence must directly reference the wrong answer: "The reason [obvious answer] fails is..." Then build the correct mental model in 2–3 more sentences. If the concept has a key equation, introduce it here with display math.

"surprise": Go one level deeper than expected. Show that the mechanism has implications the learner didn't anticipate. Use a concrete example or analogy — not abstract hand-waving. This is the "wait, it also means that?" moment.

"reframe": 2–3 sentences compressing everything into a single memorable restatement. This should be the thing the learner quotes when explaining the concept to someone else. Write it like a well-crafted thesis statement, not a motivational poster.

SECTION 3 — workedExample

"workedExample": {
  "setup": "...",
  "naiveAttempt": "...",
  "steps": [
    { "action": "...", "result": "..." },
    { "action": "...", "result": "..." },
    { "action": "...", "result": "..." }
  ],
  "takeaway": "..."
}

A fully-solved, concrete problem.

"setup": A real-world scenario in 1–2 sentences. Use a specific domain. Include concrete numbers. Not "consider the function f(x)" — instead "A hospital wants to predict which of its 500 recent patients are at risk of readmission, using 12 variables from their medical records."

"naiveAttempt": 1–2 sentences showing why the approach that matches the prediction trap would fail here. Echo the same error.

"steps": 3–4 steps. Each step has:
- "action": what you do, written as a clear instruction. Include math if the step involves computation.
- "result": what happens, including the concrete output. Show actual numbers or values where possible.

"takeaway": One sentence connecting the result back to the mechanism from section 2.

SECTION 4 — whatIf

"whatIf": {
  "question": "...",
  "options": [
    { "text": "...", "isCorrect": false, "explanation": "..." },
    { "text": "...", "isCorrect": true, "explanation": "..." },
    { "text": "...", "isCorrect": false, "explanation": "..." }
  ]
}

One thought experiment: "What would happen if [you changed one variable from the worked example]?"
3 options, exactly one correct. Frame it as exploration: "Consider this..." Not a test.
Each explanation is 1–2 sentences.

SECTION 5 — masteryCheck

"masteryCheck": {
  "stem": "...",
  "options": [
    { "text": "...", "isCorrect": false, "feedback": "..." },
    { "text": "...", "isCorrect": true, "feedback": "..." },
    { "text": "...", "isCorrect": false, "feedback": "..." },
    { "text": "...", "isCorrect": false, "feedback": "..." }
  ],
  "forwardHook": "..."
}

One question requiring the learner to apply the concept to a brand new situation they haven't seen in this lesson.

"stem": Describe a novel scenario and ask a question about it. Include enough detail that the answer requires reasoning, not recall.

4 options, exactly one correct. The 3 wrong options each target a specific misconception:
- One echoes the prediction trap error (the learner is still thinking the naive way)
- One shows partial understanding (got the mechanism but applied it wrong)
- One overshoots (took the concept too far, over-applied it)

Each option's "feedback" is 2–3 sentences. Wrong-answer feedback must be kind and diagnostic: "You might be thinking X, which makes sense because Y, but the key distinction is Z." Correct-answer feedback should affirm and extend: "Exactly — and this is because..."

"forwardHook": One sentence connecting to the next topic: "Now that you understand [this], the next question is [what the next node covers]..."

SECTION 6 — anchor

"anchor": {
  "summary": "...",
  "bridge": "..."
}

"summary": One sentence — what the learner now understands that they didn't before.
"bridge": One sentence — what comes next and why it follows from what they just learned.

QUALITY REQUIREMENTS:
- Every sentence must do work. No filler. No "Let's dive in!", "This is a fascinating topic", or "As we've seen."
- Write in second person ("you"), not third ("the learner").
- Use concrete language. Not "various factors" — name them. Not "in some cases" — describe the case.
- Tone: a brilliant tutor explaining something one-on-one. Warm, precise, occasionally surprising. Not a textbook. Not a chatbot.
- Do not explain what you're doing ("Now I'll present a worked example"). Just do it.
- Total output: approximately 1,100–1,500 tokens.`;
}

function buildFlagshipLessonUserPrompt(input: {
  graph: GraphRecord;
  node: SkeletonNode;
  prerequisites: string[];
  nextNodes: string[];
}): string {
  return [
    `Subject: ${input.graph.subject}`,
    `Topic: ${input.node.title}`,
    `Learning objective: ${input.node.title}`,
    `Prerequisites the learner has already mastered: ${
      input.prerequisites.length > 0
        ? input.prerequisites.join(", ")
        : "None — this is the first concept"
    }`,
    `What comes next in the graph: ${
      input.nextNodes.length > 0
        ? input.nextNodes.join(", ")
        : "This is the final concept in this path"
    }`,
    "",
    "Produce the flagship lesson JSON. Output only valid JSON, no other text.",
  ].join("\n");
}

function buildDiagnosticPrompt(input: {
  graph: GraphRecord;
  node: SkeletonNode;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "You are the Foundation diagnostic generator for a single node.",
      "Return only raw JSON.",
      "Generate exactly one diagnostic question for adaptive placement.",
      "This is not the mastery quiz. Use the question to distinguish 'understands this node' from 'does not yet understand this node'.",
      "Target the node's central concept, not downstream applications. Do not test assumed prior knowledge or downstream topics.",
      "Avoid trick wording and unnecessary computation unless the node itself is procedural. Do not create mastery-style mini-exams.",
      "diagnostic_questions must contain exactly one item with 4 string options, correct_index, difficulty_order, and node_id matching the provided node id.",
      "The question object must use the shape {\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct_index\":0,\"difficulty_order\":1,\"node_id\":\"...\"}.",
      "The node_id in diagnostic_questions must match the provided node id.",
      "Do not return strings, booleans, or null where arrays or numbers are required.",
      "Output schema: {\"diagnostic_questions\":[{\"question\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"correct_index\":0,\"difficulty_order\":1,\"node_id\":\"node_1\"}]}",
    ].join(" "),
    userPrompt: [
      `Subject: ${input.graph.subject}`,
      `Topic: ${input.graph.topic}`,
      `Description: ${input.graph.description}`,
      `Node id: ${input.node.id}`,
      `Node title: ${input.node.title}`,
      `Node position: ${input.node.position}`,
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

function stripJsonCodeFences(value: string): string {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1]!.trim() : trimmed;
}

function normalizeFlagshipModelResult(
  result: FlagshipLessonModelResult | string,
): FlagshipLessonModelResult {
  if (typeof result === "string") {
    return { text: result, usage: null, stopReason: null };
  }

  return result;
}

function extractTextFromAnthropicMessageResponse(response: unknown): FlagshipLessonModelResult {
  const usage =
    response &&
    typeof response === "object" &&
    "usage" in response &&
    response.usage &&
    typeof response.usage === "object" &&
    "output_tokens" in response.usage &&
    typeof response.usage.output_tokens === "number"
      ? { output_tokens: response.usage.output_tokens }
      : null;

  if (
    !response ||
    typeof response !== "object" ||
    !("content" in response) ||
    !Array.isArray(response.content)
  ) {
    throw new ApiError(
      "LLM_PARSE_FAILURE",
      "flagship_lesson returned output that could not be parsed.",
      502,
    );
  }

  const text = response.content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }

      return "";
    })
    .join("")
    .trim();

  if (text.length === 0) {
    throw new ApiError(
      "LLM_PARSE_FAILURE",
      "flagship_lesson returned output that could not be parsed.",
      502,
      { output_kind: "empty_text" },
    );
  }

  const stopReason =
    response &&
    typeof response === "object" &&
    "stop_reason" in response &&
    (typeof response.stop_reason === "string" || response.stop_reason === null)
      ? response.stop_reason
      : null;

  return { text, usage, stopReason };
}

async function defaultFlagshipLessonCallModel(args: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<FlagshipLessonModelResult> {
  const client = getAnthropicClient();
  const response = await client.messages
    .stream({
      model: getAnthropicModel(),
      max_tokens: args.maxTokens,
      temperature: 0,
      system: args.systemPrompt,
      messages: [
        {
          role: "user",
          content: args.userPrompt,
        },
      ],
    })
    .finalMessage();

  return extractTextFromAnthropicMessageResponse(response);
}

function convertFlagshipLessonToLessonArtifact(
  lesson: FlagshipLesson,
): LessonArtifact {
  const masteryCorrectIndex = lesson.masteryCheck.options.findIndex((option) => option.isCorrect);
  const whatIfCorrectIndex = lesson.whatIf.options.findIndex((option) => option.isCorrect);

  return {
    lesson_text: JSON.stringify(lesson),
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'></svg>",
    quiz_json: [
      {
        question: lesson.masteryCheck.stem,
        options: lesson.masteryCheck.options.map((option) => option.text) as [
          string,
          string,
          string,
          string,
        ],
        correct_index: masteryCorrectIndex,
        explanation:
          lesson.masteryCheck.options.find((option) => option.isCorrect)?.feedback ??
          lesson.masteryCheck.forwardHook,
      },
      {
        question: lesson.whatIf.question,
        options: [
          lesson.whatIf.options[0]!.text,
          lesson.whatIf.options[1]!.text,
          lesson.whatIf.options[2]!.text,
          lesson.anchor.summary,
        ],
        correct_index: whatIfCorrectIndex,
        explanation:
          lesson.whatIf.options.find((option) => option.isCorrect)?.explanation ??
          lesson.anchor.bridge,
      },
      {
        question: lesson.predictionTrap.question,
        options: [
          lesson.predictionTrap.obviousAnswer,
          lesson.predictionTrap.correctAnswer,
          lesson.guidedInsight.reframe,
          lesson.anchor.summary,
        ],
        correct_index: 1,
        explanation: lesson.predictionTrap.whyWrong,
      },
    ],
  };
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
  timeoutMs: number,
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
    timeoutMs,
    maxTokens: LESSON_MAX_TOKENS,
    context,
    dependencies: dependencies.lessonDependencies,
  });
}

async function generateFlagshipLesson(
  graph: GraphRecord,
  node: SkeletonNode,
  edges: SkeletonEdge[],
  nodes: SkeletonNode[],
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies,
  deadlineAtMs: number,
): Promise<FlagshipLesson | null> {
  const callModel =
    dependencies.flagshipLessonDependencies?.callModel ?? defaultFlagshipLessonCallModel;
  const minimumFallbackBudgetMs =
    dependencies.minimumFallbackBudgetMs ?? DEFAULT_MINIMUM_FALLBACK_BUDGET_MS;
  const minimumFlagshipRetryBudgetMs =
    dependencies.minimumFlagshipRetryBudgetMs ?? DEFAULT_MINIMUM_FLAGSHIP_RETRY_BUDGET_MS;
  const userPrompt = buildFlagshipLessonUserPrompt({
    graph,
    node,
    prerequisites: getNeighborTitles({
      nodeId: node.id,
      nodes,
      edges,
      direction: "incoming",
    }),
    nextNodes: getNeighborTitles({
      nodeId: node.id,
      nodes,
      edges,
      direction: "outgoing",
    }),
  });
  let lastError: unknown = null;
  let lastAttemptBudgetMs = 0;
  let lastRemainingBudgetMs = 0;

  for (let attempt = 1; attempt <= FLAGSHIP_LESSON_MAX_ATTEMPTS; attempt += 1) {
    try {
      const stageStartedAtMs = Date.now();
      const remainingBudgetMs = getRemainingDeadlineMs(deadlineAtMs);
      const attemptBudgetMs = computeFlagshipAttemptTimeoutMs({
        remainingBudgetMs,
        minimumFallbackBudgetMs,
        minimumFlagshipRetryBudgetMs,
      });
      lastRemainingBudgetMs = remainingBudgetMs;
      lastAttemptBudgetMs = attemptBudgetMs;

      if (attemptBudgetMs < minimumFlagshipRetryBudgetMs) {
        logWarn(
          context,
          "lessons",
          "success",
          `Skipping flagship_lesson attempt ${attempt} because the remaining budget is too small.`,
          {
            attempt,
            node_id: node.id,
            node_title: node.title,
            node_position: node.position,
            remaining_budget_ms: remainingBudgetMs,
            attempt_budget_ms: attemptBudgetMs,
            minimum_fallback_budget_ms: minimumFallbackBudgetMs,
            minimum_flagship_retry_budget_ms: minimumFlagshipRetryBudgetMs,
          },
        );
        break;
      }

      logInfo(
        context,
        "lessons",
        attempt === 1 ? "start" : "retry",
        `flagship_lesson attempt ${attempt} started.`,
        {
          attempt,
          node_id: node.id,
          node_title: node.title,
          node_position: node.position,
          remaining_budget_ms: remainingBudgetMs,
          attempt_budget_ms: attemptBudgetMs,
        },
      );

      const modelResult = normalizeFlagshipModelResult(
        await runWithTimeout(
          callModel({
            systemPrompt: buildFlagshipLessonSystemPrompt(),
            userPrompt,
            maxTokens: FLAGSHIP_LESSON_MAX_TOKENS,
          }),
          attemptBudgetMs,
          () =>
            new ApiError(
              "UPSTREAM_TIMEOUT",
              `flagship_lesson timed out after ${attemptBudgetMs}ms.`,
              504,
            ),
        ),
      );

      const candidate = JSON.parse(stripJsonCodeFences(modelResult.text)) as unknown;
      const parsed = flagshipLessonSchema.safeParse({
        ...(candidate && typeof candidate === "object" ? candidate : {}),
        version: "flagship-v1",
      });

      if (!parsed.success) {
        throw new ApiError(
          "LLM_SCHEMA_INVALID",
          "flagship_lesson returned output that did not match the expected schema.",
          502,
          {
            validation_error: parsed.error.flatten(),
          },
        );
      }

      const stageDurationMs = Date.now() - stageStartedAtMs;
      const outputTokens = modelResult.usage?.output_tokens ?? null;
      const stopReason = modelResult.stopReason ?? null;
      const observedThroughputTokensPerSecond =
        outputTokens === null || stageDurationMs <= 0
          ? null
          : outputTokens / (stageDurationMs / 1000);

      logInfo(context, "lessons", "success", "flagship_lesson completed successfully.", {
        attempt,
        stage_duration_ms: stageDurationMs,
        response_tokens: outputTokens,
        observed_throughput_tokens_per_sec:
          observedThroughputTokensPerSecond === null
            ? null
            : Number(observedThroughputTokensPerSecond.toFixed(2)),
        stop_reason: stopReason,
        node_id: node.id,
        node_title: node.title,
        node_position: node.position,
      });

      return parsed.data;
    } catch (error) {
      lastError = error;
      logError(
        context,
        "lessons",
        "flagship_lesson failed without retry.",
        error,
        {
          attempt,
          node_id: node.id,
          node_title: node.title,
          node_position: node.position,
          remaining_budget_ms: lastRemainingBudgetMs,
          attempt_budget_ms: lastAttemptBudgetMs,
        },
      );
    }
  }

  logWarn(
    context,
    "lessons",
    "success",
    "Flagship lesson generation returned null; standard lesson fallback will run.",
    {
      node_id: node.id,
      node_title: node.title,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      remaining_budget_ms: getRemainingDeadlineMs(deadlineAtMs),
    },
  );

  return null;
}

async function generateSingleNodeDiagnostic(
  graph: GraphRecord,
  node: SkeletonNode,
  context: RequestLogContext,
  dependencies: IncrementalEnrichmentDependencies,
  timeoutMs: number,
): Promise<DiagnosticArtifact> {
  const prompt = buildDiagnosticPrompt({ graph, node });
  const result = await executeLlmStage({
    stage: "diagnostics",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: diagnosticArtifactSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs,
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
  timeoutMs: number,
): Promise<VisualArtifact> {
  const prompt = buildVisualPrompt({ graph, node, conceptDescription });

  return executeLlmStage({
    stage: "visuals",
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    schema: visualArtifactSchema,
    failureCategory: "llm_output_invalid",
    timeoutMs,
    maxTokens: VISUAL_MAX_TOKENS,
    context,
    dependencies: dependencies.visualDependencies,
  });
}

async function attemptNodeStage<T>(worker: () => Promise<T>): Promise<StageAttemptResult<T>> {
  try {
    return {
      ok: true,
      value: await worker(),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function collectPendingNodeIds(nodes: SkeletonNode[]): string[] {
  return nodes
    .filter((node) => node.lesson_status === "pending")
    .map((node) => node.id);
}

function getRemainingDeadlineMs(deadlineAtMs: number): number {
  return Math.max(0, deadlineAtMs - Date.now());
}

function getBoundedStageTimeout(defaultTimeoutMs: number, deadlineAtMs: number): number {
  const remainingMs = getRemainingDeadlineMs(deadlineAtMs);
  return remainingMs > 0 ? Math.min(defaultTimeoutMs, remainingMs) : 1;
}

export function computeFlagshipAttemptTimeoutMs(input: {
  remainingBudgetMs: number;
  minimumFallbackBudgetMs?: number;
  minimumFlagshipRetryBudgetMs?: number;
}): number {
  const minimumFallbackBudgetMs =
    input.minimumFallbackBudgetMs ?? DEFAULT_MINIMUM_FALLBACK_BUDGET_MS;
  const minimumFlagshipRetryBudgetMs =
    input.minimumFlagshipRetryBudgetMs ?? DEFAULT_MINIMUM_FLAGSHIP_RETRY_BUDGET_MS;
  const budgetAfterReserveMs = input.remainingBudgetMs - minimumFallbackBudgetMs;
  if (budgetAfterReserveMs <= 0) {
    return 0;
  }

  return Math.min(FLAGSHIP_LESSON_TIMEOUT_MS, budgetAfterReserveMs) >= minimumFlagshipRetryBudgetMs
    ? Math.min(FLAGSHIP_LESSON_TIMEOUT_MS, budgetAfterReserveMs)
    : 0;
}

export function computeStandardLessonTimeoutMs(input: {
  remainingBudgetMs: number;
}): number {
  if (input.remainingBudgetMs <= 0) {
    return 0;
  }

  return Math.min(computeStageTimeout(LESSON_MAX_TOKENS), input.remainingBudgetMs);
}

function isDeterministicStructuredOutputFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.code === "LLM_PARSE_FAILURE" || error.code === "LLM_SCHEMA_INVALID";
}

type EnrichmentCircuitBreakers = {
  standardLessonsDisabled: boolean;
  diagnosticsDisabled: boolean;
  standardLessonReason: string | null;
  diagnosticsReason: string | null;
};

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
  console.log(`[enrich] Starting enrichment for ${selectedNodeIds.length} nodes`);

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
  const enrichmentDeadlineMs =
    dependencies.enrichmentDeadlineMs ?? ENRICHMENT_DEADLINE_MS;
  const deadlineAtMs = Date.now() + enrichmentDeadlineMs;
  const maxNodeConcurrency =
    dependencies.maxNodeConcurrency ?? MAX_NODE_ENRICHMENT_CONCURRENCY;
  const diagnosticsEnabled = dependencies.enableDiagnostics ?? true;
  const visualsEnabled = dependencies.enableVisuals ?? true;
  const readyNodeIdSet = new Set<string>();
  const failedNodeIdSet = new Set<string>();
  const processedNodeIdSet = new Set<string>();
  const circuitBreakers: EnrichmentCircuitBreakers = {
    standardLessonsDisabled: false,
    diagnosticsDisabled: false,
    standardLessonReason: null,
    diagnosticsReason: null,
  };
  let nextSelectedIndex = 0;

  async function processSelectedNode(selectedIndex: number, nodeId: string): Promise<void> {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }

    if (node.lesson_status === "ready") {
      readyNodeIdSet.add(node.id);
      processedNodeIdSet.add(node.id);
      return;
    }

    if (node.lesson_status === "failed" && !input.retry_failed) {
      failedNodeIdSet.add(node.id);
      processedNodeIdSet.add(node.id);
      return;
    }

    if (getRemainingDeadlineMs(deadlineAtMs) <= 0) {
      return;
    }

    await emitTransition(dependencies, {
      graph_id: input.graph_id,
      node_id: node.id,
      event: "started",
    });

    try {
      console.log(`[enrich] Generating lesson for node: ${node.title}`);
      let lessonResult: StageAttemptResult<LessonArtifact>;
      const minimumFallbackBudgetMs =
        dependencies.minimumFallbackBudgetMs ?? DEFAULT_MINIMUM_FALLBACK_BUDGET_MS;

      if (selectedIndex === 0) {
        const flagshipLesson = await generateFlagshipLesson(
          graph,
          node,
          edges,
          nodes,
          context,
          dependencies,
          deadlineAtMs,
        );

        if (flagshipLesson !== null) {
          logInfo(context, "lessons", "success", "Stored flagship lesson for the first selected node.", {
            graph_id: input.graph_id,
            node_id: node.id,
          });
          lessonResult = {
            ok: true,
            value: convertFlagshipLessonToLessonArtifact(flagshipLesson),
          };
        } else if (circuitBreakers.standardLessonsDisabled) {
          lessonResult = {
            ok: false,
            error: new Error(
              circuitBreakers.standardLessonReason ??
                "Standard lesson generation is disabled for remaining nodes.",
            ),
          };
        } else {
          const remainingBeforeFallbackMs = getRemainingDeadlineMs(deadlineAtMs);
          if (remainingBeforeFallbackMs < minimumFallbackBudgetMs) {
            logWarn(
              context,
              "lessons",
              "success",
              "Standard lesson fallback skipped because the remaining budget is too small.",
              {
                graph_id: input.graph_id,
                node_id: node.id,
                remaining_budget_ms: remainingBeforeFallbackMs,
                minimum_fallback_budget_ms: minimumFallbackBudgetMs,
              },
            );
            lessonResult = {
              ok: false,
              error: new Error(
                "Incremental enrichment deadline reached before standard lesson generation.",
              ),
            };
          } else {
            logInfo(
              context,
              "lessons",
              "success",
              "Flagship lesson fell back to the standard lesson generator.",
              {
                graph_id: input.graph_id,
                node_id: node.id,
                remaining_budget_ms: remainingBeforeFallbackMs,
                minimum_fallback_budget_ms: minimumFallbackBudgetMs,
              },
            );
            lessonResult = await attemptNodeStage(() =>
              generateSingleNodeLesson(
                graph,
                node,
                edges,
                nodes,
                context,
                dependencies,
                computeStandardLessonTimeoutMs({
                  remainingBudgetMs: getRemainingDeadlineMs(deadlineAtMs),
                }),
              ),
            );
          }
        }
      } else if (circuitBreakers.standardLessonsDisabled) {
        lessonResult = {
          ok: false,
          error: new Error(
            circuitBreakers.standardLessonReason ??
              "Standard lesson generation is disabled for remaining nodes.",
          ),
        };
      } else if (getRemainingDeadlineMs(deadlineAtMs) <= 0) {
        lessonResult = {
          ok: false,
          error: new Error("Incremental enrichment deadline reached before standard lesson generation."),
        };
      } else {
        const remainingStandardBudgetMs = getRemainingDeadlineMs(deadlineAtMs);
        if (remainingStandardBudgetMs < minimumFallbackBudgetMs) {
          logWarn(
            context,
            "lessons",
            "success",
            "Standard lesson generation skipped because the remaining budget is too small.",
            {
              graph_id: input.graph_id,
              node_id: node.id,
              remaining_budget_ms: remainingStandardBudgetMs,
              minimum_fallback_budget_ms: minimumFallbackBudgetMs,
            },
          );
          lessonResult = {
            ok: false,
            error: new Error(
              "Incremental enrichment deadline reached before standard lesson generation.",
            ),
          };
        } else {
          lessonResult = await attemptNodeStage(() =>
            generateSingleNodeLesson(
              graph,
              node,
              edges,
              nodes,
              context,
              dependencies,
              computeStandardLessonTimeoutMs({
                remainingBudgetMs: getRemainingDeadlineMs(deadlineAtMs),
              }),
            ),
          );
        }
      }

      if (!lessonResult.ok && isDeterministicStructuredOutputFailure(lessonResult.error)) {
        circuitBreakers.standardLessonsDisabled = true;
        circuitBreakers.standardLessonReason =
          lessonResult.error instanceof Error
            ? lessonResult.error.message
            : String(lessonResult.error);
      }

      if (!lessonResult.ok) {
        logWarn(context, "lessons", "success", "Lesson generation degraded to pending during incremental enrichment.", {
          graph_id: input.graph_id,
          node_id: node.id,
          error: lessonResult.error instanceof Error ? lessonResult.error.message : String(lessonResult.error),
        });
      }

      const conceptDescription = lessonResult.ok
        ? summarizeConcept(lessonResult.value.lesson_text, node.title)
        : `${node.title} introduces the core concept for this node.`;

      const diagnosticResultPromise = !diagnosticsEnabled ||
        circuitBreakers.diagnosticsDisabled ||
        getRemainingDeadlineMs(deadlineAtMs) <= 0
        ? Promise.resolve<StageAttemptResult<DiagnosticArtifact>>({
            ok: false,
            error: new Error(
              !diagnosticsEnabled
                ? "Diagnostics generation is disabled for this enrichment run."
                :
              circuitBreakers.diagnosticsReason ??
                "Incremental enrichment deadline reached before diagnostics generation.",
            ),
          })
        : attemptNodeStage(() =>
            generateSingleNodeDiagnostic(
              graph,
              node,
              context,
              dependencies,
              getBoundedStageTimeout(computeStageTimeout(DIAGNOSTIC_MAX_TOKENS), deadlineAtMs),
            ),
          );

      const visualResultPromise = !visualsEnabled || getRemainingDeadlineMs(deadlineAtMs) <= 0
        ? Promise.resolve<StageAttemptResult<VisualArtifact>>({
            ok: false,
            error: new Error(
              !visualsEnabled
                ? "Visual generation is disabled for this enrichment run."
                : "Incremental enrichment deadline reached before visual generation.",
            ),
          })
        : attemptNodeStage(() =>
            generateSingleNodeVisual(
              graph,
              node,
              conceptDescription,
              context,
              dependencies,
              getBoundedStageTimeout(computeStageTimeout(VISUAL_MAX_TOKENS), deadlineAtMs),
            ),
          );

      const [diagnosticResult, visualResult] = await Promise.all([
        diagnosticResultPromise,
        visualResultPromise,
      ]);

      if (
        diagnosticsEnabled &&
        !diagnosticResult.ok &&
        isDeterministicStructuredOutputFailure(diagnosticResult.error)
      ) {
        circuitBreakers.diagnosticsDisabled = true;
        circuitBreakers.diagnosticsReason =
          diagnosticResult.error instanceof Error
            ? diagnosticResult.error.message
            : String(diagnosticResult.error);
      }

      if (diagnosticsEnabled && !diagnosticResult.ok) {
        logWarn(
          context,
          "diagnostics",
          "success",
          "Diagnostic generation degraded to pending during incremental enrichment.",
          {
            graph_id: input.graph_id,
            node_id: node.id,
            error:
              diagnosticResult.error instanceof Error
                ? diagnosticResult.error.message
                : String(diagnosticResult.error),
          },
        );
      }

      if (visualsEnabled && !visualResult.ok) {
        logWarn(context, "visuals", "success", "Visual generation fell back during incremental enrichment.", {
          graph_id: input.graph_id,
          node_id: node.id,
          error: visualResult.error instanceof Error ? visualResult.error.message : String(visualResult.error),
        });
      }

      const isNodeReady = lessonResult.ok && (!diagnosticsEnabled || diagnosticResult.ok);
      console.log("[enrich] Lesson generated, writing to DB");

      const storedNode = await updateStoredNode(
        {
          graph_id: input.graph_id,
          node: {
            id: node.id,
            lesson_text: lessonResult.ok ? lessonResult.value.lesson_text : null,
            static_diagram: lessonResult.ok ? lessonResult.value.static_diagram ?? null : null,
            p5_code:
              visualResult.ok && visualResult.value.visual_verified
                ? visualResult.value.p5_code
                : null,
            visual_verified: visualResult.ok ? visualResult.value.visual_verified : false,
            quiz_json: lessonResult.ok ? lessonResult.value.quiz_json ?? null : null,
            diagnostic_questions: diagnosticResult.ok
              ? diagnosticResult.value.diagnostic_questions
              : null,
            lesson_status: isNodeReady ? "ready" : "pending",
          },
        },
        dependencies,
      );

      nodeMap.set(node.id, storedNode);
      console.log(`[enrich] Write succeeded for node: ${node.title}`);
      if (isNodeReady) {
        readyNodeIdSet.add(node.id);
      }
      processedNodeIdSet.add(node.id);
      if (isNodeReady) {
        await emitTransition(dependencies, {
          graph_id: input.graph_id,
          node_id: node.id,
          event: "ready",
        });
      }

      logInfo(context, "enrich", "success", "Incremental node enrichment completed.", {
        graph_id: input.graph_id,
        node_id: node.id,
        lesson_status: storedNode.lesson_status,
      });
    } catch (error) {
      console.error(
        `[enrich] ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
      failedNodeIdSet.add(node.id);
      processedNodeIdSet.add(node.id);

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

  async function runWorker(): Promise<void> {
    while (getRemainingDeadlineMs(deadlineAtMs) > 0) {
      const currentIndex = nextSelectedIndex;
      nextSelectedIndex += 1;
      if (currentIndex >= selectedNodeIds.length) {
        return;
      }

      await processSelectedNode(currentIndex, selectedNodeIds[currentIndex]!);
    }
  }

  const workerCount = Math.min(maxNodeConcurrency, selectedNodeIds.length);
  await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));

  if (getRemainingDeadlineMs(deadlineAtMs) <= 0) {
    logWarn(context, "enrich", "success", "Incremental enrichment reached the overall deadline; remaining nodes stay pending.", {
      graph_id: input.graph_id,
      deadline_ms: enrichmentDeadlineMs,
      processed_node_count: processedNodeIdSet.size,
      selected_node_count: selectedNodeIds.length,
    });
  }

  for (const nodeId of selectedNodeIds) {
    if (readyNodeIdSet.has(nodeId)) {
      readyNodeIds.push(nodeId);
    }

    if (failedNodeIdSet.has(nodeId)) {
      failedNodeIds.push(nodeId);
    }

    if (processedNodeIdSet.has(nodeId)) {
      processedNodeIds.push(nodeId);
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

export async function inspectDemoEnrichmentReadiness(
  graphId: string,
  dependencies: IncrementalEnrichmentDependencies = {},
  limit = 4,
): Promise<DemoEnrichmentReadiness> {
  const { nodes, edges } = await loadGraphSkeleton(graphId, dependencies);
  const selectedNodeIds = selectInitialLearningSlice(nodes, edges, limit);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const missingLessonNodeIds = selectedNodeIds.filter((nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return false;
    }

    return (
      node.lesson_status !== "ready" ||
      typeof node.lesson_text !== "string" ||
      node.lesson_text.trim().length === 0
    );
  });

  return {
    graph_id: graphId,
    selected_node_ids: selectedNodeIds,
    missing_lesson_node_ids: missingLessonNodeIds,
    needs_enrichment: missingLessonNodeIds.length > 0,
  };
}
