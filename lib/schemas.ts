import { z } from "zod";

import { SUPPORTED_SUBJECTS } from "@/lib/types";

export const supportedSubjectSchema = z.enum(SUPPORTED_SUBJECTS);
export const edgeTypeSchema = z.enum(["hard", "soft"]);

export const progressAttemptSchema = z.object({
  score: z.number().int().min(0),
  timestamp: z.string().datetime(),
});

const fourOptionTupleSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
]);

export const quizItemSchema = z.object({
  question: z.string().min(1),
  options: fourOptionTupleSchema,
  correct_index: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
}).strict();

export const diagnosticQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: fourOptionTupleSchema,
    correct_index: z.number().int().min(0).max(3),
    difficulty_order: z.number().int(),
    node_id: z.string().min(1),
  })
  .strict();

export const graphSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  subject: supportedSubjectSchema,
  topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string().min(1),
  version: z.number().int().min(1),
  flagged_for_review: z.boolean(),
  created_at: z.string().datetime(),
}).strict();

export const nodeSchema = z.object({
  id: z.string().uuid(),
  graph_id: z.string().uuid(),
  graph_version: z.number().int().min(1),
  title: z.string().min(1),
  lesson_text: z.string().nullable(),
  static_diagram: z.string().nullable(),
  p5_code: z.string().nullable(),
  visual_verified: z.boolean(),
  quiz_json: z.array(quizItemSchema).length(3).nullable(),
  diagnostic_questions: z.array(diagnosticQuestionSchema).length(1).nullable(),
  position: z.number().int().min(0),
  attempt_count: z.number().int().min(0),
  pass_count: z.number().int().min(0),
}).strict();

export const edgeSchema = z.object({
  from_node_id: z.string().uuid(),
  to_node_id: z.string().uuid(),
  type: edgeTypeSchema,
}).strict();

export const userProgressSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  node_id: z.string().uuid(),
  graph_version: z.number().int().min(1),
  completed: z.boolean(),
  attempts: z.array(progressAttemptSchema),
}).strict();

export const graphPayloadSchema = z.object({
  graph: graphSchema,
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  progress: z.array(userProgressSchema),
}).strict();

const descriptionSentenceLevelSchema = /(introductory|intermediate|advanced) level\.$/;

export function validateCanonicalDescription(description: string): boolean {
  const parts = description.split(". ");
  if (parts.length !== 4) {
    return false;
  }

  const sentence1 = parts[0];
  const sentence2 = parts[1];
  const sentence3 = parts[2];
  const sentence4 = parts[3];

  return (
    sentence1.length > 0 &&
    sentence1[0] === sentence1[0].toUpperCase() &&
    sentence1.includes(" is the study of") &&
    sentence2.startsWith("It encompasses ") &&
    sentence3.startsWith("It assumes prior knowledge of ") &&
    sentence3.includes(" and serves as a foundation for ") &&
    sentence4.startsWith("Within ") &&
    descriptionSentenceLevelSchema.test(sentence4)
  );
}

export const canonicalizeSuccessSchema = z
  .object({
    subject: supportedSubjectSchema,
    topic: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
  })
  .refine((value) => validateCanonicalDescription(value.description), {
    message: "Description must follow the exact four-sentence canonical contract.",
    path: ["description"],
  })
  .strict();

export const canonicalizeFailureSchema = z.object({
  error: z.literal("NOT_A_LEARNING_REQUEST"),
}).strict();

export const canonicalizeResultSchema = z.union([
  canonicalizeSuccessSchema,
  canonicalizeFailureSchema,
]);

export const canonicalizeRequestSchema = z.object({
  prompt: z.string().trim().min(1),
}).strict();

export const retrieveRequestSchema = z.object({
  subject: supportedSubjectSchema,
  description: z.string().trim().min(1),
}).strict();

export const retrieveResponseSchema = z.object({
  graph_id: z.string().uuid().nullable(),
}).strict();

export const retrievalCandidateSchema = z.object({
  id: z.string().uuid(),
  similarity: z.number().min(-1).max(1),
  flagged_for_review: z.boolean(),
  version: z.number().int().min(1),
  created_at: z.string().datetime(),
}).strict();

export const progressWriteRequestSchema = z.object({
  graph_id: z.string().uuid(),
  node_id: z.string().uuid(),
  score: z.number().int().min(0).max(3),
  timestamp: z.string().datetime().optional(),
}).strict();

export const progressWriteResponseSchema = z.object({
  progress: userProgressSchema,
  available_node_ids: z.array(z.string().uuid()),
  flagged_for_review: z.boolean(),
}).strict();

export const generationNodeDraftSchema = z.object({
  id: z.string().regex(/^node_[1-9][0-9]*$/),
  title: z.string().min(1),
  position: z.number().int().min(0),
}).strict();

export const generationEdgeDraftSchema = z.object({
  from_node_id: z.string().regex(/^node_[1-9][0-9]*$/),
  to_node_id: z.string().regex(/^node_[1-9][0-9]*$/),
  type: edgeTypeSchema,
}).strict();

export const generationGraphDraftSchema = z.object({
  nodes: z.array(generationNodeDraftSchema),
  edges: z.array(generationEdgeDraftSchema),
}).strict();
