import { ApiError } from "@/lib/errors";
import { getOpenAIClient, OPENAI_EMBEDDING_MODEL } from "@/lib/openai";
import { decideRetrievalCandidate } from "@/lib/domain/retrieval";
import { createSupabaseServiceRoleClient, type FoundationSupabaseClient } from "@/lib/supabase";
import { retrievalCandidateSchema, retrieveRequestSchema } from "@/lib/schemas";
import type {
  RetrieveRequest,
  RetrieveResponse,
  RetrievalCandidate,
  SupportedSubject,
} from "@/lib/types";

export type RetrievalDependencies = {
  createServiceClient?: () => FoundationSupabaseClient;
  embedDescription?: (description: string) => Promise<number[]>;
  searchRetrievalCandidates?: (
    subject: SupportedSubject,
    embedding: number[],
  ) => Promise<RetrievalCandidate[]>;
};

function getServiceClient(
  dependencies: RetrievalDependencies,
): FoundationSupabaseClient {
  return dependencies.createServiceClient?.() ?? createSupabaseServiceRoleClient();
}

function shouldDisallowRpcFallback(): boolean {
  return process.env.FOUNDATION_STRICT_DB_PATHS === "true";
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
  const { data, error } = await client
    .from("graphs")
    .select("id,subject,embedding,flagged_for_review,version,created_at")
    .eq("subject", subject)
    .not("embedding", "is", null);

  if (error) {
    throw new ApiError(
      "RETRIEVAL_FAILED",
      "Failed to load retrieval candidates from graphs.",
      500,
      { cause: error.message },
    );
  }

  return (data ?? [])
    .map((row) => {
      const storedEmbedding = parseStoredEmbedding(
        row.embedding as string | number[] | null,
      );

      if (!storedEmbedding) {
        return null;
      }

      return retrievalCandidateSchema.parse({
        id: row.id,
        similarity: computeCosineSimilarity(storedEmbedding, embedding),
        flagged_for_review: row.flagged_for_review,
        version: row.version,
        created_at: row.created_at,
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
  if (dependencies.searchRetrievalCandidates) {
    return dependencies.searchRetrievalCandidates(subject, embedding);
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

    return loadRetrievalCandidatesFallback(client, subject, embedding);
  }

  return (data ?? []).map((candidate) => retrievalCandidateSchema.parse(candidate));
}

export async function retrieveGraphId(
  input: RetrieveRequest,
  dependencies: RetrievalDependencies = {},
): Promise<RetrieveResponse> {
  const parsedInput = retrieveRequestSchema.parse(input);
  const embedding = await embedDescription(parsedInput.description, dependencies);
  const candidates = await loadRetrievalCandidates(
    parsedInput.subject,
    embedding,
    dependencies,
  );
  const decision = decideRetrievalCandidate(candidates);

  return { graph_id: decision.graph_id };
}
