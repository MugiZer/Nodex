import type { RequestLogContext } from "@/lib/logging";

import {
  visualsRouteRequestSchema,
  visualsRouteResponseSchema,
  type VisualStageOutput,
  type VisualsRouteRequest,
} from "./contracts";
import {
  createStageInputError,
  executeDownstreamStage,
  mapDownstreamStageError,
} from "./downstream-stage";
import { type StageResultEnvelope } from "./stage-contracts";
import { createVisualFallbackWarning } from "./stage-logging";
import { runVisualStage } from "./stages/content-stages";

export type VisualsStageDependencies = Parameters<typeof runVisualStage>[2];

export async function generateVisualsStage(
  input: VisualsRouteRequest,
  context: RequestLogContext,
  dependencies: VisualsStageDependencies = {},
): Promise<StageResultEnvelope<VisualStageOutput>> {
  const parsed = visualsRouteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return visualsRouteResponseSchema.parse(
      createStageInputError({
        stage: "visuals",
        request_id: context.requestId,
        code: "VISUALS_INPUT_INVALID",
        message:
          "Expected body with subject, topic, description, and graph nodes for visuals.",
        details: parsed.error.flatten(),
      }),
    );
  }

  const result = await executeDownstreamStage({
    stage: "visuals",
    context,
    action: async () =>
      runVisualStage(
        {
          subject: parsed.data.subject,
          topic: parsed.data.topic,
          description: parsed.data.description,
          nodes: parsed.data.nodes,
        },
        context,
        dependencies,
      ),
    validateEmpty: (data) => data.nodes.length === 0,
    emptyErrorCode: "VISUALS_EMPTY_OUTPUT",
    emptyMessage: "Visuals returned an empty node artifact set.",
    successMessage: "Visuals stage completed.",
    startDetails: {
      node_count: parsed.data.nodes.length,
    },
    successDetails: (data) => ({
      node_count: data.nodes.length,
      fallback_node_count: data.nodes.filter((node) => !node.visual_verified).length,
    }),
    warnings: (data) => {
      const fallbackNodeIds = data.nodes
        .filter((node) => !node.visual_verified)
        .map((node) => node.id);
      if (fallbackNodeIds.length === 0) {
        return [];
      }

      return [
        createVisualFallbackWarning({
          fallback_node_count: fallbackNodeIds.length,
          fallback_node_ids: fallbackNodeIds,
        }),
      ];
    },
    mapError: (error) =>
      mapDownstreamStageError(error, {
        input_invalid: "VISUALS_INPUT_INVALID",
        timeout: "VISUALS_TIMEOUT",
        provider_error: "VISUALS_PROVIDER_ERROR",
        parse_failure: "VISUALS_PARSE_FAILURE",
        schema_invalid: "VISUALS_SCHEMA_INVALID",
        empty_output: "VISUALS_EMPTY_OUTPUT",
        node_mismatch: "VISUALS_NODE_MISMATCH",
        unexpected_internal: "VISUALS_UNEXPECTED_INTERNAL",
      }, {
        node_count: parsed.data.nodes.length,
      }),
  });

  return visualsRouteResponseSchema.parse(result);
}
