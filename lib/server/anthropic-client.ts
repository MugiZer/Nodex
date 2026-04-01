import Anthropic from "@anthropic-ai/sdk";

import { requireServerEnv } from "@/lib/env";

export function createAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: requireServerEnv("ANTHROPIC_API_KEY"),
  });
}
