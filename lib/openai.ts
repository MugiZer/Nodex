import OpenAI from "openai";

import { requireServerEnv } from "@/lib/env";

export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small" as const;

let openAiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openAiClient) {
    openAiClient = new OpenAI({
      apiKey: requireServerEnv("OPENAI_API_KEY"),
    });
  }

  return openAiClient;
}

export function resetOpenAIClientForTests(): void {
  openAiClient = null;
}
