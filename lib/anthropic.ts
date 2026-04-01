import Anthropic from "@anthropic-ai/sdk";

import { requireServerEnv } from "@/lib/env";

export const CLAUDE_MODEL = "claude-sonnet-4-5" as const;

let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: requireServerEnv("ANTHROPIC_API_KEY"),
    });
  }

  return anthropicClient;
}

export function resetAnthropicClientForTests(): void {
  anthropicClient = null;
}
