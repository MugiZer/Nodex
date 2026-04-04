import { createHash, randomUUID } from "node:crypto";

import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import { logInfo, logWarn } from "@/lib/logging";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";
import { RETRIEVAL_THRESHOLD, sortRetrievalCandidates } from "@/lib/domain/retrieval";
import type { Node } from "@/lib/types";
import type { Json } from "@/lib/supabase";
import type { Database } from "@/supabase/database.types";
import {
  nodeSchema,
  retrievalCandidateSchema,
  validateCanonicalDescription,
  validateVisualP5CodeRestrictions,
} from "@/lib/schemas";
import {
  embedDescription,
  loadRetrievalCandidates,
  type RetrievalDependencies,
} from "@/lib/server/retrieve";
import { formatVectorLiteral } from "@/lib/server/retrieve";
import { parseSchemaOrThrow } from "@/lib/server/schema-parse";
import {
  createDbSchemaOutOfSyncError,
  detectDbSurfaceAvailable,
  ensureDbSurfaceAvailable,
  ensureDbSurfacesAvailable,
  isDbSchemaMismatchError,
  STORE_FALLBACK_EDGES_SURFACE,
  STORE_FALLBACK_GRAPHS_SURFACE,
  STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  STORE_FALLBACK_NODES_REQUIRED_SURFACE,
  STORE_EXACT_DUPLICATE_SURFACE,
} from "@/lib/server/db-contract";

import {
  skeletonStoreRequestSchema,
  storeStageResponseSchema,
  storeRouteRequestSchema,
  type SkeletonStoreRequest,
  type StoreStageData,
  type StoreRouteRequest,
} from "./contracts";
import { createStageInputError, type DownstreamStageErrorMap } from "./downstream-stage";
import {
  createStageErrorResult,
  createStageSuccessResult,
  type StageError,
  type StageResultEnvelope,
} from "./stage-contracts";
import { logStageError, logStageStart, logStageSuccess } from "./stage-logging";

export type StoreGraphDependencies = RetrievalDependencies & {
  createServiceClient?: () => FoundationSupabaseClient;
  createUuid?: () => string;
  precomputedEmbedding?: number[];
  findExactDuplicateCandidates?: (
    graph: Pick<StoreRouteRequest["graph"], "subject" | "topic" | "description">,
  ) => Promise<DuplicateGraphCandidate[]>;
};

export type StoreGeneratedGraphResult = {
  graph_id: string;
  duplicate_of_graph_id?: string;
  node_id_map?: Record<string, string>;
};

type DuplicateGraphCandidate = {
  id: string;
  similarity: number;
  flagged_for_review: boolean;
  version: number;
  created_at: string;
};

type GraphDuplicateRow = Database["public"]["Tables"]["graphs"]["Row"];
type NodeWriteMode = "with_lesson_status" | "without_lesson_status";

export type StoreSkeletonResult = StoreGeneratedGraphResult & {
  version?: number;
  persisted_nodes?: Array<{
    id: string;
    graph_id: string;
    graph_version: number;
    title: string;
    lesson_text: null;
    static_diagram: null;
    p5_code: null;
    visual_verified: false;
    quiz_json: null;
    diagnostic_questions: null;
    lesson_status: "pending";
    position: number;
    attempt_count: 0;
    pass_count: 0;
  }>;
  persisted_edges?: Array<{
    from_node_id: string;
    to_node_id: string;
    type: "hard" | "soft";
  }>;
};

const STORE_ERROR_CODES: DownstreamStageErrorMap = {
  input_invalid: "STORE_INPUT_INVALID",
  timeout: "STORE_GRAPH_INSERT_FAILED",
  parse_failure: "STORE_GRAPH_INSERT_FAILED",
  schema_invalid: "STORE_GRAPH_INSERT_FAILED",
  empty_output: "STORE_PARTIAL_WRITE_PREVENTED",
  unexpected_internal: "STORE_UNEXPECTED_INTERNAL",
};

function getServiceClient(
  dependencies: StoreGraphDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

function remapDiagnosticQuestionsNodeIds(
  sourceNodeId: string,
  diagnosticQuestions: StoreRouteRequest["nodes"][number]["diagnostic_questions"],
  nodeIdMap: Map<string, string>,
) {
  if (diagnosticQuestions === null) {
    return null;
  }

  return diagnosticQuestions.map((question) => ({
    ...question,
    node_id: (() => {
      if (question.node_id !== sourceNodeId) {
        throw new ApiError(
          "STORE_NODE_REMAP_FAILED",
          `Diagnostic question node_id for ${sourceNodeId} must reference the source node id before remapping.`,
          422,
        );
      }

      const remappedNodeId = nodeIdMap.get(sourceNodeId);
      if (!remappedNodeId) {
        throw new ApiError(
          "STORE_NODE_REMAP_FAILED",
          `Unable to remap diagnostic question node_id for ${sourceNodeId}.`,
          422,
        );
      }

      return remappedNodeId;
    })(),
  }));
}

function createGraphIdentityFingerprint(
  graph: Pick<StoreRouteRequest["graph"], "subject" | "topic" | "description">,
): string {
  return createHash("sha256")
    .update([graph.subject, graph.topic, graph.description.replace(/\s+/g, " ").trim()].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function loadExactDuplicateCandidates(
  graph: Pick<StoreRouteRequest["graph"], "subject" | "topic" | "description">,
  dependencies: StoreGraphDependencies,
): Promise<DuplicateGraphCandidate[]> {
  if (dependencies.findExactDuplicateCandidates) {
    return dependencies.findExactDuplicateCandidates(graph);
  }

  const client = getServiceClient(dependencies);
  await ensureDbSurfaceAvailable(client, STORE_EXACT_DUPLICATE_SURFACE);
  const { data, error } = await client
    .from("graphs")
    .select(STORE_EXACT_DUPLICATE_SURFACE.select)
    .eq("subject", graph.subject)
    .eq("topic", graph.topic)
    .eq("description", graph.description);

  if (error) {
    if (isDbSchemaMismatchError(error)) {
      throw createDbSchemaOutOfSyncError(STORE_EXACT_DUPLICATE_SURFACE, error, {
        lookup_mode: "exact",
      });
    }

    throw new ApiError(
      "STORE_PERSISTENCE_UNAVAILABLE",
      "Failed to load exact duplicate candidates.",
      503,
      { cause: error.message },
    );
  }

  const duplicateRows = (data ?? []) as unknown as GraphDuplicateRow[];

  return duplicateRows.map((candidate) =>
    parseSchemaOrThrow({
      schema: retrievalCandidateSchema,
      value: {
        id: candidate.id,
        similarity: 1,
        flagged_for_review: candidate.flagged_for_review,
        version: candidate.version,
        created_at: candidate.created_at,
      },
      errorCode: "STORE_UNEXPECTED_INTERNAL",
      message: "Failed to parse exact duplicate candidate row returned from graphs.",
      schemaName: "retrievalCandidateSchema",
      phase: "store.duplicate_recheck.read_parse",
      details: {
        source_table: "graphs",
        lookup_mode: "exact",
        candidate_id: candidate.id,
        raw_created_at: candidate.created_at,
      },
    }),
  );
}

async function loadNextGraphVersion(
  client: FoundationSupabaseClient,
  graph: StoreRouteRequest["graph"],
): Promise<number> {
  if (typeof (client as { from?: unknown }).from !== "function") {
    return 1;
  }

  const { data, error } = await client
    .from("graphs")
    .select("version")
    .eq("subject", graph.subject)
    .eq("topic", graph.topic)
    .order("version", { ascending: false })
    .limit(1);

  if (error) {
    throw new ApiError(
      "STORE_PERSISTENCE_UNAVAILABLE",
      "Failed to determine the next graph version.",
      503,
      { cause: error.message },
    );
  }

  const currentVersion = data?.[0]?.version ?? 0;
  return currentVersion + 1;
}

type DuplicateGraphDecision = {
  graph_id: string | null;
  reason: "below_threshold" | "usable_unflagged_match" | "only_flagged_matches" | "no_candidates";
  candidate: DuplicateGraphCandidate | null;
  lookup_mode: "exact" | "semantic";
};

type DuplicateGraphLookupResult = {
  decision: DuplicateGraphDecision;
  embedding: number[] | null;
};

async function recheckForDuplicateGraph(
  graph: StoreRouteRequest["graph"],
  dependencies: StoreGraphDependencies,
): Promise<DuplicateGraphLookupResult> {
  const exactCandidates = sortRetrievalCandidates(
    await loadExactDuplicateCandidates(graph, dependencies),
  );

  if (exactCandidates.length > 0) {
    const usableExactMatch = exactCandidates.find((candidate) => !candidate.flagged_for_review);

    if (!usableExactMatch) {
      return {
        decision: {
          graph_id: null,
          reason: "only_flagged_matches",
          candidate: exactCandidates[0] ?? null,
          lookup_mode: "exact",
        },
        embedding: null,
      };
    }

    return {
      decision: {
        graph_id: usableExactMatch.id,
        reason: "usable_unflagged_match",
        candidate: usableExactMatch,
        lookup_mode: "exact",
      },
      embedding: null,
    };
  }

  const embedding =
    dependencies.precomputedEmbedding ??
    (await embedDescription(graph.description, dependencies));
  const candidates = await loadRetrievalCandidates(graph.subject, embedding, dependencies);
  const sortedCandidates = sortRetrievalCandidates(candidates);
  const thresholdCandidates = sortedCandidates.filter(
    (candidate) => candidate.similarity >= RETRIEVAL_THRESHOLD,
  );

  if (sortedCandidates.length === 0) {
    return {
      decision: {
        graph_id: null,
        reason: "no_candidates",
        candidate: null,
        lookup_mode: "semantic",
      },
      embedding,
    };
  }

  if (thresholdCandidates.length === 0) {
    return {
      decision: {
        graph_id: null,
        reason: "below_threshold",
        candidate: sortedCandidates[0] ?? null,
        lookup_mode: "semantic",
      },
      embedding,
    };
  }

  const usableMatch = thresholdCandidates.find((candidate) => !candidate.flagged_for_review);
  if (!usableMatch) {
    return {
      decision: {
        graph_id: null,
        reason: "only_flagged_matches",
        candidate: thresholdCandidates[0] ?? null,
        lookup_mode: "semantic",
      },
      embedding,
    };
  }

  return {
    decision: {
      graph_id: usableMatch.id,
      reason: "usable_unflagged_match",
      candidate: usableMatch,
      lookup_mode: "semantic",
    },
    embedding,
  };
}

async function persistGraphRowsWithFallback(
  client: FoundationSupabaseClient,
  input: {
    graph: {
      id: string;
      title: string;
      subject: StoreRouteRequest["graph"]["subject"];
      topic: string;
      description: string;
      embedding: number[];
      version: number;
      flagged_for_review: boolean;
    };
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    embedding: number[];
  },
  context?: RequestLogContext,
): Promise<string> {
  const persistWithRpc = async (): Promise<string> => {
    const { data, error } = await client.rpc("store_generated_graph", {
      p_graph: input.graph,
      p_nodes: input.nodes as Json,
      p_edges: input.edges as Json,
      p_embedding: formatVectorLiteral(input.embedding),
    });

    if (error) {
      throw new ApiError(
        "STORE_GRAPH_INSERT_FAILED",
        "Failed to persist the generated graph.",
        503,
        { cause: error.message },
      );
    }

    return data?.[0]?.graph_id ?? input.graph.id;
  };

  try {
    return await persistWithRpc();
  } catch (error) {
    if (!shouldFallbackFromStoreRpc(error)) {
      throw error;
    }

    logWarn(
      context ?? {
        requestId: "store",
        route: "store",
        startedAtMs: Date.now(),
      },
      "store",
      "success",
      "Store RPC was unavailable; falling back to direct table writes.",
      {
        graph_id: input.graph.id,
        graph_version: input.graph.version,
        write_mode: "rpc_fallback_direct",
        fallback_node_write_mode: "detected_at_insert_time",
      },
    );

    return persistGraphRowsDirect(client, {
      graph: input.graph,
      nodes: input.nodes,
      edges: input.edges,
    });
  }
}

function shouldFallbackFromStoreRpc(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: unknown;
  };
  const pieces: string[] = [];

  if (error instanceof ApiError) {
    pieces.push(error.code, error.message);
  }

  if (typeof candidate.code === "string") {
    pieces.push(candidate.code);
  }

  if (typeof candidate.message === "string") {
    pieces.push(candidate.message);
  }

  if (typeof candidate.details === "string") {
    pieces.push(candidate.details);
  }

  if (typeof candidate.details === "object" && candidate.details !== null) {
    const nested = candidate.details as { cause?: unknown; message?: unknown };
    if (typeof nested.cause === "string") {
      pieces.push(nested.cause);
    }
    if (typeof nested.message === "string") {
      pieces.push(nested.message);
    }
  }

  if (typeof candidate.cause === "string") {
    pieces.push(candidate.cause);
  }

  const haystack = pieces.join(" ").toLowerCase();

  return (
    haystack.includes("could not find the function") ||
    haystack.includes("schema cache") ||
    haystack.includes("pgrst202") ||
    haystack.includes("pgrst204")
  );
}

async function persistGraphRowsDirect(
  client: FoundationSupabaseClient,
  input: {
    graph: {
      id: string;
      title: string;
      subject: StoreRouteRequest["graph"]["subject"];
      topic: string;
      description: string;
      embedding: number[];
      version: number;
      flagged_for_review: boolean;
    };
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  },
): Promise<string> {
  const persistedNodeIds = input.nodes
    .map((node) => {
      const nodeId = node.id;
      return typeof nodeId === "string" ? nodeId : null;
    })
    .filter((nodeId): nodeId is string => nodeId !== null);

  await ensureDbSurfacesAvailable(client, [
    STORE_FALLBACK_GRAPHS_SURFACE,
    STORE_FALLBACK_NODES_REQUIRED_SURFACE,
    STORE_FALLBACK_EDGES_SURFACE,
  ]);
  const supportsLessonStatus = await detectDbSurfaceAvailable(
    client,
    STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  );
  const nodeWriteMode: NodeWriteMode = supportsLessonStatus
    ? "with_lesson_status"
    : "without_lesson_status";
  const nodeInsertRows = input.nodes.map((node) => {
    if (supportsLessonStatus) {
      return node;
    }

    const { lesson_status, ...nodeWithoutLessonStatus } = node;
    void lesson_status;
    return nodeWithoutLessonStatus;
  });

  const { error: graphError } = await client.from("graphs").insert({
    id: input.graph.id,
    title: input.graph.title,
    subject: input.graph.subject,
    topic: input.graph.topic,
    description: input.graph.description,
    embedding: input.graph.embedding,
    version: input.graph.version,
    flagged_for_review: input.graph.flagged_for_review,
  });
  if (graphError) {
    if (isDbSchemaMismatchError(graphError)) {
      throw createDbSchemaOutOfSyncError(STORE_FALLBACK_GRAPHS_SURFACE, graphError);
    }
    throw new ApiError(
      "STORE_GRAPH_INSERT_FAILED",
      "Failed to persist the generated graph header row.",
      503,
      { cause: graphError.message },
    );
  }

  try {
    const { error: nodeError } = await client.from("nodes").insert(
      nodeInsertRows as never,
    );
    if (nodeError) {
      if (isDbSchemaMismatchError(nodeError)) {
        throw createDbSchemaOutOfSyncError(
          supportsLessonStatus
            ? STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE
            : STORE_FALLBACK_NODES_REQUIRED_SURFACE,
          nodeError,
          { node_write_mode: nodeWriteMode },
        );
      }
      throw new ApiError(
        "STORE_GRAPH_INSERT_FAILED",
        "Failed to persist the generated graph nodes.",
        503,
        { cause: nodeError.message, node_write_mode: nodeWriteMode },
      );
    }

    const { error: edgeError } = await client.from("edges").insert(
      input.edges as never,
    );
    if (edgeError) {
      if (isDbSchemaMismatchError(edgeError)) {
        throw createDbSchemaOutOfSyncError(STORE_FALLBACK_EDGES_SURFACE, edgeError);
      }
      throw new ApiError(
        "STORE_GRAPH_INSERT_FAILED",
        "Failed to persist the generated graph edges.",
        503,
        { cause: edgeError.message },
      );
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled([
      client.from("edges").delete().in("from_node_id", persistedNodeIds).in("to_node_id", persistedNodeIds),
      client.from("nodes").delete().eq("graph_id", input.graph.id),
      client.from("graphs").delete().eq("id", input.graph.id),
    ]);
    const cleanupErrors = cleanupResults
      .map((result, index) => {
        if (result.status === "fulfilled") {
          if (!result.value.error) {
            return null;
          }

          const surface =
            index === 0
              ? STORE_FALLBACK_EDGES_SURFACE.name
              : index === 1
                ? STORE_FALLBACK_NODES_REQUIRED_SURFACE.name
                : STORE_FALLBACK_GRAPHS_SURFACE.name;

          return {
            surface,
            message: result.value.error.message,
          };
        }

        const surface =
          index === 0
            ? STORE_FALLBACK_EDGES_SURFACE.name
            : index === 1
              ? STORE_FALLBACK_NODES_REQUIRED_SURFACE.name
              : STORE_FALLBACK_GRAPHS_SURFACE.name;

        const rejection = result.reason;
        if (!rejection) {
          return null;
        }

        return {
          surface,
          message: rejection instanceof Error ? rejection.message : String(rejection),
        };
      })
      .filter((entry): entry is { surface: string; message: string } => entry !== null);

    if (cleanupErrors.length > 0) {
      throw new ApiError(
        "STORE_PARTIAL_WRITE_PREVENTED",
        "Generated graph persistence failed and the partial write could not be fully rolled back.",
        503,
        {
          graph_id: input.graph.id,
          node_ids: persistedNodeIds,
          cleanup_errors: cleanupErrors,
          cause:
            error instanceof Error ? error.message : "Generated graph persistence failed.",
        },
      );
    }

    throw error;
  }

  return input.graph.id;
}

export async function storeGeneratedGraph(
  input: StoreRouteRequest,
  contextOrDependencies?: RequestLogContext | StoreGraphDependencies,
  maybeDependencies: StoreGraphDependencies = {},
): Promise<StoreGeneratedGraphResult> {
  const parsedInput = storeRouteRequestSchema.parse(input);
  if (!validateCanonicalDescription(parsedInput.graph.description)) {
    throw new ApiError(
      "STORE_INPUT_INVALID",
      "Graph description must preserve the canonical four-sentence contract.",
      400,
    );
  }
  const context =
    contextOrDependencies &&
    "requestId" in contextOrDependencies &&
    "route" in contextOrDependencies
      ? contextOrDependencies
      : undefined;
  const dependencies =
    contextOrDependencies &&
    !("requestId" in contextOrDependencies) &&
    !("route" in contextOrDependencies)
      ? contextOrDependencies
      : maybeDependencies;
  const client = getServiceClient(dependencies);
  const graphFingerprint = createGraphIdentityFingerprint(parsedInput.graph);

  logInfo(
    context ?? {
      requestId: "store",
      route: "store",
      startedAtMs: Date.now(),
    },
    "store",
    "start",
    "Starting graph store flow.",
    {
      topic: parsedInput.graph.topic,
      graph_identity_fingerprint: graphFingerprint,
    },
  );

  const duplicateLookup = await recheckForDuplicateGraph(parsedInput.graph, dependencies);
  const duplicateDecision = duplicateLookup.decision;
  if (duplicateDecision.graph_id) {
    const duplicateResponse = {
      graph_id: duplicateDecision.graph_id,
      duplicate_of_graph_id: duplicateDecision.graph_id,
    } satisfies StoreGeneratedGraphResult;

    logInfo(
      context ?? {
        requestId: "store",
        route: "store",
        startedAtMs: Date.now(),
      },
      "store",
      "success",
      "Store duplicate safeguard returned existing graph.",
      {
        graph_id: duplicateDecision.graph_id,
        duplicate_reason: duplicateDecision.reason,
        duplicate_candidate_id: duplicateDecision.candidate?.id ?? null,
        duplicate_candidate_similarity: duplicateDecision.candidate?.similarity ?? null,
        duplicate_candidate_flagged_for_review:
          duplicateDecision.candidate?.flagged_for_review ?? null,
        duplicate_threshold: RETRIEVAL_THRESHOLD,
        duplicate_lookup_mode: duplicateDecision.lookup_mode,
        graph_identity_fingerprint: graphFingerprint,
      },
    );

    return duplicateResponse;
  }

  const graphId = (dependencies.createUuid ?? randomUUID)();
  const version = await loadNextGraphVersion(client, parsedInput.graph);
  const embedding =
    duplicateLookup.embedding ??
    dependencies.precomputedEmbedding ??
    (await embedDescription(parsedInput.graph.description, dependencies));
  const nodeIdMap = new Map<string, string>();

  const nodeRows = parsedInput.nodes.map((node) => {
    const normalizedP5Code = node.p5_code?.trim() ?? null;
    const isP5CodeEmpty = normalizedP5Code === null || normalizedP5Code.length === 0;
    const visualCodeViolations = normalizedP5Code
      ? validateVisualP5CodeRestrictions(normalizedP5Code)
      : [];
    if (visualCodeViolations.length > 0) {
      throw new ApiError(
        "STORE_INPUT_INVALID",
        `Visual code for ${node.id} includes restricted snippets.`,
        400,
        { violations: visualCodeViolations },
      );
    }

    if (node.visual_verified && isP5CodeEmpty) {
      throw new ApiError(
        "STORE_INPUT_INVALID",
        `visual_verified nodes must persist non-empty p5_code: ${node.id}.`,
        400,
      );
    }

    if (!node.visual_verified && !isP5CodeEmpty) {
      throw new ApiError(
        "STORE_INPUT_INVALID",
        `Unverified visuals must persist empty p5_code: ${node.id}.`,
        400,
      );
    }

    if (
      node.lesson_status === "pending" &&
      (
        node.lesson_text !== null ||
        node.static_diagram !== null ||
        node.quiz_json !== null ||
        node.diagnostic_questions !== null ||
        normalizedP5Code !== null
      )
    ) {
      throw new ApiError(
        "STORE_INPUT_INVALID",
        `Pending skeleton nodes must persist with null content fields: ${node.id}.`,
        400,
      );
    }

    const persistedId = (dependencies.createUuid ?? randomUUID)();
    nodeIdMap.set(node.id, persistedId);

    return {
      id: persistedId,
      graph_id: graphId,
      graph_version: version,
      title: node.title,
      lesson_text: node.lesson_text,
      static_diagram: node.static_diagram,
      p5_code: normalizedP5Code,
      visual_verified: node.visual_verified,
      quiz_json: node.quiz_json,
      diagnostic_questions: remapDiagnosticQuestionsNodeIds(node.id, node.diagnostic_questions, nodeIdMap),
      lesson_status: node.lesson_status,
      position: node.position,
      attempt_count: 0,
      pass_count: 0,
    };
  });

  const edgeRows = parsedInput.edges.map((edge) => {
    const fromNodeId = nodeIdMap.get(edge.from_node_id);
    const toNodeId = nodeIdMap.get(edge.to_node_id);

    if (!fromNodeId || !toNodeId) {
      throw new ApiError(
        "STORE_NODE_REMAP_FAILED",
        `Failed to remap generated edge ids before persistence: ${edge.from_node_id} -> ${edge.to_node_id}.`,
        422,
      );
    }

    return {
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      type: edge.type,
    } as const;
  });

  const graphStoreId = await persistGraphRowsWithFallback(client, {
      graph: {
        id: graphId,
        title: parsedInput.graph.title,
        subject: parsedInput.graph.subject,
        topic: parsedInput.graph.topic,
        description: parsedInput.graph.description,
        embedding,
        version,
        flagged_for_review: false,
    },
    nodes: nodeRows,
    edges: edgeRows,
    embedding,
  }, context);
  const response = {
    graph_id: graphStoreId,
    node_id_map: Object.fromEntries(nodeIdMap.entries()),
  } satisfies StoreGeneratedGraphResult;
  logInfo(
    context ?? {
      requestId: "store",
      route: "store",
      startedAtMs: Date.now(),
    },
    "store",
    "success",
    "Graph store flow completed.",
    { graph_id: graphStoreId, version },
  );
  return response;
}

export async function storeGraphSkeleton(
  input: SkeletonStoreRequest,
  contextOrDependencies?: RequestLogContext | StoreGraphDependencies,
  maybeDependencies: StoreGraphDependencies = {},
): Promise<StoreSkeletonResult> {
  const parsedInput = skeletonStoreRequestSchema.parse(input);
  if (!validateCanonicalDescription(parsedInput.graph.description)) {
    throw new ApiError(
      "STORE_INPUT_INVALID",
      "Graph description must preserve the canonical four-sentence contract.",
      400,
    );
  }

  const context =
    contextOrDependencies &&
    "requestId" in contextOrDependencies &&
    "route" in contextOrDependencies
      ? contextOrDependencies
      : undefined;
  const dependencies =
    contextOrDependencies &&
    !("requestId" in contextOrDependencies) &&
    !("route" in contextOrDependencies)
      ? contextOrDependencies
      : maybeDependencies;
  const client = getServiceClient(dependencies);
  const graphFingerprint = createGraphIdentityFingerprint(parsedInput.graph);

  logInfo(
    context ?? {
      requestId: "store-skeleton",
      route: "store-skeleton",
      startedAtMs: Date.now(),
    },
    "store",
    "start",
    "Starting graph skeleton store flow.",
    {
      topic: parsedInput.graph.topic,
      graph_identity_fingerprint: graphFingerprint,
    },
  );

  const duplicateLookup = await recheckForDuplicateGraph(parsedInput.graph, dependencies);
  const duplicateDecision = duplicateLookup.decision;
  if (duplicateDecision.graph_id) {
    logInfo(
      context ?? {
        requestId: "store-skeleton",
        route: "store-skeleton",
        startedAtMs: Date.now(),
      },
      "store",
      "success",
      "Store skeleton duplicate safeguard returned existing graph.",
      {
        graph_id: duplicateDecision.graph_id,
        duplicate_reason: duplicateDecision.reason,
        duplicate_candidate_id: duplicateDecision.candidate?.id ?? null,
        duplicate_candidate_similarity: duplicateDecision.candidate?.similarity ?? null,
        duplicate_candidate_flagged_for_review:
          duplicateDecision.candidate?.flagged_for_review ?? null,
        duplicate_threshold: RETRIEVAL_THRESHOLD,
        duplicate_lookup_mode: duplicateDecision.lookup_mode,
        graph_identity_fingerprint: graphFingerprint,
      },
    );
    return {
      graph_id: duplicateDecision.graph_id,
      duplicate_of_graph_id: duplicateDecision.graph_id,
    };
  }

  const graphId = (dependencies.createUuid ?? randomUUID)();
  const version = await loadNextGraphVersion(client, parsedInput.graph);
  const embedding =
    duplicateLookup.embedding ??
    dependencies.precomputedEmbedding ??
    (await embedDescription(parsedInput.graph.description, dependencies));
  const nodeIdMap = new Map<string, string>();

  const nodeRows = parsedInput.nodes.map((node) => {
    const persistedId = (dependencies.createUuid ?? randomUUID)();
    nodeIdMap.set(node.id, persistedId);

    return {
      id: persistedId,
      graph_id: graphId,
      graph_version: version,
      title: node.title,
      lesson_text: null,
      static_diagram: null,
      p5_code: null,
      visual_verified: false as const,
      quiz_json: null,
      diagnostic_questions: null,
      lesson_status: "pending" as const,
      position: node.position,
      attempt_count: 0 as const,
      pass_count: 0 as const,
    };
  });

  const edgeRows = parsedInput.edges.map((edge) => {
    const fromNodeId = nodeIdMap.get(edge.from_node_id);
    const toNodeId = nodeIdMap.get(edge.to_node_id);

    if (!fromNodeId || !toNodeId) {
      throw new ApiError(
        "STORE_NODE_REMAP_FAILED",
        `Failed to remap generated edge ids before skeleton persistence: ${edge.from_node_id} -> ${edge.to_node_id}.`,
        422,
      );
    }

    return {
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      type: edge.type,
    } as const;
  });

  const graphStoreId = await persistGraphRowsWithFallback(client, {
    graph: {
      id: graphId,
      title: parsedInput.graph.title,
      subject: parsedInput.graph.subject,
      topic: parsedInput.graph.topic,
      description: parsedInput.graph.description,
      embedding,
      version,
      flagged_for_review: false,
    },
    nodes: nodeRows,
    edges: edgeRows,
    embedding,
  }, context);

  return {
    graph_id: graphStoreId,
    version,
    persisted_nodes: nodeRows,
    persisted_edges: edgeRows,
    node_id_map: Object.fromEntries(nodeIdMap.entries()),
  };
}

export async function updateStoredNode(
  input: {
    graph_id: string;
    node: Pick<
      Node,
      | "id"
      | "lesson_text"
      | "static_diagram"
      | "p5_code"
      | "visual_verified"
      | "quiz_json"
      | "diagnostic_questions"
      | "lesson_status"
    >;
  },
  dependencies: StoreGraphDependencies = {},
): Promise<Node> {
  const client = getServiceClient(dependencies);
  const normalizedP5Code = input.node.p5_code?.trim() ?? null;
  const supportsLessonStatus = await detectDbSurfaceAvailable(
    client,
    STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE,
  );
  const nodeWriteMode: NodeWriteMode = supportsLessonStatus
    ? "with_lesson_status"
    : "without_lesson_status";
  const updatePayload = supportsLessonStatus
    ? {
        lesson_text: input.node.lesson_text,
        static_diagram: input.node.static_diagram,
        p5_code: normalizedP5Code,
        visual_verified: input.node.visual_verified,
        quiz_json: input.node.quiz_json,
        diagnostic_questions: input.node.diagnostic_questions,
        lesson_status: input.node.lesson_status,
      }
    : {
        lesson_text: input.node.lesson_text,
        static_diagram: input.node.static_diagram,
        p5_code: normalizedP5Code,
        visual_verified: input.node.visual_verified,
        quiz_json: input.node.quiz_json,
        diagnostic_questions: input.node.diagnostic_questions,
      };
  const selectClause = supportsLessonStatus
    ? "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,lesson_status,position,attempt_count,pass_count"
    : "id,graph_id,graph_version,title,lesson_text,static_diagram,p5_code,visual_verified,quiz_json,diagnostic_questions,position,attempt_count,pass_count";

  const { data, error } = await client
    .from("nodes")
    .update(updatePayload)
    .eq("graph_id", input.graph_id)
    .eq("id", input.node.id)
    .select(selectClause)
    .maybeSingle();

  if (error) {
    if (isDbSchemaMismatchError(error)) {
      throw createDbSchemaOutOfSyncError(
        supportsLessonStatus
          ? STORE_FALLBACK_NODES_OPTIONAL_LESSON_STATUS_SURFACE
          : STORE_FALLBACK_NODES_REQUIRED_SURFACE,
        error,
        {
          graph_id: input.graph_id,
          node_id: input.node.id,
          node_write_mode: nodeWriteMode,
        },
      );
    }
    throw new ApiError(
      "STORE_NODE_UPDATE_FAILED",
      "Failed to persist incremental node artifacts.",
      503,
      {
        graph_id: input.graph_id,
        node_id: input.node.id,
        cause: error.message,
        node_write_mode: nodeWriteMode,
      },
    );
  }

  if (!data) {
    throw new ApiError(
      "STORE_NODE_UPDATE_FAILED",
      "The incremental node update returned no stored row.",
      503,
      {
        graph_id: input.graph_id,
        node_id: input.node.id,
      },
    );
  }

  const storedNode = data as unknown as Record<string, unknown>;

  return nodeSchema.parse({
    ...storedNode,
    lesson_status:
      "lesson_status" in storedNode && storedNode.lesson_status
        ? storedNode.lesson_status
        : input.node.lesson_status,
  });
}

function mapStoreStageError(
  error: unknown,
  input: StoreRouteRequest,
): StageError {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "STORE_INPUT_INVALID":
        return {
          code: "STORE_INPUT_INVALID",
          category: "input_validation",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: false,
        };
      case "STORE_NODE_REMAP_FAILED":
        return {
          code: "STORE_NODE_REMAP_FAILED",
          category: "id_remap_failure",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: false,
        };
      case "STORE_PERSISTENCE_UNAVAILABLE":
        return {
          code: "STORE_PERSISTENCE_UNAVAILABLE",
          category: "persistence_unavailable",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: true,
        };
      case "DB_SCHEMA_OUT_OF_SYNC":
        return {
          code: "STORE_GRAPH_INSERT_FAILED",
          category: "store_failure",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: false,
        };
      case "STORE_GRAPH_INSERT_FAILED":
        return {
          code: "STORE_GRAPH_INSERT_FAILED",
          category: "store_failure",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: true,
        };
      case "STORE_NODE_UPDATE_FAILED":
        return {
          code: "STORE_NODE_UPDATE_FAILED",
          category: "store_failure",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: true,
        };
      case "STORE_PARTIAL_WRITE_PREVENTED":
        return {
          code: "STORE_PARTIAL_WRITE_PREVENTED",
          category: "store_failure",
          stage: "store",
          message: error.message,
          details: error.details as Record<string, unknown> | undefined,
          retryable: false,
        };
      default:
        return {
          code:
            error.code === "STORE_UNEXPECTED_INTERNAL"
              ? "STORE_UNEXPECTED_INTERNAL"
              : STORE_ERROR_CODES.unexpected_internal,
          category: "unexpected_internal",
          stage: "store",
          message: error.message,
          details: {
            graph_topic: input.graph.topic,
            node_count: input.nodes.length,
            edge_count: input.edges.length,
            ...(typeof error.details === "object" && error.details !== null
              ? (error.details as Record<string, unknown>)
              : {}),
          },
          retryable: false,
        };
    }
  }

  return {
    code: STORE_ERROR_CODES.unexpected_internal,
    category: "unexpected_internal",
    stage: "store",
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
    details: {
      graph_topic: input.graph.topic,
      node_count: input.nodes.length,
      edge_count: input.edges.length,
    },
    retryable: false,
  };
}

export async function runStoreStage(
  input: StoreRouteRequest,
  context: RequestLogContext,
  dependencies: StoreGraphDependencies = {},
): Promise<StageResultEnvelope<StoreStageData>> {
  const parsed = storeRouteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return storeStageResponseSchema.parse(
      createStageInputError({
        stage: "store",
        request_id: context.requestId,
        code: "STORE_INPUT_INVALID",
        message: "Expected body with graph, nodes, and edges for store.",
        details: parsed.error.flatten(),
      }),
    );
  }

  const startedAtMs = Date.now();
  logStageStart(context, {
    stage: "store",
    attempts: 1,
    duration_ms: 0,
    details: {
      graph_topic: parsed.data.graph.topic,
      node_count: parsed.data.nodes.length,
      edge_count: parsed.data.edges.length,
    },
  });

  try {
    const stored = await storeGeneratedGraph(parsed.data, context, dependencies);
    const durationMs = Date.now() - startedAtMs;
    const isDuplicate = Boolean(stored.duplicate_of_graph_id);
    const data: StoreStageData = {
      graph_id: stored.graph_id,
      duplicate_of_graph_id: stored.duplicate_of_graph_id ?? null,
      write_mode: isDuplicate ? "duplicate_recheck_hit" : "persisted",
      remapped_node_count: isDuplicate ? 0 : parsed.data.nodes.length,
      persisted_node_count: isDuplicate ? 0 : parsed.data.nodes.length,
      persisted_edge_count: isDuplicate ? 0 : parsed.data.edges.length,
    };
    const result = createStageSuccessResult({
      stage: "store",
      request_id: context.requestId,
      duration_ms: durationMs,
      attempts: 1,
      data,
    });
    logStageSuccess(context, {
      stage: "store",
      attempts: 1,
      duration_ms: durationMs,
      message: "Store stage completed.",
      details: {
        graph_id: data.graph_id,
        write_mode: data.write_mode,
        persisted_node_count: data.persisted_node_count,
        persisted_edge_count: data.persisted_edge_count,
      },
    });
    return storeStageResponseSchema.parse(result);
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const stageError = mapStoreStageError(error, parsed.data);
    const result = createStageErrorResult<StoreStageData>({
      stage: "store",
      request_id: context.requestId,
      duration_ms: durationMs,
      attempts: 1,
      error: stageError,
    });
    logStageError(context, {
      stage: "store",
      attempts: 1,
      duration_ms: durationMs,
      error: stageError,
      details: {
        graph_topic: parsed.data.graph.topic,
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
      },
    });
    return storeStageResponseSchema.parse(result);
  }
}
