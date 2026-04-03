import type {
  CanonicalizeModelSuccessDraft,
  CanonicalizeResolvedSuccess,
  CanonicalizeSuccess,
  Edge,
  Graph,
  GraphPayload,
  Node,
  ProgressAttempt,
  RetrievalCandidate,
  SupportedSubject,
  UserProgress,
} from "@/lib/types";

export type RetrievalFixtureCandidate = RetrievalCandidate & {
  subject: SupportedSubject;
};

export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_GRAPH_ID = "22222222-2222-4222-8222-222222222222";
export const NODE_1_ID = "33333333-3333-4333-8333-333333333333";
export const NODE_2_ID = "44444444-4444-4444-8444-444444444444";
export const NODE_3_ID = "55555555-5555-4555-8555-555555555555";

export const canonicalizeSuccessFixture: CanonicalizeSuccess = {
  subject: "mathematics",
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus, physics, and statistics. Within mathematics, it is typically encountered at the intermediate level.",
};

export const canonicalizeModelDraftFixture: CanonicalizeModelSuccessDraft = {
  subject: "mathematics",
  topic: "Trigonometry",
  scope_summary:
    "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
  core_concepts: [
    "sine",
    "cosine",
    "tangent",
    "trigonometric identities",
    "laws of sines and cosines",
    "radian measure",
    "unit-circle reasoning",
  ],
  prerequisites: ["algebra", "Euclidean geometry"],
  downstream_topics: ["calculus", "physics", "statistics"],
  level: "intermediate",
};

export const canonicalizeResolvedFixture: CanonicalizeResolvedSuccess = {
  subject: "mathematics",
  topic: "trigonometry",
  description:
    "Trigonometry is the study of relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle. It encompasses sine, cosine, tangent, trigonometric identities, laws of sines and cosines, radian measure, unit-circle reasoning. It assumes prior knowledge of algebra, Euclidean geometry and serves as a foundation for calculus, physics, and statistics. Within mathematics, it is typically encountered at the intermediate level.",
  scope_summary:
    "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
  core_concepts: [
    "sine",
    "cosine",
    "tangent",
    "trigonometric identities",
    "laws of sines and cosines",
    "radian measure",
    "unit-circle reasoning",
  ],
  prerequisites: ["algebra", "Euclidean geometry"],
  downstream_topics: ["calculus", "physics", "statistics"],
  level: "intermediate",
  canonicalization_source: "model_only",
  inventory_candidate_topics: [],
  candidate_confidence_band: "none",
  canonicalization_version: "v3_grounded_hybrid_structured_rendered_description",
};

export const canonicalizePromptFixture = "I want to learn trigonometry";
export const canonicalizeNonLearningPromptFixture = "Tell me a joke";

export const baseGraphFixture: Graph = {
  id: TEST_GRAPH_ID,
  title: "Trigonometry Foundations",
  subject: "mathematics",
  topic: "trigonometry",
  description: canonicalizeSuccessFixture.description,
  version: 1,
  flagged_for_review: false,
  created_at: "2026-04-01T12:00:00.000Z",
};

function quizItem(
  question: string,
  correctIndex: number,
  explanation: string,
): { question: string; options: [string, string, string, string]; correct_index: number; explanation: string } {
  return {
    question,
    options: [
      "option_a",
      "option_b",
      "option_c",
      "option_d",
    ],
    correct_index: correctIndex,
    explanation,
  };
}

function diagnosticItem(nodeId: string, question: string, difficultyOrder: number) {
  return {
    question,
    options: [
      "option_a",
      "option_b",
      "option_c",
      "option_d",
    ] as [string, string, string, string],
    correct_index: 1,
    difficulty_order: difficultyOrder,
    node_id: nodeId,
  };
}

export const baseNodesFixture: Node[] = [
  {
    id: NODE_1_ID,
    graph_id: TEST_GRAPH_ID,
    graph_version: 1,
    title: "Angles And Measurement",
    lesson_text: "Angles are measured in degrees or radians.",
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    p5_code: "",
    visual_verified: false,
    quiz_json: [
      quizItem("What does one radian measure?", 1, "A radian is the angle subtending one unit of arc."),
      quizItem("Which unit is common in calculus?", 2, "Radians are the standard analytic unit."),
      quizItem("What is a right angle?", 3, "A right angle measures 90 degrees."),
    ],
    diagnostic_questions: [
      diagnosticItem(NODE_1_ID, "Which unit is used for angles in calculus?", 1),
    ],
    lesson_status: "ready",
    position: 0,
    attempt_count: 0,
    pass_count: 0,
  },
  {
    id: NODE_2_ID,
    graph_id: TEST_GRAPH_ID,
    graph_version: 1,
    title: "Sine And Cosine",
    lesson_text: "Sine and cosine describe projection on the unit circle.",
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    p5_code: "function setup() { createCanvas(480, 320); } function draw() {}",
    visual_verified: true,
    quiz_json: [
      quizItem("What does sine represent on the unit circle?", 0, "Sine is the y-coordinate."),
      quizItem("What does cosine represent on the unit circle?", 1, "Cosine is the x-coordinate."),
      quizItem("What is the Pythagorean identity?", 2, "sin^2(x) + cos^2(x) = 1."),
    ],
    diagnostic_questions: [
      diagnosticItem(NODE_2_ID, "Which function maps to the y-coordinate on the unit circle?", 2),
    ],
    lesson_status: "ready",
    position: 1,
    attempt_count: 0,
    pass_count: 0,
  },
  {
    id: NODE_3_ID,
    graph_id: TEST_GRAPH_ID,
    graph_version: 1,
    title: "Trig Identities",
    lesson_text: "Identities simplify expressions and transform equations.",
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    p5_code: "",
    visual_verified: false,
    quiz_json: [
      quizItem("Which identity relates sine and cosine?", 2, "The Pythagorean identity connects them."),
      quizItem("What does an angle addition identity do?", 0, "It expands trig functions of sums."),
      quizItem("What is a reciprocal identity?", 3, "It defines secant, cosecant, and cotangent."),
    ],
    diagnostic_questions: [
      diagnosticItem(NODE_3_ID, "Which identity is foundational for trig simplification?", 3),
    ],
    lesson_status: "ready",
    position: 2,
    attempt_count: 0,
    pass_count: 0,
  },
];

export const baseEdgesFixture: Edge[] = [
  { from_node_id: NODE_1_ID, to_node_id: NODE_2_ID, type: "hard" },
  { from_node_id: NODE_2_ID, to_node_id: NODE_3_ID, type: "hard" },
  { from_node_id: NODE_1_ID, to_node_id: NODE_3_ID, type: "soft" },
];

export const baseProgressFixture: UserProgress[] = [
  {
    id: "66666666-6666-4666-8666-666666666666",
    user_id: TEST_USER_ID,
    node_id: NODE_1_ID,
    graph_version: 1,
    completed: true,
    attempts: [
      {
        score: 3,
        timestamp: "2026-04-01T12:05:00.000Z",
      } satisfies ProgressAttempt,
    ],
  },
];

export const baseGraphPayloadFixture: GraphPayload = {
  graph: baseGraphFixture,
  nodes: baseNodesFixture,
  edges: baseEdgesFixture,
  progress: baseProgressFixture,
};

export const retrievalFixtureCandidates: RetrievalFixtureCandidate[] = [
  {
    subject: "mathematics",
    id: "77777777-7777-4777-8777-777777777777",
    similarity: 0.94,
    flagged_for_review: false,
    version: 2,
    created_at: "2026-03-28T12:00:00.000Z",
  },
  {
    subject: "mathematics",
    id: "88888888-8888-4888-8888-888888888888",
    similarity: 0.94,
    flagged_for_review: true,
    version: 3,
    created_at: "2026-03-29T12:00:00.000Z",
  },
  {
    subject: "mathematics",
    id: "99999999-9999-4999-8999-999999999999",
    similarity: 0.92,
    flagged_for_review: false,
    version: 1,
    created_at: "2026-03-30T12:00:00.000Z",
  },
  {
    subject: "physics",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    similarity: 0.83,
    flagged_for_review: false,
    version: 9,
    created_at: "2026-03-31T12:00:00.000Z",
  },
];
