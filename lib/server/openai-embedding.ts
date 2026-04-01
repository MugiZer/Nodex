import OpenAI from "openai";

import { requireServerEnv } from "@/lib/env";

export async function embedDescription(description: string): Promise<number[]> {
  const client = new OpenAI({
    apiKey: requireServerEnv("OPENAI_API_KEY"),
  });

  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: description,
  });

  const vector = response.data[0]?.embedding;
  if (!vector) {
    throw new Error("OpenAI returned no embedding vector.");
  }

  return vector;
}
