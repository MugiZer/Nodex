import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";

import {
  diagnosticsRouteRequestSchema,
  diagnosticsRouteResponseSchema,
  type DiagnosticStageOutput,
  type DiagnosticsRouteRequest,
} from "./contracts";
import {
  createStageInputError,
  executeDownstreamStage,
  mapDownstreamStageError,
} from "./downstream-stage";
import type { StageResultEnvelope } from "./stage-contracts";
import { runDiagnosticStage } from "./stages/content-stages";

export type DiagnosticsStageDependencies = Parameters<typeof runDiagnosticStage>[2];

function validateDiagnosticNodeLinkage(
  input: DiagnosticsRouteRequest,
  data: DiagnosticStageOutput,
): DiagnosticStageOutput {
  for (const node of data.nodes) {
    const [question] = node.diagnostic_questions;
    if (!question) {
      throw new ApiError(
        "DIAGNOSTICS_EMPTY_OUTPUT",
        "Diagnostics must return exactly one question per node.",
        502,
        {
          node_id: node.id,
        },
      );
    }

    if (question.node_id !== node.id) {
      throw new ApiError(
        "DIAGNOSTICS_NODE_MISMATCH",
        "Diagnostics question node_id must match the parent node id.",
        502,
        {
          node_id: node.id,
          diagnostic_node_id: question.node_id,
          node_count: input.nodes.length,
        },
      );
    }
  }

  return data;
}

export async function generateDiagnosticsStage(
  input: DiagnosticsRouteRequest,
  context: RequestLogContext,
  dependencies: DiagnosticsStageDependencies = {},
): Promise<StageResultEnvelope<DiagnosticStageOutput>> {
  const parsed = diagnosticsRouteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return diagnosticsRouteResponseSchema.parse(
      createStageInputError({
        stage: "diagnostics",
        request_id: context.requestId,
        code: "DIAGNOSTICS_INPUT_INVALID",
        message:
          "Expected body with subject, topic, description, lesson-enriched nodes, and edges for diagnostics.",
        details: parsed.error.flatten(),
      }),
    );
  }

  const result = await executeDownstreamStage({
    stage: "diagnostics",
    context,
    action: async () =>
      validateDiagnosticNodeLinkage(
        parsed.data,
        await runDiagnosticStage(
          {
            subject: parsed.data.subject,
            topic: parsed.data.topic,
            description: parsed.data.description,
            nodes: parsed.data.nodes.map((node) => ({
              id: node.id,
              title: node.title,
              position: node.position,
            })),
            edges: parsed.data.edges,
          },
          context,
          dependencies,
        ),
      ),
    validateEmpty: (data) => data.nodes.length === 0,
    emptyErrorCode: "DIAGNOSTICS_EMPTY_OUTPUT",
    emptyMessage: "Diagnostics returned an empty node artifact set.",
    successMessage: "Diagnostics stage completed.",
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
        input_invalid: "DIAGNOSTICS_INPUT_INVALID",
        timeout: "DIAGNOSTICS_TIMEOUT",
        provider_error: "DIAGNOSTICS_PROVIDER_ERROR",
        parse_failure: "DIAGNOSTICS_PARSE_FAILURE",
        schema_invalid: "DIAGNOSTICS_SCHEMA_INVALID",
        empty_output: "DIAGNOSTICS_EMPTY_OUTPUT",
        node_mismatch: "DIAGNOSTICS_NODE_MISMATCH",
        unexpected_internal: "DIAGNOSTICS_UNEXPECTED_INTERNAL",
      }, {
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
      }),
  });

  return diagnosticsRouteResponseSchema.parse(result);
}
