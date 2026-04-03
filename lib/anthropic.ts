import Anthropic from "@anthropic-ai/sdk";

import { getOptionalEnv, requireServerEnv } from "@/lib/env";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6" as const;
export const ANTHROPIC_MODEL_OVERRIDE_ENV = "ANTHROPIC_MODEL_OVERRIDE" as const;

let anthropicClient: Anthropic | null = null;

export function getAnthropicModel(): string {
  return getOptionalEnv(ANTHROPIC_MODEL_OVERRIDE_ENV) ?? DEFAULT_CLAUDE_MODEL;
}

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
