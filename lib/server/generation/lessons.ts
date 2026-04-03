import type { RequestLogContext } from "@/lib/logging";

import {
  lessonsRouteRequestSchema,
  lessonsRouteResponseSchema,
  type LessonStageOutput,
  type LessonsRouteRequest,
} from "./contracts";
import {
  createStageInputError,
  executeDownstreamStage,
  mapDownstreamStageError,
} from "./downstream-stage";
import type { StageResultEnvelope } from "./stage-contracts";
import { runLessonStage } from "./stages/content-stages";

export type LessonsStageDependencies = Parameters<typeof runLessonStage>[2];

export async function generateLessonsStage(
  input: LessonsRouteRequest,
  context: RequestLogContext,
  dependencies: LessonsStageDependencies = {},
): Promise<StageResultEnvelope<LessonStageOutput>> {
  const parsed = lessonsRouteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return lessonsRouteResponseSchema.parse(
      createStageInputError({
        stage: "lessons",
        request_id: context.requestId,
        code: "LESSONS_INPUT_INVALID",
        message: "Expected body with subject, topic, description, nodes, and edges for lessons.",
        details: parsed.error.flatten(),
      }),
    );
  }

  const result = await executeDownstreamStage({
    stage: "lessons",
    context,
    action: async () =>
      runLessonStage(parsed.data, context, dependencies),
    validateEmpty: (data) => data.nodes.length === 0,
    emptyErrorCode: "LESSONS_EMPTY_OUTPUT",
    emptyMessage: "Lessons returned an empty node artifact set.",
    successMessage: "Lessons stage completed.",
    startDetails: {
      node_count: parsed.data.nodes.length,
      edge_count: parsed.data.edges.length,
    },
    successDetails: (data) => ({
      node_count: data.nodes.length,
      edge_count: parsed.data.edges.length,
    }),
    mapError: (error) =>
      mapDownstreamStageError(error, {
        input_invalid: "LESSONS_INPUT_INVALID",
        timeout: "LESSONS_TIMEOUT",
        provider_error: "LESSONS_PROVIDER_ERROR",
        parse_failure: "LESSONS_PARSE_FAILURE",
        schema_invalid: "LESSONS_SCHEMA_INVALID",
        empty_output: "LESSONS_EMPTY_OUTPUT",
        node_mismatch: "LESSONS_NODE_MISMATCH",
        unexpected_internal: "LESSONS_UNEXPECTED_INTERNAL",
      }, {
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
      }),
  });

  return lessonsRouteResponseSchema.parse(result);
}
