import { z } from "zod";

import {
  canonicalizeResultSchema,
  diagnosticQuestionSchema,
  generationEdgeDraftSchema,
  generationNodeDraftSchema,
  quizItemSchema,
} from "@/lib/schemas";
import type {
  CanonicalizeResult,
  DiagnosticQuestion,
  Edge,
  GenerationEdgeDraft,
  GenerationNodeDraft,
  QuizItem,
} from "@/lib/types";

const DAY2_NODE_COUNT = 10;

const day2NodeSpecs = [
  ["node_1", "Angle Measurement", 0],
  ["node_2", "Right Triangle Ratios", 0],
  ["node_3", "Unit Circle Basics", 1],
  ["node_4", "Sine Function", 1],
  ["node_5", "Cosine Function", 1],
  ["node_6", "Tangent Function", 2],
  ["node_7", "Pythagorean Identity", 2],
  ["node_8", "Reciprocal Functions", 3],
  ["node_9", "Angle Addition Formulas", 3],
  ["node_10", "Trig Equations", 4],
] as const;

export type Day2GraphNodeDraft = GenerationNodeDraft;

export type Day2LessonNode = Day2GraphNodeDraft & {
  lesson_text: string;
  static_diagram: string;
  quiz_json: QuizItem[];
  lesson_status: "ready";
};

export type Day2DiagnosticNode = Day2LessonNode & {
  diagnostic_questions: [DiagnosticQuestion];
};

export type Day2VisualNode = Day2DiagnosticNode & {
  p5_code: string;
  visual_verified: boolean;
};

export type Day2VisualRouteNode = Pick<Day2GraphNodeDraft, "id" | "title" | "position">;

export type Day2TraceStageName =
  | "canonicalize"
  | "retrieve"
  | "graph"
  | "lessons"
  | "diagnostics"
  | "visuals"
  | "store";

export type Day2TraceStep = {
  stage: Day2TraceStageName;
  output: unknown;
};

export type Day2TraceFixture = {
  request_id: string;
  prompt: string;
  steps: Day2TraceStep[];
};

export type Day2ReplayOutcome = {
  status: "stored" | "cached" | "duplicate" | "aborted";
  cached_graph_id: string | null;
  persisted_graph_id: string | null;
  store_writes: Array<"graphs" | "nodes" | "edges">;
  completed_stages: Day2TraceStageName[];
  render_kinds: Record<string, "interactive" | "static">;
  failure: { stage: Day2TraceStageName | "trace"; reason: string } | null;
};

const traceStageOrderValues = [
  "canonicalize",
  "retrieve",
  "graph",
  "lessons",
  "diagnostics",
  "visuals",
  "store",
] as const;

const traceStageOrder: Day2TraceStageName[] = [...traceStageOrderValues];

const day2NodeDraftSchema = generationNodeDraftSchema;
const day2EdgeDraftSchema = generationEdgeDraftSchema;

const day2GraphDraftSchema = z
  .object({
    nodes: z.array(day2NodeDraftSchema).length(DAY2_NODE_COUNT),
    edges: z.array(day2EdgeDraftSchema).min(1),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    const positionsById = new Map<string, number>();

    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate node id: ${node.id}`,
          path: ["nodes"],
        });
      }

      nodeIds.add(node.id);
      positionsById.set(node.id, node.position);
    }

    const adjacency = new Map<string, string[]>();
    const hardIncoming = new Map<string, number>();

    for (const node of graph.nodes) {
      adjacency.set(node.id, []);
      hardIncoming.set(node.id, 0);
    }

    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from_node_id) || !nodeIds.has(edge.to_node_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Edge references unknown node ids: ${edge.from_node_id} -> ${edge.to_node_id}`,
          path: ["edges"],
        });
        continue;
      }

      if (edge.from_node_id === edge.to_node_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Self-loop detected on node ${edge.from_node_id}`,
          path: ["edges"],
        });
      }

      if (edge.type === "hard") {
        hardIncoming.set(
          edge.to_node_id,
          (hardIncoming.get(edge.to_node_id) ?? 0) + 1,
        );

        const fromPosition = positionsById.get(edge.from_node_id) ?? -1;
        const toPosition = positionsById.get(edge.to_node_id) ?? -1;
        if (fromPosition >= toPosition) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Hard edge must move forward in position: ${edge.from_node_id} -> ${edge.to_node_id}`,
            path: ["edges"],
          });
        }

        adjacency.get(edge.from_node_id)?.push(edge.to_node_id);
      }
    }

    for (const node of graph.nodes) {
      if (node.position > 0 && (hardIncoming.get(node.id) ?? 0) === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Non-root node is missing a hard prerequisite: ${node.id}`,
          path: ["nodes"],
        });
      }
    }

    const visited = new Set<string>();
    const active = new Set<string>();

    const visit = (nodeId: string): void => {
      if (active.has(nodeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cycle detected involving ${nodeId}`,
          path: ["edges"],
        });
        return;
      }

      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      active.add(nodeId);
      for (const nextId of adjacency.get(nodeId) ?? []) {
        visit(nextId);
      }
      active.delete(nodeId);
    };

    for (const node of graph.nodes.filter((entry) => entry.position === 0)) {
      visit(node.id);
    }

    if (visited.size !== graph.nodes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Graph contains nodes unreachable from a root by hard edges.",
        path: ["nodes"],
      });
    }
  });

const day2LessonNodeSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    position: z.number().int().min(0),
    lesson_text: z.string().min(1),
    static_diagram: z.string().min(1),
    quiz_json: z.array(quizItemSchema).length(3),
    lesson_status: z.literal("ready"),
  })
  .strict();

const day2DiagnosticNodeSchema = day2LessonNodeSchema
  .extend({
    diagnostic_questions: z.tuple([diagnosticQuestionSchema]),
  })
  .strict()
  .superRefine((node, ctx) => {
    const [question] = node.diagnostic_questions;
    if (question.node_id !== node.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Diagnostic question node_id does not match node id for ${node.id}`,
        path: ["diagnostic_questions", 0, "node_id"],
      });
    }
  });

const day2VisualNodeSchema = day2DiagnosticNodeSchema
  .extend({
    p5_code: z.string(),
    visual_verified: z.boolean(),
  })
  .strict()
  .superRefine((node, ctx) => {
    const code = node.p5_code.trim();
    if (node.visual_verified) {
      const requiredFragments = ["function setup", "function draw", "createCanvas(480, 320)"];
      for (const fragment of requiredFragments) {
        if (!code.includes(fragment)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Verified p5 sketch is missing ${fragment}`,
            path: ["p5_code"],
          });
        }
      }
    } else if (code.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unverified visual output must use empty p5_code and static fallback.",
        path: ["p5_code"],
      });
    }
  });

const day2LessonBundleSchema = z
  .object({
    nodes: z.array(day2LessonNodeSchema).length(DAY2_NODE_COUNT),
  })
  .strict();

const day2DiagnosticBundleSchema = z
  .object({
    nodes: z.array(day2DiagnosticNodeSchema).length(DAY2_NODE_COUNT),
  })
  .strict();

const day2VisualBundleSchema = z
  .object({
    nodes: z.array(day2VisualNodeSchema).length(DAY2_NODE_COUNT),
  })
  .strict();

const day2StoreStepSchema = z.union([
  z.object({ graph_id: z.string().uuid() }).strict(),
  z.object({ duplicate_graph_id: z.string().uuid() }).strict(),
]);

const day2TraceSchema = z
  .object({
    request_id: z.string().min(1),
    prompt: z.string().min(1),
    steps: z.array(
      z.object({
        stage: z.enum(traceStageOrderValues),
        output: z.unknown(),
      }),
    ),
  })
  .strict();

function createQuizItems(title: string): QuizItem[] {
  return [
    {
      question: `What is the core idea behind ${title}?`,
      options: [`${title} definition`, "A later application", "A random fact", "A visual style"],
      correct_index: 0,
      explanation: `${title} is the foundational concept in this node.`,
    },
    {
      question: `Which statement about ${title} is correct?`,
      options: ["It comes first", "It is unrelated", "It is only a diagram", "It is a review topic"],
      correct_index: 0,
      explanation: `This node establishes ${title}.`,
    },
    {
      question: `What should a learner be able to do after studying ${title}?`,
      options: ["Explain the core idea", "Skip the lesson", "Ignore prerequisites", "Treat it as a soft edge"],
      correct_index: 0,
      explanation: `The learner should understand the central concept of ${title}.`,
    },
  ];
}

function createStaticDiagram(title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" role="img" aria-label="${title} fallback diagram"><rect width="480" height="320" fill="#f8fafc" /><text x="24" y="48" fill="#0f172a" font-family="Arial, sans-serif" font-size="20">${title}</text><text x="24" y="88" fill="#334155" font-family="Arial, sans-serif" font-size="14">Static fallback diagram</text></svg>`;
}

function createDiagnosticQuestion(
  node: Day2GraphNodeDraft,
  order: number,
): DiagnosticQuestion {
  return {
    question: `Which idea best matches ${node.title}?`,
    options: [
      `${node.title} definition`,
      "A downstream application",
      "An unrelated topic",
      "A memorized formula only",
    ],
    correct_index: 0,
    difficulty_order: order,
    node_id: node.id,
  };
}

function createP5Code(title: string): string {
  const safeTitle = JSON.stringify(title);
  return [
    "function setup() {",
    "  createCanvas(480, 320);",
    "}",
    "function draw() {",
    "  background(248);",
    "  fill(15);",
    "  textSize(20);",
    `  text(${safeTitle}, 24, 48);`,
    "}",
  ].join("\n");
}

export function buildDay2GraphDraft(): {
  nodes: Day2GraphNodeDraft[];
  edges: GenerationEdgeDraft[];
} {
  const nodes = day2NodeSpecs.map(([id, title, position]) => ({
    id,
    title,
    position,
  }));

  const edges: GenerationEdgeDraft[] = [
    { from_node_id: "node_1", to_node_id: "node_3", type: "hard" },
    { from_node_id: "node_2", to_node_id: "node_4", type: "hard" },
    { from_node_id: "node_2", to_node_id: "node_5", type: "hard" },
    { from_node_id: "node_1", to_node_id: "node_4", type: "soft" },
    { from_node_id: "node_1", to_node_id: "node_5", type: "soft" },
    { from_node_id: "node_4", to_node_id: "node_6", type: "hard" },
    { from_node_id: "node_5", to_node_id: "node_7", type: "hard" },
    { from_node_id: "node_4", to_node_id: "node_7", type: "soft" },
    { from_node_id: "node_4", to_node_id: "node_8", type: "hard" },
    { from_node_id: "node_5", to_node_id: "node_8", type: "hard" },
    { from_node_id: "node_6", to_node_id: "node_9", type: "hard" },
    { from_node_id: "node_7", to_node_id: "node_9", type: "hard" },
    { from_node_id: "node_8", to_node_id: "node_10", type: "hard" },
    { from_node_id: "node_9", to_node_id: "node_10", type: "hard" },
  ];

  return {
    nodes,
    edges,
  };
}

function buildLessonNodes(nodes: Day2GraphNodeDraft[]): Day2LessonNode[] {
  return nodes.map((node) => ({
    ...node,
    lesson_text: `${node.title} is the core learning target for this node. It should stand on its own once the hard prerequisites are mastered.`,
    static_diagram: createStaticDiagram(node.title),
    quiz_json: createQuizItems(node.title),
    lesson_status: "ready",
  }));
}

function buildDiagnosticNodes(nodes: Day2LessonNode[]): Day2DiagnosticNode[] {
  return nodes.map((node, index) => ({
    ...node,
    diagnostic_questions: [createDiagnosticQuestion(node, index + 1)],
  }));
}

function buildVisualNodes(nodes: Day2DiagnosticNode[], verifiedNodeIds: Set<string>): Day2VisualNode[] {
  return nodes.map((node) => {
    const visualVerified = verifiedNodeIds.has(node.id);
    return {
      ...node,
      p5_code: visualVerified ? createP5Code(node.title) : "",
      visual_verified: visualVerified,
    };
  });
}

export function buildDay2VisualRouteNodes(input: {
  lessonNodes: Array<
    Pick<
      Day2LessonNode,
      "id" | "title" | "position" | "lesson_text" | "static_diagram" | "quiz_json"
    >
  >;
  diagnosticNodes: Array<Pick<Day2DiagnosticNode, "id" | "diagnostic_questions">>;
}): Day2VisualRouteNode[] {
  const diagnosticById = new Map(
    input.diagnosticNodes.map((node) => [node.id, node.diagnostic_questions] as const),
  );

  return input.lessonNodes.map((node) => {
    const diagnosticQuestions = diagnosticById.get(node.id);
    if (!diagnosticQuestions) {
      throw new Error(`Missing diagnostic questions for node ${node.id}.`);
    }

    return {
      id: node.id,
      title: node.title,
      position: node.position,
    };
  });
}

export function selectNodeVisualArtifact(
  node: Day2VisualNode,
): { kind: "interactive" | "static"; content: string } {
  if (node.visual_verified && node.p5_code.trim().length > 0) {
    return {
      kind: "interactive",
      content: node.p5_code,
    };
  }

  return {
    kind: "static",
    content: node.static_diagram,
  };
}

export function buildDay2SuccessTrace(): Day2TraceFixture {
  const draft = buildDay2GraphDraft();
  const lessonNodes = buildLessonNodes(draft.nodes);
  const diagnosticNodes = buildDiagnosticNodes(lessonNodes);
  const visualNodes = buildVisualNodes(
    diagnosticNodes,
    new Set(["node_1", "node_4", "node_7"]),
  );

  return {
    request_id: "day2-success-trace",
    prompt: "I want to learn trigonometry",
    steps: [
      {
        stage: "canonicalize",
        output: {
          subject: "mathematics",
          topic: "trigonometry",
          description:
            "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
        } satisfies CanonicalizeResult,
      },
      {
        stage: "retrieve",
        output: { graph_id: null },
      },
      {
        stage: "graph",
        output: draft,
      },
      {
        stage: "lessons",
        output: { nodes: lessonNodes },
      },
      {
        stage: "diagnostics",
        output: { nodes: diagnosticNodes },
      },
      {
        stage: "visuals",
        output: { nodes: visualNodes },
      },
      {
        stage: "store",
        output: { graph_id: "11111111-1111-4111-8111-111111111111" },
      },
    ],
  };
}

export function buildDay2VisualFallbackTrace(): Day2TraceFixture {
  const draft = buildDay2GraphDraft();
  const lessonNodes = buildLessonNodes(draft.nodes);
  const diagnosticNodes = buildDiagnosticNodes(lessonNodes);
  const visualNodes = buildVisualNodes(diagnosticNodes, new Set());

  return {
    request_id: "day2-visual-fallback-trace",
    prompt: "I want to learn trigonometry",
    steps: [
      {
        stage: "canonicalize",
        output: {
          subject: "mathematics",
          topic: "trigonometry",
          description:
            "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
        } satisfies CanonicalizeResult,
      },
      { stage: "retrieve", output: { graph_id: null } },
      { stage: "graph", output: draft },
      { stage: "lessons", output: { nodes: lessonNodes } },
      { stage: "diagnostics", output: { nodes: diagnosticNodes } },
      { stage: "visuals", output: { nodes: visualNodes } },
      { stage: "store", output: { graph_id: "22222222-2222-4222-8222-222222222222" } },
    ],
  };
}

export function buildDay2DuplicateTrace(): Day2TraceFixture {
  const trace = buildDay2SuccessTrace();
  return {
    ...trace,
    request_id: "day2-duplicate-trace",
    steps: trace.steps.map((step) =>
      step.stage === "store"
        ? {
            stage: step.stage,
            output: { duplicate_graph_id: "33333333-3333-4333-8333-333333333333" },
          }
        : step,
    ),
  };
}

export const DAY2_SUCCESS_TRACE = buildDay2SuccessTrace();
export const DAY2_VISUAL_FALLBACK_TRACE = buildDay2VisualFallbackTrace();
export const DAY2_DUPLICATE_TRACE = buildDay2DuplicateTrace();
export const DAY2_GRAPH_DRAFT = buildDay2GraphDraft();
export const DAY2_LESSON_NODES = buildLessonNodes(DAY2_GRAPH_DRAFT.nodes);
export const DAY2_DIAGNOSTIC_NODES = buildDiagnosticNodes(DAY2_LESSON_NODES);
export const DAY2_VISUAL_NODES = buildVisualNodes(
  DAY2_DIAGNOSTIC_NODES,
  new Set(["node_1", "node_4", "node_7"]),
);
export const DAY2_VISUAL_FALLBACK_NODES = buildVisualNodes(DAY2_DIAGNOSTIC_NODES, new Set());
export const DAY2_TRACE_STAGE_ORDER = traceStageOrder;

export const DAY2_PARTIAL_FAILURE_TRACE: unknown = {
  request_id: "day2-partial-failure-trace",
  prompt: "I want to learn trigonometry",
  steps: [
    {
      stage: "canonicalize",
      output: {
        subject: "mathematics",
        topic: "trigonometry",
        description:
          "Trigonometry is the study of the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and graphing patterns. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
      },
    },
    { stage: "retrieve", output: { graph_id: null } },
    { stage: "graph", output: DAY2_GRAPH_DRAFT },
    { stage: "lessons", output: { nodes: DAY2_LESSON_NODES } },
    {
      stage: "diagnostics",
      output: {
        nodes: DAY2_DIAGNOSTIC_NODES.map((node) =>
          node.id === "node_10"
            ? {
                ...node,
                diagnostic_questions: [
                  {
                    question: "Broken diagnostic output",
                    options: ["A", "B", "C", "D"],
                    correct_index: 0,
                    difficulty_order: 10,
                    node_id: "node_11",
                  },
                ],
              }
            : node,
        ),
      },
    },
    {
      stage: "visuals",
      output: {
        nodes: DAY2_DIAGNOSTIC_NODES.map((node) => ({
          ...node,
          p5_code: node.id === "node_1" ? "" : createP5Code(node.title),
          visual_verified: node.id !== "node_1",
        })),
      },
    },
  ],
};

export function replayDay2Trace(traceInput: unknown): Day2ReplayOutcome {
  const parsedTrace = day2TraceSchema.safeParse(traceInput);
  if (!parsedTrace.success) {
    return {
      status: "aborted",
      cached_graph_id: null,
      persisted_graph_id: null,
      store_writes: [],
      completed_stages: [],
      render_kinds: {},
      failure: { stage: "trace", reason: "Trace payload did not match the replay contract." },
    };
  }

  const { steps } = parsedTrace.data;
  const completedStages: Day2TraceStageName[] = [];
  const renderKinds: Record<string, "interactive" | "static"> = {};
  let cachedGraphId: string | null = null;

  for (const expectedStage of traceStageOrder) {
    const step = steps.find((entry) => entry.stage === expectedStage);

    if (!step) {
      return {
        status: "aborted",
        cached_graph_id: null,
        persisted_graph_id: null,
        store_writes: [],
        completed_stages: completedStages,
        render_kinds: renderKinds,
        failure: {
          stage: expectedStage,
          reason: `Missing required ${expectedStage} stage output.`,
        },
      };
    }

    completedStages.push(expectedStage);

    if (expectedStage === "canonicalize") {
      const canonicalizeResult = canonicalizeResultSchema.safeParse(step.output);
      if (!canonicalizeResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "canonicalize",
            reason: "Canonicalize output failed schema validation.",
          },
        };
      }

      if ("error" in canonicalizeResult.data) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "canonicalize",
            reason: "Canonicalize rejected the prompt as non-learning.",
          },
        };
      }
    }

    if (expectedStage === "retrieve") {
      const retrieveResult = z
        .object({ graph_id: z.string().uuid().nullable() })
        .strict()
        .safeParse(step.output);
      if (!retrieveResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "retrieve",
            reason: "Retrieve output failed schema validation.",
          },
        };
      }

      cachedGraphId = retrieveResult.data.graph_id;
      if (cachedGraphId) {
        return {
          status: "cached",
          cached_graph_id: cachedGraphId,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: null,
        };
      }
    }

    if (expectedStage === "graph") {
      const graphResult = day2GraphDraftSchema.safeParse(step.output);
      if (!graphResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "graph",
            reason: "Graph stage output failed schema validation.",
          },
        };
      }
    }

    if (expectedStage === "lessons") {
      const lessonsResult = day2LessonBundleSchema.safeParse(step.output);
      if (!lessonsResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "lessons",
            reason: "Lesson bundle failed schema validation.",
          },
        };
      }
    }

    if (expectedStage === "diagnostics") {
      const diagnosticsResult = day2DiagnosticBundleSchema.safeParse(step.output);
      if (!diagnosticsResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "diagnostics",
            reason: "Diagnostic bundle failed schema validation.",
          },
        };
      }
    }

    if (expectedStage === "visuals") {
      const visualsResult = day2VisualBundleSchema.safeParse(step.output);
      if (!visualsResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "visuals",
            reason: "Visual bundle failed schema validation.",
          },
        };
      }

      for (const node of visualsResult.data.nodes) {
        const artifact = selectNodeVisualArtifact(node);
        renderKinds[node.id] = artifact.kind;
      }
    }

    if (expectedStage === "store") {
      const storeResult = day2StoreStepSchema.safeParse(step.output);
      if (!storeResult.success) {
        return {
          status: "aborted",
          cached_graph_id: null,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: {
            stage: "store",
            reason: "Store output failed schema validation.",
          },
        };
      }

      if ("duplicate_graph_id" in storeResult.data) {
        return {
          status: "duplicate",
          cached_graph_id: storeResult.data.duplicate_graph_id,
          persisted_graph_id: null,
          store_writes: [],
          completed_stages: completedStages,
          render_kinds: renderKinds,
          failure: null,
        };
      }

      return {
        status: "stored",
        cached_graph_id: null,
        persisted_graph_id: storeResult.data.graph_id,
        store_writes: ["graphs", "nodes", "edges"],
        completed_stages: completedStages,
        render_kinds: renderKinds,
        failure: null,
      };
    }
  }

  return {
    status: "aborted",
    cached_graph_id: null,
    persisted_graph_id: null,
    store_writes: [],
    completed_stages: completedStages,
    render_kinds: renderKinds,
    failure: {
      stage: "store",
      reason: "Missing store stage output after a non-cached generation path.",
    },
  };
}

export function validateDay2GraphDraft(graph: {
  nodes: Day2GraphNodeDraft[];
  edges: Edge[];
}): void {
  day2GraphDraftSchema.parse(graph);
}

export function validateDay2LessonBundle(bundle: {
  nodes: Day2LessonNode[];
}): void {
  day2LessonBundleSchema.parse(bundle);
}

export function validateDay2DiagnosticBundle(bundle: {
  nodes: Day2DiagnosticNode[];
}): void {
  day2DiagnosticBundleSchema.parse(bundle);
}

export function validateDay2VisualBundle(bundle: {
  nodes: Day2VisualNode[];
}): void {
  day2VisualBundleSchema.parse(bundle);
}
