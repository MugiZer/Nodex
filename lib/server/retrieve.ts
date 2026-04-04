import { ApiError } from "@/lib/errors";
import { getOpenAIClient, OPENAI_EMBEDDING_MODEL } from "@/lib/openai";
import { decideRetrievalCandidate } from "@/lib/domain/retrieval";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";
import { retrievalCandidateSchema, retrieveRequestSchema } from "@/lib/schemas";
import { parseSchemaOrThrow } from "@/lib/server/schema-parse";
import {
  createDbSchemaOutOfSyncError,
  ensureDbSurfaceAvailable,
  isDbSchemaMismatchError,
  GRAPH_READ_EDGES_SURFACE,
  GRAPH_READ_NODES_SURFACE,
  RETRIEVE_FALLBACK_SURFACE,
} from "@/lib/server/db-contract";
import type {
  RetrieveRequest,
  RetrieveResponse,
  RetrievalCandidate,
  SupportedSubject,
} from "@/lib/types";
import type { Database } from "@/supabase/database.types";

export type RetrievalDependencies = {
  createServiceClient?: () => FoundationSupabaseClient;
  embedDescription?: (description: string) => Promise<number[]>;
  precomputedEmbedding?: number[];
  searchRetrievalCandidates?: (
    subject: SupportedSubject,
    embedding: number[],
  ) => Promise<RetrievalCandidate[]>;
};

type RetrievedCandidates = {
  candidates: RetrievalCandidate[];
  usedFallback: boolean;
};

function getServiceClient(
  dependencies: RetrievalDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

function shouldDisallowRpcFallback(): boolean {
  return process.env.FOUNDATION_STRICT_DB_PATHS === "true";
}

function getDbErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "";
}

async function hasPersistedGraphSkeleton(
  client: FoundationSupabaseClient,
  graphId: string,
): Promise<boolean> {
  await ensureDbSurfaceAvailable(client, GRAPH_READ_NODES_SURFACE);
  await ensureDbSurfaceAvailable(client, GRAPH_READ_EDGES_SURFACE);

  const { data: nodeRows, error: nodeError } = await client
    .from("nodes")
    .select("id")
    .eq("graph_id", graphId);

  if (nodeError) {
    if (isDbSchemaMismatchError(nodeError)) {
      throw createDbSchemaOutOfSyncError(GRAPH_READ_NODES_SURFACE, nodeError, {
        graph_id: graphId,
        check_mode: "retrieval_viability",
      });
    }

    throw new ApiError(
      "RETRIEVAL_FAILED",
      "Failed to verify graph viability before returning a cache hit.",
      500,
      { graph_id: graphId, cause: getDbErrorMessage(nodeError) },
    );
  }

  const nodeIds = (nodeRows ?? [])
    .map((row) => {
      if (!row || typeof row !== "object" || !("id" in row)) {
        return null;
      }
      const nodeId = (row as { id?: unknown }).id;
      return typeof nodeId === "string" ? nodeId : null;
    })
    .filter((nodeId): nodeId is string => nodeId !== null);

  if (nodeIds.length === 0) {
    return false;
  }

  const { data: edgeRows, error: edgeError } = await client
    .from("edges")
    .select("from_node_id,to_node_id")
    .in("from_node_id", nodeIds)
    .in("to_node_id", nodeIds);

  if (edgeError) {
    if (isDbSchemaMismatchError(edgeError)) {
      throw createDbSchemaOutOfSyncError(GRAPH_READ_EDGES_SURFACE, edgeError, {
        graph_id: graphId,
        check_mode: "retrieval_viability",
      });
    }

    throw new ApiError(
      "RETRIEVAL_FAILED",
      "Failed to verify graph edge viability before returning a cache hit.",
      500,
      { graph_id: graphId, cause: getDbErrorMessage(edgeError) },
    );
  }

  return (edgeRows ?? []).length > 0;
}

function parseStoredEmbedding(embedding: string | number[] | null): number[] | null {
  if (!embedding) {
    return null;
  }

  if (Array.isArray(embedding)) {
    return embedding;
  }

  const trimmed = embedding.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }

  const values = trimmed
    .slice(1, -1)
    .split(",")
    .map((part) => Number(part.trim()));

  return values.every((value) => Number.isFinite(value)) ? values : null;
}

type GraphFallbackRow = Database["public"]["Tables"]["graphs"]["Row"];

function computeCosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    throw new ApiError(
      "RETRIEVAL_FAILED",
      "Embedding vectors must have the same non-zero dimension.",
      500,
    );
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

async function loadRetrievalCandidatesFallback(
  client: FoundationSupabaseClient,
  subject: SupportedSubject,
  embedding: number[],
): Promise<RetrievalCandidate[]> {
  await ensureDbSurfaceAvailable(client, RETRIEVE_FALLBACK_SURFACE);
  const { data, error } = await client
    .from("graphs")
    .select(RETRIEVE_FALLBACK_SURFACE.select)
    .eq("subject", subject)
    .not("embedding", "is", null);

  if (error) {
    if (isDbSchemaMismatchError(error)) {
      throw createDbSchemaOutOfSyncError(RETRIEVE_FALLBACK_SURFACE, error);
    }

    throw new ApiError(
      "RETRIEVAL_FAILED",
      "Failed to load retrieval candidates from graphs.",
      500,
      { cause: error.message },
    );
  }

  const fallbackRows = (data ?? []) as unknown as GraphFallbackRow[];

  return fallbackRows
    .map((row) => {
      const storedEmbedding = parseStoredEmbedding(
        row.embedding as string | number[] | null,
      );

      if (!storedEmbedding) {
        return null;
      }

      return parseSchemaOrThrow({
        schema: retrievalCandidateSchema,
        value: {
          id: row.id,
          similarity: computeCosineSimilarity(storedEmbedding, embedding),
          flagged_for_review: row.flagged_for_review,
          version: row.version,
          created_at: row.created_at,
        },
        errorCode: "RETRIEVAL_FAILED",
        message: "Failed to parse retrieval candidate row loaded from graphs.",
        schemaName: "retrievalCandidateSchema",
        phase: "retrieve.fallback_graphs.read_parse",
        details: {
          candidate_id: row.id,
          source_table: "graphs",
          raw_created_at: row.created_at,
        },
      });
    })
    .filter((candidate): candidate is RetrievalCandidate => candidate !== null);
}

export function formatVectorLiteral(values: number[]): string {
  if (values.length === 0) {
    throw new Error("Embedding vectors must not be empty.");
  }

  return `[${values.join(",")}]`;
}

export async function embedDescription(
  description: string,
  dependencies: RetrievalDependencies = {},
): Promise<number[]> {
  if (dependencies.embedDescription) {
    return dependencies.embedDescription(description);
  }

  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: OPENAI_EMBEDDING_MODEL,
    input: description,
  });

  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new ApiError(
      "EMBEDDING_FAILED",
      "OpenAI did not return an embedding vector.",
      500,
    );
  }

  return embedding;
}

export async function loadRetrievalCandidates(
  subject: SupportedSubject,
  embedding: number[],
  dependencies: RetrievalDependencies = {},
): Promise<RetrievalCandidate[]> {
  const { candidates } = await loadRetrievalCandidatesWithMode(
    subject,
    embedding,
    dependencies,
  );

  return candidates;
}

async function loadRetrievalCandidatesWithMode(
  subject: SupportedSubject,
  embedding: number[],
  dependencies: RetrievalDependencies = {},
): Promise<RetrievedCandidates> {
  if (dependencies.searchRetrievalCandidates) {
    return {
      candidates: await dependencies.searchRetrievalCandidates(subject, embedding),
      usedFallback: false,
    };
  }

  const client = getServiceClient(dependencies);
  const { data, error } = await client.rpc("search_graph_candidates", {
    p_subject: subject,
    p_embedding: formatVectorLiteral(embedding),
    p_limit: 25,
  });

  if (error) {
    if (shouldDisallowRpcFallback()) {
      throw new ApiError(
        "RETRIEVAL_FAILED",
        "Retrieval RPC is unavailable and strict DB paths are enabled.",
        500,
        { cause: error.message },
      );
    }

    console.warn(
      JSON.stringify({
        level: "warn",
        stage: "retrieve",
        event: "rpc_fallback",
        message: "Falling back to direct graph retrieval because search_graph_candidates RPC is unavailable.",
        cause: error.message,
      }),
    );

    return {
      candidates: await loadRetrievalCandidatesFallback(client, subject, embedding),
      usedFallback: true,
    };
  }

  return {
    candidates: (data ?? []).map((candidate) =>
      parseSchemaOrThrow({
        schema: retrievalCandidateSchema,
        value: candidate,
        errorCode: "RETRIEVAL_FAILED",
        message: "Failed to parse retrieval candidate row.",
        schemaName: "retrievalCandidateSchema",
        phase: "retrieve.search_candidates.read_parse",
        details: {
          candidate_id:
            typeof candidate === "object" && candidate !== null && "id" in candidate
              ? String(candidate.id)
              : null,
          raw_created_at:
            typeof candidate === "object" &&
            candidate !== null &&
            "created_at" in candidate
              ? String(candidate.created_at)
              : null,
        },
      }),
    ),
    usedFallback: false,
  };
}

export async function retrieveGraphId(
  input: RetrieveRequest,
  dependencies: RetrievalDependencies = {},
): Promise<RetrieveResponse> {
  const parsedInput = retrieveRequestSchema.parse(input);
  const embedding =
    dependencies.precomputedEmbedding ?? (await embedDescription(parsedInput.description, dependencies));
  const { candidates } = await loadRetrievalCandidatesWithMode(
    parsedInput.subject,
    embedding,
    dependencies,
  );
  const decision = decideRetrievalCandidate(candidates);

  if (!decision.graph_id) {
    return { graph_id: null };
  }

  if (dependencies.searchRetrievalCandidates && !dependencies.createServiceClient) {
    return { graph_id: decision.graph_id };
  }

  const client = getServiceClient(dependencies);
  const usable = await hasPersistedGraphSkeleton(client, decision.graph_id);
  if (!usable) {
    console.warn(
      JSON.stringify({
        level: "warn",
        stage: "retrieve",
        event: "incomplete_cache_rejected",
        message: "Skipping cached graph id because the persisted graph skeleton is incomplete.",
        graph_id: decision.graph_id,
      }),
    );
  }
  return {
    graph_id: usable ? decision.graph_id : null,
  };
}
